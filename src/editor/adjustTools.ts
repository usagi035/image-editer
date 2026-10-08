import { getA, getB, getG, getR, packRGBA } from "./colorUtils";
import type { Layer } from "./layerUtils";
import { buildSelectionMask } from "./selectionTools";
import type { SelectionState } from "./types";

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
 */
export function adjustPixels(
  pixels: Uint32Array,
  params: AdjustParams,
  mask: Uint8Array | null = null
): void {
  if (isIdentityAdjust(params)) return;
  const hasMask = mask !== null;
  const hueShift = params.hue;
  const satMul = 1 + params.saturation / 100;
  const valMul = 1 + params.value / 100;
  const cf = 1 + params.contrast / 100;
  // HSV が中立なら RGB 直接コントラスト処理に短絡（高速化）
  const hsvOnly = hueShift === 0 && satMul === 1 && valMul === 1;

  for (let i = 0; i < pixels.length; i++) {
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

/** レイヤーのピクセルへ調整を破壊的に適用する（適用ボタン用）。 */
export function applyAdjustToLayer(
  layer: Layer,
  params: AdjustParams,
  mask: Uint8Array | null = null
): void {
  if (isIdentityAdjust(params)) return;
  const ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  adjustPixels(new Uint32Array(img.data.buffer), params, mask);
  ctx.putImageData(img, 0, 0);
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
}

export interface AdjustPreviewParams {
  layers: Layer[];
  activeLayerId: string;
  params: AdjustParams;
  scope: "layer" | "selection";
  selection: SelectionState | null;
  width: number;
  height: number;
  revision: number;
}

/**
 * リアルタイムプレビュー用の合成キャンバスを返す。
 * revision / パラメータ / 選択の変化時のみ再計算する。
 * 対象は現在のレイヤー（改訂版仕様書 4.4: モード分けは廃止）。
 */
export function getAdjustPreview(
  cache: AdjustPreviewCache | null,
  p: AdjustPreviewParams
): AdjustPreviewCache {
  const targets = p.layers.filter((l) => l.id === p.activeLayerId);
  const mask = buildAdjustMask(p.scope, p.selection, p.width, p.height);
  const selRef = p.selection;
  const key = [
    p.revision,
    p.activeLayerId,
    p.scope,
    p.params.hue,
    p.params.saturation,
    p.params.value,
    p.params.contrast,
    p.width,
    p.height,
  ].join(":");

  if (cache && cache.key === key && cache.selection === selRef) return cache;

  // プレビューはドキュメント全体解像度で合成する
  const pw = Math.max(1, p.width);
  const ph = Math.max(1, p.height);

  let canvas = cache?.canvas;
  if (!canvas) canvas = document.createElement("canvas");
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return { key, selection: selRef, canvas };
  ctx.clearRect(0, 0, pw, ph);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;

  const targetIds = new Set(targets.map((t) => t.id));
  // 調整対象レイヤー用の一時キャンバス（full res）
  let tmp: HTMLCanvasElement | null = null;

  for (const layer of p.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity / 100;
    if (targetIds.has(layer.id)) {
      const w = layer.canvas.width;
      const h = layer.canvas.height;
      if (!tmp) tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext("2d", { willReadFrequently: true });
      if (tctx) {
        tctx.clearRect(0, 0, w, h);
        tctx.drawImage(layer.canvas, 0, 0);
        const img = tctx.getImageData(0, 0, w, h);
        adjustPixels(new Uint32Array(img.data.buffer), p.params, mask);
        tctx.putImageData(img, 0, 0);
        ctx.drawImage(tmp, 0, 0, pw, ph);
      }
    } else {
      ctx.drawImage(layer.canvas, 0, 0, pw, ph);
    }
  }
  ctx.globalAlpha = 1;
  return { key, selection: selRef, canvas };
}
