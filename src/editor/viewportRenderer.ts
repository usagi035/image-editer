import type { AppConfig } from "../config/configTypes";
import type { ViewState } from "./types";

export interface ViewportRenderParams {
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  docWidth: number;
  docHeight: number;
  view: ViewState;
  config: AppConfig;
  /**
   * レイヤー合成フック（Unit D で実装）。
   * 呼び出し時は ctx がキャンバス座標系（doc 座標）に変換済み。
   */
  composite?: (ctx: CanvasRenderingContext2D) => void;
}

interface PatternCacheKey {
  colorA: string;
  colorB: string;
  cell: number;
  dpr: number;
}

let checkerCache: { key: PatternCacheKey; pattern: CanvasPattern } | null = null;

/** 透過確認用チェッカーボードパターン（dpr・色・セルサイズでキャッシュ） */
function getCheckerPattern(
  ctx: CanvasRenderingContext2D,
  key: PatternCacheKey
): CanvasPattern {
  if (checkerCache && matches(checkerCache.key, key)) return checkerCache.pattern;
  const size = key.cell * 2 * key.dpr;
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const octx = off.getContext("2d")!;
  octx.fillStyle = key.colorA;
  octx.fillRect(0, 0, size, size);
  octx.fillStyle = key.colorB;
  octx.fillRect(0, 0, size / 2, size / 2);
  octx.fillRect(size / 2, size / 2, size / 2, size / 2);
  const pattern = ctx.createPattern(off, "repeat")!;
  checkerCache = { key, pattern };
  return pattern;
}

function matches(a: PatternCacheKey, b: PatternCacheKey): boolean {
  return (
    a.colorA === b.colorA &&
    a.colorB === b.colorB &&
    a.cell === b.cell &&
    a.dpr === b.dpr
  );
}

/**
 * ビューポート全体を描画する。
 * 1. 背景 → 2. チェッカーボード → 3. ドキュメント内容(レイヤー合成) → 4. グリッド → 5. 枠線
 * ピクセル処理は Uint32Array/ImageData 経由で行い、fillRect ループは使わない。
 */
export function renderViewport(p: ViewportRenderParams): void {
  const { ctx, cssWidth, cssHeight, dpr, docWidth, docHeight, view, config } = p;
  const { zoom, panX, panY, showGrid } = view;
  const cw = cssWidth * dpr;
  const ch = cssHeight * dpr;
  const dw = docWidth * zoom;
  const dh = docHeight * zoom;
  const ox = panX * dpr;
  const oy = panY * dpr;
  const dwPx = dw * dpr;
  const dhPx = dh * dpr;

  // 1. 背景
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = config.theme.colors.background;
  ctx.fillRect(0, 0, cw, ch);

  // 2. チェッカーボード（キャンバス座標に固定・画面スケール不変）
  const pattern = getCheckerPattern(ctx, {
    colorA: config.canvas.checkerboard_color_a,
    colorB: config.canvas.checkerboard_color_b,
    cell: config.canvas.checker_cell_size,
    dpr,
  });
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, dwPx, dhPx);
  ctx.clip();
  ctx.fillStyle = pattern;
  ctx.translate(ox, oy);
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();

  // 3. ドキュメント内容（レイヤー合成）
  if (p.composite) {
    ctx.save();
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, ox, oy);
    ctx.imageSmoothingEnabled = false;
    p.composite(ctx);
    ctx.restore();
  }

  // 4. グリッド（zoom_min_zoom 以上 & 行数バジェット内のみ）
  if (
    showGrid &&
    zoom >= config.ui.grid_min_zoom &&
    docWidth <= config.ui.grid_max_lines &&
    docHeight <= config.ui.grid_max_lines
  ) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scale = zoom * dpr;
    const lineW = Math.max(1, dpr * 0.5) * 2; // 1 CSS px 相当
    const i0 = Math.max(0, Math.floor(-ox / scale));
    const i1 = Math.min(docWidth, Math.ceil((cw - ox) / scale));
    const j0 = Math.max(0, Math.floor(-oy / scale));
    const j1 = Math.min(docHeight, Math.ceil((ch - oy) / scale));
    const strong = config.ui.grid_strong_interval;

    for (let i = i0; i <= i1; i++) {
      const x = Math.round(ox + i * scale) + lineW / 2;
      ctx.beginPath();
      ctx.strokeStyle =
        i % strong === 0
          ? config.canvas.grid_line_color_strong
          : config.canvas.grid_line_color;
      ctx.lineWidth = lineW;
      ctx.moveTo(x, Math.max(0, oy));
      ctx.lineTo(x, Math.min(ch, oy + dhPx));
      ctx.stroke();
    }
    for (let j = j0; j <= j1; j++) {
      const y = Math.round(oy + j * scale) + lineW / 2;
      ctx.beginPath();
      ctx.strokeStyle =
        j % strong === 0
          ? config.canvas.grid_line_color_strong
          : config.canvas.grid_line_color;
      ctx.lineWidth = lineW;
      ctx.moveTo(Math.max(0, ox), y);
      ctx.lineTo(Math.min(cw, ox + dwPx), y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. ドキュメント枠線
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = config.theme.colors.border;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(
    ox + ctx.lineWidth / 2,
    oy + ctx.lineWidth / 2,
    Math.max(0, dwPx - ctx.lineWidth),
    Math.max(0, dhPx - ctx.lineWidth)
  );
  ctx.restore();
}
