import type { Rect } from "./types";

/**
 * 内部クリップボードと浮遊レイヤー（仕様書 4.3: コピー/切り取り/貼り付け/移動）。
 * - ピクセルデータは React state に入れない（モジュールスコープで保持）
 * - 貼り付けは浮遊状態とし、確定操作（Enter / 他ツール選択）で現在のレイヤーへ書き込む
 * - 選択マスクがある間は貼り込みも選択内のみに作用する（書き込み遮断）
 */

export interface ClipboardImage {
  pixels: Uint32Array;
  width: number;
  height: number;
}

export interface FloatingImage extends ClipboardImage {
  /** ドキュメント座標の配置位置 */
  x: number;
  y: number;
}

let clipboard: ClipboardImage | null = null;
let floating: FloatingImage | null = null;

/** 浮遊レイヤーの描画用 Canvas（pixels の同一配列なら再構築しない） */
let floatingCanvas: HTMLCanvasElement | null = null;
let floatingCanvasPixels: Uint32Array | null = null;

/** コピー対象矩形をクランプして返す（レイヤー外は含めない） */
function clampRect(rect: Rect, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.min(width, rect.x));
  const y0 = Math.max(0, Math.min(height, rect.y));
  const x1 = Math.max(x0, Math.min(width, rect.x + rect.w));
  const y1 = Math.max(y0, Math.min(height, rect.y + rect.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * rect（mask がある場合は mask=1 のピクセルのみ）を切り出す。
 * mask で遮断された位置は透明（0）になる。
 */
export function copyRect(
  pixels: Uint32Array,
  layerWidth: number,
  rect: Rect,
  mask: Uint8Array | null
): ClipboardImage {
  const r = clampRect(rect, layerWidth, pixels.length / layerWidth);
  const out = new Uint32Array(Math.max(0, r.w * r.h));
  for (let y = 0; y < r.h; y++) {
    const srcRow = (r.y + y) * layerWidth + r.x;
    const dstRow = y * r.w;
    for (let x = 0; x < r.w; x++) {
      const idx = srcRow + x;
      if (mask && !mask[idx]) continue;
      out[dstRow + x] = pixels[idx];
    }
  }
  return { pixels: out, width: r.w, height: r.h };
}

/** rect（mask がある場合は mask=1 のピクセルのみ）を透明化する（切り取り用）。 */
export function clearRectInPlace(
  pixels: Uint32Array,
  layerWidth: number,
  rect: Rect,
  mask: Uint8Array | null
): void {
  const r = clampRect(rect, layerWidth, pixels.length / layerWidth);
  for (let y = 0; y < r.h; y++) {
    const row = (r.y + y) * layerWidth + r.x;
    for (let x = 0; x < r.w; x++) {
      const idx = row + x;
      if (mask && !mask[idx]) continue;
      pixels[idx] = 0;
    }
  }
}

/**
 * 浮遊レイヤーを target へ書き込む（配置位置でクランプ、mask=0 は書き込まない）。
 * レイヤー本体の Uint32Array を直接書き換える。
 */
export function pasteInto(
  target: Uint32Array,
  targetWidth: number,
  targetHeight: number,
  image: FloatingImage,
  mask: Uint8Array | null
): void {
  for (let y = 0; y < image.height; y++) {
    const ty = image.y + y;
    if (ty < 0 || ty >= targetHeight) continue;
    const srcRow = y * image.width;
    const dstRow = ty * targetWidth;
    for (let x = 0; x < image.width; x++) {
      const tx = image.x + x;
      if (tx < 0 || tx >= targetWidth) continue;
      const dst = dstRow + tx;
      if (mask && !mask[dst]) continue;
      // マスク内は全面置換（透明ピクセルも含めて下地を上書きする）
      target[dst] = image.pixels[srcRow + x];
    }
  }
}

/* ---------------- モジュールスコープのクリップボード/浮遊状態 ---------------- */

export function setClipboardImage(image: ClipboardImage | null): void {
  clipboard = image;
}

export function getClipboardImage(): ClipboardImage | null {
  return clipboard;
}

export function setFloatingImage(image: FloatingImage | null): void {
  floating = image;
  if (image && floatingCanvasPixels !== image.pixels) {
    floatingCanvas = null; // ピクセル本体が変わったときだけ Canvas を作り直す
    floatingCanvasPixels = image.pixels;
  }
  if (!image) {
    floatingCanvas = null;
    floatingCanvasPixels = null;
  }
}

export function getFloatingImage(): FloatingImage | null {
  return floating;
}

/** 浮遊レイヤーの描画用 Canvas（移動時は同一 Canvas を再利用） */
export function getFloatingCanvas(): HTMLCanvasElement | null {
  if (!floating || floatingCanvasPixels !== floating.pixels) return null;
  if (!floatingCanvas) {
    floatingCanvas = document.createElement("canvas");
    floatingCanvas.width = floating.width;
    floatingCanvas.height = floating.height;
    const ctx = floatingCanvas.getContext("2d")!;
    const img = ctx.createImageData(floating.width, floating.height);
    new Uint32Array(img.data.buffer).set(floating.pixels);
    ctx.putImageData(img, 0, 0);
  }
  return floatingCanvas;
}
