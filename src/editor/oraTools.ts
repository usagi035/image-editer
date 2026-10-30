import { strFromU8, strToU8, unzip, zip } from "fflate";
import { canvasToBlob } from "./ioTools";
import {
  canvasToPixels,
  createBlankLayer,
  pixelsToCanvas,
  type Layer,
} from "./layerUtils";

/**
 * プロジェクト形式 OpenRaster（`.ora`）入出力（改訂版仕様書 5.1）。
 * - zip 構成: `mimetype`（先頭・非圧縮）/ `stack.xml` / `data/*.png`（レイヤー）/ `mergedimage.png`
 * - 圧縮は fflate の非同期 API（内部ワーカーで実行されメインスレッドをブロックしない）
 * - レイヤーPNGはドキュメント全体サイズで書き出す（x/y=0・簡潔で他アプリ互換）
 * - stack.xml のレイヤー順は「先頭 = 最前面」（ORA 仕様）。エディタの layers 配列は
 *   「後ろ = 最前面」なので保存時・読込時に反転する
 */

export const ORA_MIME = "image/openraster";
export const ORA_EXT = "ora";

/** stack.xml から読み出したレイヤー記述 */
export interface OraLayerEntry {
  name: string;
  src: string;
  /** 0〜100（エディタの opacity 表記へ変換済み） */
  opacity: number;
  visible: boolean;
  /** ドキュメント座標での配置位置（レイヤーPNGがドキュメントより小さい場合） */
  x: number;
  y: number;
}

/** stack.xml の解析結果 */
export interface OraStackInfo {
  width: number;
  height: number;
  layers: OraLayerEntry[];
}

// ============ XML エンティティ ============

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ============ stack.xml（純関数・テスト対象） ============

/**
 * stack.xml を生成する。
 * `srcs[i]` は「最前面から i 番目」のレイヤーPNGパス（ORA のレイヤー順どおり）。
 */
