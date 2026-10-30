import { getA, getB, getG, getR, packRGBA } from "./colorUtils";
import type { Layer } from "./layerUtils";
import { deviceToDocRect, intersectLayerRect, layerSource, visibleDeviceRegion } from "./compositor";
import { buildSelectionMask } from "./selectionTools";
import type { Rect, SelectionState, ViewState } from "./types";

/**
 * 色調調整（仕様書 4.4 HSV / 明度 / コントラスト）
 * - Hue: -180〜+180, Saturation / Value / Contrast: -100〜+100
 * - ピクセル処理は Uint32Array / ImageData 直接操作（fillRect ループ禁止）
 * - 対象は現在のレイヤー（改訂版仕様書 4.4、モード分けは廃止）
 */

export interface AdjustParams {
  hue: number;
  saturation: number;
  value: number;
  contrast: number;
}

export type AdjustParamKey = keyof AdjustParams;

/** スライダー範囲（仕様書 4.4） */
export const ADJUST_LIMITS: Record<AdjustParamKey, { min: number; max: number }> = {
  hue: { min: -180, max: 180 },
  saturation: { min: -100, max: 100 },
  value: { min: -100, max: 100 },
  contrast: { min: -100, max: 100 },
};

export function isIdentityAdjust(p: AdjustParams): boolean {
  return p.hue === 0 && p.saturation === 0 && p.value === 0 && p.contrast === 0;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * RGB → HSV 変換（h: 0-360、s/v: 0-1）。
 * 配列生成を避けるためモジュールスコープのスクラッチ変数を使う。
 */
let _h = 0;
let _s = 0;
let _v = 0;
function rgbToHsv(r: number, g: number, b: number): void {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  _h = h;
  _s = max === 0 ? 0 : d / max;
  _v = max;
}

/** HSV → RGB（h: 0-360、s/v: 0-1）→ r/g/b に格納 */
let _r = 0;
let _g = 0;
let _b = 0;
function hsvToRgb(h: number, s: number, v: number): void {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) {
    rr = c;
    gg = x;
  } else if (h < 120) {
    rr = x;
    gg = c;
  } else if (h < 180) {
    gg = c;
    bb = x;
  } else if (h < 240) {
    gg = x;
    bb = c;
  } else if (h < 300) {
    rr = x;
    bb = c;
  } else {
    rr = c;
    bb = x;
  }
  _r = (rr + m) * 255;
  _g = (gg + m) * 255;
  _b = (bb + m) * 255;
}

/**
 * Uint32Array ピクセル列へ HSV/明度/コントラスト調整を in-place で適用する。
 * mask が与えられた場合は mask[i] === 1 のピクセルのみ処理する。
 * onProgress は定期的に呼ばれる（Worker からの進捗通知用）。
 */
export function adjustPixels(
  pixels: Uint32Array,
  params: AdjustParams,
  mask: Uint8Array | null = null,
  onProgress?: (done: number, total: number) => void
): void {
  if (isIdentityAdjust(params)) return;
  const hasMask = mask !== null;
  const hueShift = params.hue;
  const satMul = 1 + params.saturation / 100;
  const valMul = 1 + params.value / 100;
  const cf = 1 + params.contrast / 100;
  // HSV が中立なら RGB 直接コントラスト処理に短絡（高速化）
  const hsvOnly = hueShift === 0 && satMul === 1 && valMul === 1;
  const total = pixels.length;
  const progressStride = 1 << 16; // 65536 px ごとに進捗通知

  for (let i = 0; i < total; i++) {
    if (onProgress && i % progressStride === 0) onProgress(i, total);
    if (hasMask && mask![i] === 0) continue;
    const src = pixels[i];
    const a = getA(src);
    if (a === 0) continue; // 透過ピクセルはカラーデータなし
    let r = getR(src);
    let g = getG(src);
    let b = getB(src);

    if (!hsvOnly) {
      rgbToHsv(r, g, b);
      let h = _h + hueShift;
      h = ((h % 360) + 360) % 360;
      const s = clamp01(_s * satMul);
      const v = clamp01(_v * valMul);
      hsvToRgb(h, s, v);
      r = _r;
      g = _g;
      b = _b;
    }

    if (cf !== 1) {
      r = (r - 128) * cf + 128;
      g = (g - 128) * cf + 128;
      b = (b - 128) * cf + 128;
    }

    pixels[i] = packRGBA(clamp255(r), clamp255(g), clamp255(b), a);
  }
}

/** レイヤーのピクセル本体へ調整を破壊的に適用する（適用ボタン用・Canvas 非経由）。 */
export function applyAdjustToLayer(
  layer: Layer,
  params: AdjustParams,
  mask: Uint8Array | null = null
): void {
  if (isIdentityAdjust(params)) return;
  adjustPixels(layer.pixels, params, mask);
}

/** スコープ（レイヤー全体 / 選択範囲）からマスクを構築する。 */
export function buildAdjustMask(
  scope: "layer" | "selection",
  selection: SelectionState | null,
  width: number,
  height: number
): Uint8Array | null {
  if (scope !== "selection") return null;
  return buildSelectionMask(selection, width, height);
}

