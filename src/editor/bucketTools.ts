import type { BucketMode } from "../config/configTypes";
import { getA, getB, getG, getR, packRGBA } from "./colorUtils";
import type { Layer } from "./layerUtils";

/**
 * 特殊バケツツール（仕様書 4.2）
 * 全処理は Uint32Array のメモリ直接操作で実行する（fillRect ループ禁止）。
 * - Flood Fill: 連続同色領域を幅優先探索(BFS)で塗りつぶす
 * - Global Fill: 隣接関係を無視して全体の同色を一括置換
 * - Noise Fill: 明度にランダム Jitter を散布
 * - Dither Fill: 主色/副色の交差ドットパターン
 * - Eraser Fill: 対象色領域のアルファを0にする
 */

export interface BucketParams {
  /** 塗り色（Uint32 ピクセル値） */
  color: number;
  /** Dither 用の副色 */
  color2: number;
  /** 許容値 0〜255 */
  tolerance: number;
  /** ノイズ強度 0〜100 (%) */
  jitter: number;
  /** Dither パターンのセルサイズ(px) */
  ditherCell: number;
}

/** 容許値つき同色判定（RGBA 各チャンネルの最大差分で判定） */
function matches(
  px: number,
  tr: number,
  tg: number,
  tb: number,
  ta: number,
  tolerance: number
): boolean {
  return (
    Math.max(
      Math.abs(getR(px) - tr),
      Math.abs(getG(px) - tg),
      Math.abs(getB(px) - tb),
      Math.abs(getA(px) - ta)
    ) <= tolerance
  );
}

/** Noise Fill: 明度にランダム Jitter を適用した色を返す */
function jitterColor(color: number, jitter: number): number {
  if (jitter <= 0) return color;
  const r = getR(color);
  const g = getG(color);
  const b = getB(color);
  const a = getA(color);
  const delta = (Math.random() * 2 - 1) * (jitter / 100);
  const adj = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + delta))));
  return packRGBA(adj(r), adj(g), adj(b), a);
}

/**
 * クリック位置を起点へ塗りつぶし、pixels を直接書き換える。
 * mask は選択マスク（1=選択内/0=遮断）。省略時は全域許可。
 */
export function applyFill(
  pixels: Uint32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  mode: BucketMode,
  params: BucketParams,
  mask?: Uint8Array | null
): void {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;
  const startIndex = startY * width + startX;
  if (mask && !mask[startIndex]) return;

  const target = pixels[startIndex];
  const tr = getR(target);
  const tg = getG(target);
  const tb = getB(target);
  const ta = getA(target);
  const { color, color2, tolerance, jitter, ditherCell } = params;
  const cell = Math.max(1, Math.round(ditherCell));

  // --- Global Fill: 隣接関係を無視して全体置換 ---
  if (mode === "global") {
    for (let i = 0; i < pixels.length; i++) {
      if (mask && !mask[i]) continue;
      if (matches(pixels[i], tr, tg, tb, ta, tolerance)) {
        pixels[i] = color;
      }
    }
    return;
  }

  // --- Flood / Noise / Dither / Eraser Fill: 幅優先探索(BFS) ---
  const visited = new Uint8Array(pixels.length);
  const queue: number[] = [startIndex];
  visited[startIndex] = 1;
  let head = 0;
  const ditherOn = mode === "dither";
  const noiseOn = mode === "noise";

  while (head < queue.length) {
    const idx = queue[head++];
    if (!matches(pixels[idx], tr, tg, tb, ta, tolerance)) continue;

    if (mode === "eraser") {
      pixels[idx] = 0; // アルファ0（完全透明）
    } else if (ditherOn) {
      const x = idx % width;
      const y = (idx / width) | 0;
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      pixels[idx] = on ? color : color2;
    } else if (noiseOn) {
      pixels[idx] = jitterColor(color, jitter);
    } else {
      pixels[idx] = color; // flood
    }

    // 4近傍へ拡張
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) enqueue(idx - 1);
    if (x < width - 1) enqueue(idx + 1);
    if (y > 0) enqueue(idx - width);
    if (y < height - 1) enqueue(idx + width);
  }

  function enqueue(n: number): void {
    if (visited[n]) return;
    if (mask && !mask[n]) return;
    visited[n] = 1;
    queue.push(n);
  }
}

/** レイヤーへバケツ処理を適用する（getImageData → Uint32Array 操作 → putImageData）。 */
export function applyBucketToLayer(
  layer: Layer,
  mode: BucketMode,
  params: BucketParams,
  start: { x: number; y: number },
  mask?: Uint8Array | null
): boolean {
  const ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const width = layer.canvas.width;
  const height = layer.canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint32Array(imageData.data.buffer);
  applyFill(pixels, width, height, start.x, start.y, mode, params, mask);
  ctx.putImageData(imageData, 0, 0);
  return true;
}

/**
 * 色置換（仕様書 4.3）: 指定色A を 指定色B へ置換する。
 * mask（選択範囲）で遮断可能。レイヤー全体への置換は mask=null で実行。
 */
export function replaceColorInLayer(
  layer: Layer,
  from: number,
  to: number,
  tolerance: number,
  mask?: Uint8Array | null
): boolean {
  const ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const width = layer.canvas.width;
  const height = layer.canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint32Array(imageData.data.buffer);
  const fr = getR(from);
  const fg = getG(from);
  const fb = getB(from);
  const fa = getA(from);
  for (let i = 0; i < pixels.length; i++) {
    if (mask && !mask[i]) continue;
    if (matches(pixels[i], fr, fg, fb, fa, tolerance)) {
      pixels[i] = to;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return true;
}