export function buildStackXml(
  width: number,
  height: number,
  name: string,
  /** 最前面が先頭（ORA 順） */
  layers: Array<Pick<OraLayerEntry, "name" | "src" | "opacity" | "visible">>
): string {
  const layerXml = layers
    .map(
      (l) =>
        `  <layer name="${escapeXml(l.name)}" src="${escapeXml(l.src)}" x="0" y="0" ` +
        `opacity="${(l.opacity / 100).toFixed(2)}" visibility="${l.visible ? "visible" : "hidden"}"/>`
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<image version="0.0.1" xmlns="http://openraster.org/schema/root" ` +
    `w="${width}" h="${height}" name="${escapeXml(name)}">\n` +
    `<stack>\n` +
    `${layerXml}\n` +
    `</stack>\n` +
    `</image>\n`
  );
}

/** タグ内の属性をパースする（ORA スキーマ向けの簡易パーサ・両引用符対応） */
function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    out[m[1]] = unescapeXml(m[3] ?? m[4] ?? "");
  }
  return out;
}

/**
 * stack.xml を解析する。
 * 対応範囲: `<image w h>` と `<layer ... />`（ネストした `<stack>` 内のレイヤーも平坦に収集）。
 */
export function parseStackXml(xml: string): OraStackInfo {
  const imageMatch = /<image\b[^>]*>/.exec(xml);
  if (!imageMatch) throw new Error("stack.xml: <image> タグが見つかりません");
  const imageAttrs = parseAttrs(imageMatch[0]);
  const width = Number(imageAttrs.w);
  const height = Number(imageAttrs.h);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("stack.xml: 画像サイズが不正です");
  }
  const layers: OraLayerEntry[] = [];
  const layerRe = /<layer\b[^>]*\/?>|<layer\b[^>]*>/g;
  let lm: RegExpExecArray | null;
  while ((lm = layerRe.exec(xml)) !== null) {
    const a = parseAttrs(lm[0]);
    if (!a.src) continue; // src の無い layer はサポート外（_paint 等）→ スキップ
    const opacity = Math.round(Number(a.opacity ?? "1") * 100);
    layers.push({
      name: a.name || "レイヤー",
      src: a.src,
      opacity: Math.max(0, Math.min(100, Number.isFinite(opacity) ? opacity : 100)),
      visible: (a.visibility ?? "visible") !== "hidden",
      x: Number(a.x ?? 0) || 0,
      y: Number(a.y ?? 0) || 0,
    });
  }
  if (layers.length === 0) throw new Error("stack.xml: レイヤーがありません");
  return { width, height, layers };
}

// ============ zip 構築（純関数部・テスト対象） ============

/**
 * .ora の zip を構築する（`mimetype` を先頭・非圧縮で置く ORA 仕様準拠）。
 * PNG バイト列は呼び出し側で用意する。
 */
export function packOra(
  entries: { stackXml: string; layerPngs: Uint8Array[]; mergedPng: Uint8Array }
): Promise<Uint8Array> {
  // 最前面が先頭の ORA 順 → data/0.png が最前面
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [strToU8(ORA_MIME), { level: 0 }],
    "stack.xml": [strToU8(entries.stackXml), { level: 6 }],
    "mergedimage.png": [entries.mergedPng, { level: 6 }],
  };
  entries.layerPngs.forEach((png, i) => {
    files[`data/${i}.png`] = [png, { level: 6 }];
  });
  return new Promise((resolve, reject) => {
    zip(files, { mtime: new Date() }, (err, data) => {
      if (err) reject(new Error(`ora 圧縮に失敗しました: ${err.message}`));
      else resolve(data);
    });
  });
}

// ============ エンコード / デコード（Canvas 必要・ブラウザ限定） ============

/** レイヤー配列（後ろ = 最前面）から .ora bytes を生成する */
export async function encodeOra(
  layers: Layer[],
  docWidth: number,
  docHeight: number,
  docName: string
): Promise<Uint8Array> {
  // ORA 順（最前面が先頭）に反転して data/0.png = 最前面にする
  const oraOrder = [...layers].reverse();
  const layerPngs: Uint8Array[] = [];
  const layerMeta: Array<{ name: string; src: string; opacity: number; visible: boolean }> = [];
  for (let i = 0; i < oraOrder.length; i++) {
    const layer = oraOrder[i];
    const canvas = pixelsToCanvas(layer.pixels, layer.width, layer.height);
    const blob = await canvasToBlob(canvas, "png", 1);
    layerPngs.push(new Uint8Array(await blob.arrayBuffer()));
    layerMeta.push({
      name: layer.name,
      src: `data/${i}.png`,
      opacity: layer.opacity,
      visible: layer.visible,
    });
  }
  const stackXml = buildStackXml(docWidth, docHeight, docName, layerMeta);
  // mergedimage.png: 合成結果（可視レイヤーのみ・opacity 適用）
  const merged = pixelsToCanvas(
    mergeAllLayers(layers, docWidth, docHeight),
    docWidth,
    docHeight
  );
  const mergedBlob = await canvasToBlob(merged, "png", 1);
  const mergedPng = new Uint8Array(await mergedBlob.arrayBuffer());
  return packOra({ stackXml, layerPngs, mergedPng });
}

/** 全レイヤーを下層→上層に合成したピクセルを返す（mergedimage.png 用） */
function mergeAllLayers(
  layers: Layer[],
  docWidth: number,
  docHeight: number
): Uint32Array {
  const out = new Uint32Array(docWidth * docHeight);
  const canvas = pixelsToCanvas(out, docWidth, docHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity / 100;
    // レイヤーは一瞬だけ Canvas へ展開（保持しない・仕様書 4.5）
    const scratch = pixelsToCanvas(layer.pixels, layer.width, layer.height);
    ctx.drawImage(scratch, 0, 0, docWidth, docHeight);
  }
  ctx.globalAlpha = 1;
  return canvasToPixels(canvas).pixels;
}

/** PNG bytes → ImageBitmap（レイヤーPNGのデコード） */
async function decodePng(bytes: Uint8Array): Promise<ImageBitmap> {
  const copy = bytes.slice();
  const blob = new Blob([copy.buffer], { type: "image/png" });
  return createImageBitmap(blob);
}

/** .ora bytes を読み出してドキュメント化する（layers 配列は後ろ = 最前面） */
export async function decodeOra(bytes: Uint8Array): Promise<{
  width: number;
  height: number;
  layers: Layer[];
}> {
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err) reject(new Error(`ora 展開に失敗しました: ${err.message}`));
      else resolve(data);
    });
  });
  const xmlBytes = files["stack.xml"];
  if (!xmlBytes) throw new Error("ora: stack.xml が見つかりません");
  const info = parseStackXml(strFromU8(xmlBytes));

  // ORA 順（最前面先頭）→ エディタ順（後ろ = 最前面）へ反転して配置
  const layers: Layer[] = [];
  for (let i = info.layers.length - 1; i >= 0; i--) {
    const entry = info.layers[i];
    const png = files[entry.src.replace(/^\//, "")];
    if (!png) throw new Error(`ora: レイヤー画像が見つかりません: ${entry.src}`);
    const bitmap = await decodePng(png);
    const layer = createBlankLayer(info.width, info.height, entry.name);
    // レイヤーPNGを (x, y) に配置（ドキュメント同サイズなら通常の贴り付け）
    const canvas = pixelsToCanvas(layer.pixels, info.width, info.height);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, entry.x, entry.y);
    bitmap.close();
    layer.pixels = canvasToPixels(canvas).pixels;
    layer.opacity = entry.opacity;
    layer.visible = entry.visible;
    layers.push(layer);
  }
  return { width: info.width, height: info.height, layers };
}
