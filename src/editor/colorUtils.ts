/**
 * キャンバスピクセル操作ユーティリティ。
 * ImageData の Uint32Array 直接操作用のパック/アンパックを提供する。
 * フォーマットはリトルエンディアン環境の Canvas RGBA（メモリ上: R,G,B,A → 値は A<<24|B<<16|G<<8|R）。
 */

export function packRGBA(r: number, g: number, b: number, a: number): number {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export const getR = (px: number): number => px & 255;
export const getG = (px: number): number => (px >>> 8) & 255;
export const getB = (px: number): number => (px >>> 16) & 255;
export const getA = (px: number): number => (px >>> 24) & 255;

/** "#rrggbb" / "#rrggbbaa" → Uint32 ピクセル値 */
export function hexToUint32(hex: string): number {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  const n = parseInt(h, 16);
  if (h.length !== 8 || Number.isNaN(n)) return 0x00000000;
  const r = (n >>> 24) & 255;
  const g = (n >>> 16) & 255;
  const b = (n >>> 8) & 255;
  const a = n & 255;
  return packRGBA(r, g, b, a);
}

/** Uint32 ピクセル値 → "#rrggbb"（アルファ無視） */
export function uint32ToHex(px: number): string {
  const r = getR(px).toString(16).padStart(2, "0");
  const g = getG(px).toString(16).padStart(2, "0");
  const b = getB(px).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** "#rrggbb" / "#rrggbbaa" → RGBA 各 0-255 */
export function hexToRgba(hex: string): Rgba {
  const px = hexToUint32(hex);
  return { r: getR(px), g: getG(px), b: getB(px), a: getA(px) };
}
