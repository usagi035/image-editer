import type { MirrorMode, ShapeFillMode } from "../config/configTypes";
import { linePoints } from "./drawTools";
import type { DocPoint } from "./types";

/**
 * 図形ツール（仕様書 4.1: 直線・矩形・楕円）
 * - ドラッグ中はプレビュー、離した時点で確定（プレビューは viewportRenderer が担当）
 * - 矩形・楕円は「枠のみ / 塗り」を切替、Shift で正方形・正円 / 45 度固定
 * - ミラー描画（縦軸/横軸/両方）を図形にも適用
 * - 全処理は Uint32Array 直接操作（doc 全体 Canvas 禁止・Worker からも利用可能）
 */

export type ShapeKind = "line" | "rect" | "ellipse";

export interface ShapeSpec {
  kind: ShapeKind;
  start: DocPoint;
  end: DocPoint;
  /** 矩形・楕円のみ意味を持つ（直線は常に輪郭=線分） */
  fill: ShapeFillMode;
}

/** 正規化した外接矩形（start/end がどの象限でもよい） */
function bboxOf(spec: ShapeSpec): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(spec.start.x, spec.end.x),
    y0: Math.min(spec.start.y, spec.end.y),
    x1: Math.max(spec.start.x, spec.end.x),
    y1: Math.max(spec.start.y, spec.end.y),
  };
}

/**
 * Shift 拘束（仕様書 4.1）:
 * - 直線: 45 度固定（8 方向へスナップ）
 * - 矩形: 正方形 / 楕円: 正円
 */
export function constrainShapeEnd(
  kind: ShapeKind,
  start: DocPoint,
  end: DocPoint,
  shift: boolean
): DocPoint {
  if (!shift) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (kind === "line") {
    const len = Math.round(Math.hypot(dx, dy));
    const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return {
      x: start.x + Math.round(Math.cos(snapped) * len),
      y: start.y + Math.round(Math.sin(snapped) * len),
    };
  }
  // 矩形 / 楕円: 正方形・正円（辺長 = 長辺）
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return { x: start.x + sx * side, y: start.y + sy * side };
}

/**
 * ミラー変換した図形（原点を含め最大 4 種）。
 * - vertical: 縦軸（x を反転）/ horizontal: 横軸（y を反転）
 */
export function mirrorShapes(
  spec: ShapeSpec,
  width: number,
  height: number,
  mirror: MirrorMode
): ShapeSpec[] {
  const out: ShapeSpec[] = [spec];
  if (mirror === "none") return out;
  const make = (fx: boolean, fy: boolean): ShapeSpec => ({
    ...spec,
    start: {
      x: fx ? width - 1 - spec.start.x : spec.start.x,
      y: fy ? height - 1 - spec.start.y : spec.start.y,
    },
    end: {
      x: fx ? width - 1 - spec.end.x : spec.end.x,
      y: fy ? height - 1 - spec.end.y : spec.end.y,
    },
  });
  if (mirror === "vertical") out.push(make(true, false));
  if (mirror === "horizontal") out.push(make(false, true));
  if (mirror === "both") {
    out.push(make(true, false));
    out.push(make(false, true));
    out.push(make(true, true));
  }
  return out;
}

/**
 * 図形のラスタ化点列（重複あり・順序不定）。
 * - 直線: Bresenham / 矩形: 外周 or 塗り / 楕円: 外接矩形に収まる楕円
 * 塗りモードの全点列は巨大になり得るため、書き込み本体（writeShape）は
 * 行単位ループで直接ピクセルへ書き込む（この関数は輪郭・テスト用途）。
 */
