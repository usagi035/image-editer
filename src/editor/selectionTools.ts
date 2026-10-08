import { getA, getB, getG, getR } from "./colorUtils";
import type { SelectionState } from "./types";

/**
 * 範囲選択（仕様書 4.3）
 * - 矩形選択: bbox 管理
 * - 魔術の杖: 連続/全域の同色領域を Uint8Array マスク化
 * 選択外へのペイント/バケツ処理は buildSelectionMask で遮断する。
 */

/** 容許値つき同色判定（RGBA 各チャンネルの最大差分） */
export function matchesWithTolerance(
  px: number,
  target: number,
  tolerance: number
): boolean {
  return (
    Math.max(
      Math.abs(getR(px) - getR(target)),
      Math.abs(getG(px) - getG(target)),
      Math.abs(getB(px) - getB(target)),
      Math.abs(getA(px) - getA(target))
    ) <= tolerance
  );
}

/**
 * 矩形選択を作成する（doc 座標・両端のセルを含むインクルシブ指定、
 * バッファ外はクランプ。ドラッグ無しのクリックは 1x1 選択になる）。
 */
export function createRectSelection(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  docWidth: number,
  docHeight: number
): SelectionState | null {
  if (docWidth <= 0 || docHeight <= 0) return null;
  const clampX = (v: number) => Math.max(0, Math.min(docWidth - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(docHeight - 1, v));
  const xa = clampX(Math.min(x0, x1));
  const xb = clampX(Math.max(x0, x1));
  const ya = clampY(Math.min(y0, y1));
  const yb = clampY(Math.max(y0, y1));
  const w = xb - xa + 1;
  const h = yb - ya + 1;
  if (w <= 0 || h <= 0) return null;
  return { kind: "rect", x: xa, y: ya, w, h, mask: null };
}

/**
 * 魔術の杖選択。
 * contiguous: true で4近傍BFS（連続領域）、false で全域の同色ピクセルを選択。
 */
export function createWandSelection(
  pixels: Uint32Array,
  docWidth: number,
  docHeight: number,
  startX: number,
  startY: number,
  tolerance: number,
  contiguous: boolean,
  selectionColor: string
): SelectionState | null {
  if (
    startX < 0 ||
    startX >= docWidth ||
    startY < 0 ||
    startY >= docHeight
  )
    return null;

  const startIdx = startY * docWidth + startX;
  const target = pixels[startIdx];
  const mask = new Uint8Array(docWidth * docHeight);
  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;

  const mark = (idx: number): void => {
    if (mask[idx]) return;
    if (!matchesWithTolerance(pixels[idx], target, tolerance)) return;
    mask[idx] = 1;
    const x = idx % docWidth;
    const y = (idx / docWidth) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (contiguous) {
      if (x > 0) enqueue(idx - 1);
      if (x < docWidth - 1) enqueue(idx + 1);
      if (y > 0) enqueue(idx - docWidth);
      if (y < docHeight - 1) enqueue(idx + docWidth);
    }
  };
  const queue: number[] = [];
  let head = 0;
  function enqueue(idx: number): void {
    queue.push(idx);
  }

  if (contiguous) {
    mask[startIdx] = 1;
    if (startX > 0) enqueue(startIdx - 1);
    if (startX < docWidth - 1) enqueue(startIdx + 1);
    if (startY > 0) enqueue(startIdx - docWidth);
    if (startY < docHeight - 1) enqueue(startIdx + docWidth);
    while (head < queue.length) mark(queue[head++]);
  } else {
    for (let i = 0; i < pixels.length; i++) {
      if (matchesWithTolerance(pixels[i], target, tolerance)) {
        mask[i] = 1;
        const x = i % docWidth;
        const y = (i / docWidth) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  // 着色プレビュー（選択ピクセルへ半透明の選択色を重ねる）
  const tint = document.createElement("canvas");
  tint.width = docWidth;
  tint.height = docHeight;
  const tctx = tint.getContext("2d")!;
  const img = tctx.createImageData(docWidth, docHeight);
  const rgba = parseHexColor(selectionColor);
  const data = new Uint32Array(img.data.buffer);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) data[i] = rgba;
  }
  tctx.putImageData(img, 0, 0);

  return {
    kind: "wand",
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    mask,
    tint,
  };
}

/** "#rrggbb" → 半透明の Uint32 ピクセル値（RGBA リトルエンディアン） */
function parseHexColor(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >>> 16) & 255;
  const g = (n >>> 8) & 255;
  const b = n & 255;
  return (((0x66 << 24) | (b << 16) | (g << 8) | r) >>> 0);
}

/**
 * ペイント/バケツ用マスクを構築する。
 * 選択なし → null（全許可）、矩形 → bbox マスク、杖 → 既存マスク。
 */
export function buildSelectionMask(
  selection: SelectionState | null | undefined,
  docWidth: number,
  docHeight: number
): Uint8Array | null {
  if (!selection) return null;
  if (selection.kind === "wand" && selection.mask) return selection.mask;
  const mask = new Uint8Array(docWidth * docHeight);
  const x1 = Math.min(docWidth, selection.x + selection.w);
  const y1 = Math.min(docHeight, selection.y + selection.h);
  for (let y = Math.max(0, selection.y); y < y1; y++) {
    const row = y * docWidth;
    for (let x = Math.max(0, selection.x); x < x1; x++) {
      mask[row + x] = 1;
    }
  }
  return mask;
}
