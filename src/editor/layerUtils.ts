import { hexToUint32 } from "./colorUtils";
import type { Rect } from "./types";

/**
 * レイヤー実体（改訂版仕様書 4.5）。
 * 各レイヤーは `Uint32Array`（幅×高さ・color.ts の packRGBA / ABGR 並び）を保持し、
 * **非表示の HTML5 Canvas はレイヤー本体に持たせない**（画像全体サイズの Canvas 禁止）。
 * `pixels` の参照は React の state ではなくこのオブジェクト側に置き、
 * 変更後は「再描画要求（revision）」だけをストアへ通知する。
 */
export interface Layer {
  id: string;
  name: string;
  /** 幅×高さのピクセル本体 */
  pixels: Uint32Array;
  width: number;
  height: number;
  visible: boolean;
  /** 0〜100 (%) */
  opacity: number;
}

let layerSeq = 0;

export function nextLayerId(): string {
  layerSeq += 1;
  return `layer-${layerSeq}`;
}

/** キャンバスサイズの空レイヤーを生成する。fill は "#rrggbb" or "#rrggbbaa"（省略時は全透明）。 */
export function createBlankLayer(
  width: number,
  height: number,
  name: string,
  fill?: string
): Layer {
  const pixels = new Uint32Array(Math.max(1, width) * Math.max(1, height));
  if (fill && fill !== "#00000000") {
    const px = hexToUint32(fill);
    if (((px >>> 24) & 255) > 0) pixels.fill(px);
  }
  return {
    id: nextLayerId(),
    name,
    pixels,
    width,
    height,
    visible: true,
    opacity: 100,
  };
}

/** 既存レイヤーを複製（ピクセルコピー）。 */
export function cloneLayer(source: Layer, name: string): Layer {
  return {
    id: nextLayerId(),
    name,
    pixels: source.pixels.slice(),
    width: source.width,
    height: source.height,
    visible: source.visible,
    opacity: source.opacity,
  };
}

// ============ Uint32Array ↔ ImageData / 一時 Canvas 変換 ============
// 一時 Canvas は「画像のデコード」「縮小/拡大スケーラ」「書き出し」など
// 一瞬だけ必要な場面でのみ使い、レイヤー本体としては保持しない（仕様書 4.5）。

/** pixels → ImageData（内部は同じ RGBA バイト列） */
export function pixelsToImageData(
  pixels: Uint32Array,
  width: number,
  height: number
): ImageData {
  const img = new ImageData(width, height);
  new Uint32Array(img.data.buffer).set(pixels.subarray(0, width * height));
  return img;
}

/** ImageData → pixels（ImageData は破棄されない場合も独立した配列を返す） */
export function imageDataToPixels(img: ImageData): Uint32Array {
  return new Uint32Array(img.data.buffer.slice(0));
}

/** pixels → 一時 Canvas（スケーリング・統合・書き出しの瞬間のみ） */
export function pixelsToCanvas(
  pixels: Uint32Array,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(pixelsToImageData(pixels, width, height), 0, 0);
  return canvas;
}

/** 一時 Canvas → pixels（デコード結果の回収） */
export function canvasToPixels(canvas: HTMLCanvasElement): {
  pixels: Uint32Array;
  width: number;
  height: number;
} {
  const w = canvas.width;
  const h = canvas.height;
  const data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h);
  return { pixels: new Uint32Array(data.data.buffer), width: w, height: h };
}

/**
 * ピクセル配列を新しいサイズへスケールする（ドキュメントリサイズ / 履歴復元の縮小拡大）。
 * 拡大はニアレスト（ピクセルアート保護）、縮小はスムージング — 従来の drawImage と同挙動。
 * 一時 Canvas を使うのはこの関数内のみ（保持されない）。
 */
export function scalePixels(
  pixels: Uint32Array,
  width: number,
  height: number,
  newWidth: number,
  newHeight: number
): { pixels: Uint32Array; width: number; height: number } {
  if (width === newWidth && height === newHeight) {
    return { pixels, width, height };
  }
  const src = pixelsToCanvas(pixels, width, height);
  const next = document.createElement("canvas");
  next.width = newWidth;
  next.height = newHeight;
  const ctx = next.getContext("2d", { willReadFrequently: true })!;
  const upscaling = newWidth > width || newHeight > height;
  ctx.imageSmoothingEnabled = !upscaling;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, newWidth, newHeight);
  return canvasToPixels(next);
}

/**
 * rect 範囲のピクセルを切り出す（履歴パッチ・クロップ用）。
 * 戻り値は必ず rect.w×rect.h。ドキュメント外は透明（0）で埋める。
 */
export function cropPixels(
  pixels: Uint32Array,
  layerWidth: number,
  layerHeight: number,
  rect: Rect
): Uint32Array | null {
  const outW = Math.floor(rect.w);
  const outH = Math.floor(rect.h);
  if (outW <= 0 || outH <= 0) return null;
  const rx = Math.floor(rect.x);
  const ry = Math.floor(rect.y);
  const out = new Uint32Array(outW * outH);
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const x1 = Math.min(layerWidth, rx + outW);
  const y1 = Math.min(layerHeight, ry + outH);
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) return out;
  const dx = x0 - rx;
  const dy = y0 - ry;
  for (let row = 0; row < ch; row++) {
    const src = (y0 + row) * layerWidth + x0;
    out.set(pixels.subarray(src, src + cw), (dy + row) * outW + dx);
  }
  return out;
}

// ============ 履歴パッチ用のバイト列変換 ============
// Uint32Array（リトルエンディアン ABGR）のメモリ表現は RGBA バイト列そのもの。

/** rect 範囲の RGBA バイト列（履歴の before/after） */
export function rectBytes(
  pixels: Uint32Array,
  layerWidth: number,
  layerHeight: number,
  rect: Rect
): Uint8ClampedArray | null {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(layerWidth, Math.ceil(rect.x + rect.w)) - x;
  const h = Math.min(layerHeight, Math.ceil(rect.y + rect.h)) - y;
  if (w <= 0 || h <= 0) return null;
  const out = new Uint8ClampedArray(w * h * 4);
  const u32 = new Uint32Array(out.buffer);
  for (let row = 0; row < h; row++) {
    const src = (y + row) * layerWidth + x;
    u32.set(pixels.subarray(src, src + w), row * w);
  }
  return out;
}

/** rect 範囲へ RGBA バイト列を書き戻す（履歴の Undo / Redo） */
export function writeRectBytes(
  pixels: Uint32Array,
  layerWidth: number,
  layerHeight: number,
  rect: Rect,
  data: Uint8ClampedArray
): void {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(layerWidth, Math.ceil(rect.x + rect.w)) - x;
  const h = Math.min(layerHeight, Math.ceil(rect.y + rect.h)) - y;
  if (w <= 0 || h <= 0) return;
  const rowW = Math.min(w, Math.floor(data.length / 4 / h));
  if (rowW <= 0) return;
  const u32 = bytesToUint32(data);
  for (let row = 0; row < h; row++) {
    const dst = (y + row) * layerWidth + x;
    pixels.set(u32.subarray(row * rowW, row * rowW + w), dst);
  }
}

/** RGBA バイト列 → Uint32Array（アラインしない場合はコピー） */
export function bytesToUint32(bytes: Uint8ClampedArray): Uint32Array {
  if (bytes.byteOffset % 4 === 0 && bytes.byteLength % 4 === 0) {
    return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 2);
  }
  const copy = new Uint8ClampedArray(bytes);
  return new Uint32Array(copy.buffer);
}