export function shapePoints(spec: ShapeSpec): DocPoint[] {
  const { x0, y0, x1, y1 } = bboxOf(spec);
  const points: DocPoint[] = [];
  if (spec.kind === "line") {
    return linePoints(spec.start, spec.end);
  }
  if (spec.kind === "rect") {
    if (spec.fill === "fill") {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) points.push({ x, y });
      return points;
    }
    for (let x = x0; x <= x1; x++) {
      points.push({ x, y: y0 });
      if (y1 !== y0) points.push({ x, y: y1 });
    }
    for (let y = y0 + 1; y < y1; y++) {
      points.push({ x: x0, y });
      if (x1 !== x0) points.push({ x: x1, y });
    }
    return points;
  }
  // 楕円: 外接矩形 [x0..x1]×[y0..y1] に収まる楕円（中心/半径は float で扱う）
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx <= 0 || ry <= 0) {
    points.push({ x: x0, y: y0 });
    return points;
  }
  if (spec.fill === "fill") {
    for (let y = y0; y <= y1; y++) {
      const t = (y - cy) / ry;
      const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
      const xa = Math.round(cx - half);
      const xb = Math.round(cx + half);
      for (let x = xa; x <= xb; x++) points.push({ x, y });
    }
    return points;
  }
  // 輪郭: 行方向 + 列方向の両方を打点して斜めの途切れを防ぐ
  for (let y = y0; y <= y1; y++) {
    const t = (y - cy) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
    points.push({ x: Math.round(cx - half), y }, { x: Math.round(cx + half), y });
  }
  for (let x = x0; x <= x1; x++) {
    const t = (x - cx) / rx;
    const half = ry * Math.sqrt(Math.max(0, 1 - t * t));
    points.push({ x, y: Math.round(cy - half) }, { x, y: Math.round(cy + half) });
  }
  return points;
}

/** 書き込みオプション */
export interface WriteShapeOptions {
  /** Uint32 ピクセル値（主色） */
  color: number;
  /** 選択マスク（1=描画可）。null で全領域許可（仕様書 4.3） */
  mask: Uint8Array | null;
  mirror: MirrorMode;
}

/**
 * 図形をレイヤー本体へ書き込む（ミラー・選択マスク遮断対応）。
 * 変更したピクセルの元値を touched に記録する（Undo 用・drawTools 互換）。
 * onProgress は (完了ユニット, 合計ユニット)。ユニット = 塗りは行数・輪郭は点数。
 */
export function writeShape(
  pixels: Uint32Array,
  width: number,
  height: number,
  spec: ShapeSpec,
  opts: WriteShapeOptions,
  touched: Map<number, number>,
  onProgress?: (done: number, total: number) => void
): void {
  const value = opts.color >>> 0;
  const variants = mirrorShapes(spec, width, height, opts.mirror);
  // 巨大な塗り領域でも点列を全保持しないよう、fill は行単位で直接書き込む
  const isFilled = (s: ShapeSpec): boolean =>
    s.kind !== "line" && s.fill === "fill";
  const units = variants.map((v) =>
    isFilled(v)
      ? bboxOf(v).y1 - bboxOf(v).y0 + 1
      : shapePoints(v).length
  );
  const total = units.reduce((a, b) => a + b, 0);
  let done = 0;
  const write = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (opts.mask && !opts.mask[idx]) return; // 選択外への書き込みを遮断（仕様書 4.3）
    if (!touched.has(idx)) touched.set(idx, pixels[idx]);
    pixels[idx] = value;
  };

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (v.kind === "rect" && v.fill === "fill") {
      const { x0, y0, x1, y1 } = bboxOf(v);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) write(x, y);
        done++;
        onProgress?.(done, total);
      }
    } else if (v.kind === "ellipse" && v.fill === "fill") {
      const { x0, y0, x1, y1 } = bboxOf(v);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = (x1 - x0) / 2;
      const ry = (y1 - y0) / 2;
      if (rx <= 0 || ry <= 0) {
        write(x0, y0);
        done++;
        onProgress?.(done, total);
      } else {
        for (let y = y0; y <= y1; y++) {
          const t = (y - cy) / ry;
          const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
          const xa = Math.round(cx - half);
          const xb = Math.round(cx + half);
          for (let x = xa; x <= xb; x++) write(x, y);
          done++;
          onProgress?.(done, total);
        }
      }
    } else {
      for (const p of shapePoints(v)) write(p.x, p.y);
      done += units[i];
      onProgress?.(done, total);
    }
  }
}

/**
 * 図形書き込みの処理ピクセル数見積もり（Worker 閾値判定用・上界）。
 * ミラー倍率は呼び出し側で乗算する（mirrorShapes の結果の長さ）。
 */
export function shapePixelEstimate(spec: ShapeSpec): number {
  if (spec.kind === "line") {
    return (
      Math.max(
        Math.abs(spec.end.x - spec.start.x),
        Math.abs(spec.end.y - spec.start.y)
      ) + 1
    );
  }
  const { x0, y0, x1, y1 } = bboxOf(spec);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (spec.fill === "fill") return w * h;
  return 2 * (w + h); // 輪郭の近似（外周）
}