export interface AdjustPreviewCache {
  key: string;
  selection: SelectionState | null;
  canvas: HTMLCanvasElement;
  /** 合成済みの領域（画面デバイス座標・整数） */
  region: Rect;
}

export interface AdjustPreviewParams {
  layers: Layer[];
  activeLayerId: string;
  /** true なら全レイヤーをプレビュー対象にする（「全レイヤーに適用」チェック） */
  allLayers: boolean;
  params: AdjustParams;
  scope: "layer" | "selection";
  selection: SelectionState | null;
  width: number;
  height: number;
  revision: number;
  view: ViewState;
  /** ビューポートの CSS px サイズ */
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

/** doc 座標のマスクから rect 領域（k ピクセルおき間引き）のサブマスクを切り出す */
function sliceMask(
  mask: Uint8Array,
  rect: Rect,
  k: number,
  docWidth: number
): Uint8Array {
  const sw = Math.ceil(rect.w / k);
  const sh = Math.ceil(rect.h / k);
  const out = new Uint8Array(sw * sh);
  for (let row = 0; row < sh; row++) {
    const srcRow = (rect.y + row * k) * docWidth + rect.x;
    const dstRow = row * sw;
    if (k === 1) {
      out.set(mask.subarray(srcRow, srcRow + sw), dstRow);
    } else {
      for (let col = 0; col < sw; col++) {
        out[dstRow + col] = mask[srcRow + col * k];
      }
    }
  }
  return out;
}

/**
 * リアルタイムプレビュー用の合成キャンバスを返す（仕様書 4.4 / 2.2）。
 * - **表示中のビューポート範囲のみ**をデバイス解像度で合成する
 *   （画像全体サイズの Canvas は作らない。大画像でもプレビューのメモリは画面サイズ上限）
 * - revision / パラメータ / 選択 / ビューポートの変化時のみ再計算する
 * - 対象は選択中レイヤー（「全レイヤーに適用」チェック時は全レイヤー）
 */
export function getAdjustPreview(
  cache: AdjustPreviewCache | null,
  p: AdjustPreviewParams
): AdjustPreviewCache {
  const targets = p.allLayers
    ? p.layers
    : p.layers.filter((l) => l.id === p.activeLayerId);
  const mask = buildAdjustMask(p.scope, p.selection, p.width, p.height);
  const selRef = p.selection;
  const region = visibleDeviceRegion(
    p.view,
    p.cssWidth,
    p.cssHeight,
    p.dpr,
    p.width,
    p.height
  );
  const key = [
    p.revision,
    p.activeLayerId,
    p.allLayers,
    p.scope,
    p.params.hue,
    p.params.saturation,
    p.params.value,
    p.params.contrast,
    p.width,
    p.height,
    `${region.x},${region.y},${region.w},${region.h}@${p.view.zoom}:${p.dpr}:${p.cssWidth}x${p.cssHeight}`,
  ].join(":");

  if (cache && cache.key === key && cache.selection === selRef) return cache;

  const canvas = cache?.canvas ?? document.createElement("canvas");
  // ドキュメントが画面外 → 描画対象なし（領域キーと selection だけ進める）
  if (region.w === 0 || region.h === 0) {
    return { key, selection: selRef, canvas, region };
  }

  if (canvas.width !== region.w || canvas.height !== region.h) {
    canvas.width = region.w; // サイズ変更で内容はクリアされる
    canvas.height = region.h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return { key, selection: selRef, canvas, region };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, region.w, region.h);
  // doc 座標 → キャンバス座標（キャンバス原点 = region 左上）
  const scale = p.view.zoom * p.dpr;
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    p.view.panX * p.dpr - region.x,
    p.view.panY * p.dpr - region.y
  );
  ctx.imageSmoothingEnabled = false;

  // プレビュー対象（target）に写るドキュメント範囲だけを合成する
  const docRect = deviceToDocRect(region, p.view, p.dpr);
  const targetIds = new Set(targets.map((t) => t.id));
  const k = scale >= 1 ? 1 : Math.max(1, Math.round(1 / scale));

  for (const layer of p.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const rect = intersectLayerRect(docRect, layer);
    if (!rect) continue;
    // 表示範囲のソースのみ（compositor と共通・常設 Canvas 禁止）
    const src = layerSource(layer, rect, scale);
    if (!src) continue;
    if (targetIds.has(layer.id)) {
      const sctx = src.getContext("2d", { willReadFrequently: true });
      if (sctx) {
        const img = sctx.getImageData(0, 0, src.width, src.height);
        const submask = mask ? sliceMask(mask, rect, k, p.width) : null;
        adjustPixels(new Uint32Array(img.data.buffer), p.params, submask);
        sctx.putImageData(img, 0, 0);
      }
    }
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.globalAlpha = 1;
  return { key, selection: selRef, canvas, region };
}
