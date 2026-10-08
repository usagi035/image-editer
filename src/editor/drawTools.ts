import type { Layer } from "./layerUtils";
import type { DocPoint } from "./types";

/**
 * 基本描画ツール（仕様書 4.1）
 * - ペン: 1px 単位描画 + Pixel-Perfect アルゴリズム
 * - 消しゴム: アルファ値を 0（完全透明）に設定
 * - 全処理は ImageData の Uint32Array 直接操作で行う（fillRect ループ禁止）
 */

export interface StrokeSession {
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
  pixels: Uint32Array;
  width: number;
  height: number;
  /** ストロークで変更したピクセルの元値（Pixel-Perfect 取り消し用） */
  touched: Map<number, number>;
  prev: DocPoint | null;
  prev2: DocPoint | null;
  color: number; // Uint32 ピクセル値
  size: number;
  erase: boolean;
  pixelPerfect: boolean;
  /** 選択マスク（1=描画可）。null で全領域許可。 */
  mask: Uint8Array | null;
}

/** 1点を現在のブラシで押印する（サイズ N は N×N の正方形ブラシ） */
function stamp(s: StrokeSession, cx: number, cy: number): void {
  const half = Math.floor((s.size - 1) / 2);
  const x0 = cx - half;
  const y0 = cy - half;
  for (let dy = 0; dy < s.size; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= s.height) continue;
    for (let dx = 0; dx < s.size; dx++) {
      const x = x0 + dx;
      if (x < 0 || x >= s.width) continue;
      const idx = y * s.width + x;
      // 選択領域外へのペイントを遮断（仕様書 4.3）
      if (s.mask && !s.mask[idx]) continue;
      if (!s.touched.has(idx)) s.touched.set(idx, s.pixels[idx]);
      s.pixels[idx] = s.erase ? 0 : s.color;
    }
  }
}

/** Pixel-Perfect: 角ピクセルを元値へ戻す（1px ブラシのみ） */
function undoStamp(s: StrokeSession, cx: number, cy: number): void {
  if (cx < 0 || cx >= s.width || cy < 0 || cy >= s.height) return;
  const idx = cy * s.width + cx;
  const original = s.touched.get(idx);
  if (original !== undefined) {
    s.pixels[idx] = original;
    s.touched.delete(idx);
  }
}

/**
 * 直近2点と新点が L 字（水平→垂直 or 垂直→水平）を形成する場合、
 * 中間ピクセルを除去してジザグな打点を自動抑止する。
 */
function removeCornerIfAny(s: StrokeSession, cur: DocPoint): void {
  if (!s.prev || !s.prev2) return;
  const dx1 = s.prev.x - s.prev2.x;
  const dy1 = s.prev.y - s.prev2.y;
  const dx2 = cur.x - s.prev.x;
  const dy2 = cur.y - s.prev.y;
  const horizontalThenVertical =
    dy1 === 0 && dx1 !== 0 && dx2 === 0 && dy2 !== 0;
  const verticalThenHorizontal =
    dx1 === 0 && dy1 !== 0 && dy2 === 0 && dx2 !== 0;
  if (horizontalThenVertical || verticalThenHorizontal) {
    undoStamp(s, s.prev.x, s.prev.y);
  }
}

/** Bresenham 直線（両端含む） */
function linePoints(from: DocPoint, to: DocPoint): DocPoint[] {
  const points: DocPoint[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/** ストローク開始: 最初の点を押印する */
export function beginStroke(
  layer: Layer,
  opts: {
    color: number;
    size: number;
    erase: boolean;
    pixelPerfect: boolean;
    mask?: Uint8Array | null;
  },
  start: DocPoint
): StrokeSession | null {
  const ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const width = layer.canvas.width;
  const height = layer.canvas.height;
  if (start.x < 0 || start.x >= width || start.y < 0 || start.y >= height) {
    return null;
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  const s: StrokeSession = {
    ctx,
    imageData,
    pixels: new Uint32Array(imageData.data.buffer),
    width,
    height,
    touched: new Map(),
    prev: start,
    prev2: null,
    color: opts.color >>> 0,
    size: Math.max(1, Math.round(opts.size)),
    erase: opts.erase,
    pixelPerfect: opts.pixelPerfect && opts.size === 1,
    mask: opts.mask ?? null,
  };
  stamp(s, start.x, start.y);
  flushStroke(s);
  return s;
}

/** ストローク継続: 前点から現在点へ線分を描画する */
export function continueStroke(s: StrokeSession, target: DocPoint): void {
  if (!s.prev) return;
  if (s.prev.x === target.x && s.prev.y === target.y) return;
  const points = linePoints(s.prev, target);
  // 先頭は既描画分のため2点目以降を処理
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (s.pixelPerfect) removeCornerIfAny(s, p);
    stamp(s, p.x, p.y);
    s.prev2 = s.prev;
    s.prev = p;
  }
  flushStroke(s);
}

/** ピクセル変更をレイヤーの Canvas へ書き出す */
export function flushStroke(s: StrokeSession): void {
  s.ctx.putImageData(s.imageData, 0, 0);
}

/** ストローク終了（メモリ上の状態を破棄） */
export function endStroke(s: StrokeSession): void {
  flushStroke(s);
  s.touched.clear();
}

/** 指定座標の Uint32 ピクセル値を取得（範囲外は null） */
export function sampleUint32(
  pixels: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number
): number | null {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return pixels[y * width + x];
}
