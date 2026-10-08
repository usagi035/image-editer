import type { AppConfig } from "../config/configTypes";
import type { SelectionState, ViewState } from "./types";

export interface ViewportRenderParams {
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  docWidth: number;
  docHeight: number;
  view: ViewState;
  config: AppConfig;
  /** 選択領域のオーバーレイ（仕様書 4.3） */
  selection?: SelectionState | null;
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
  ctx.fillStyle = config.theme.background;
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
    zoom >= config.canvas.grid_min_zoom &&
    docWidth <= config.canvas.grid_max_lines &&
    docHeight <= config.canvas.grid_max_lines
  ) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scale = zoom * dpr;
    const lineW = dpr; // 1 CSS px 相当（高DPIは2デバイスpx）
    const i0 = Math.max(0, Math.floor(-ox / scale));
    const i1 = Math.min(docWidth, Math.ceil((cw - ox) / scale));
    const j0 = Math.max(0, Math.floor(-oy / scale));
    const j1 = Math.min(docHeight, Math.ceil((ch - oy) / scale));
    const strong = config.canvas.grid_strong_interval;

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

  // 5. 選択オーバーレイ（wand は半透明 tint、bbox は破線）
  if (p.selection) {
    const sel = p.selection;
    if (sel.tint) {
      ctx.save();
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, ox, oy);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sel.tint, 0, 0);
      ctx.restore();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = ox + sel.x * zoom * dpr;
    const sy = oy + sel.y * zoom * dpr;
    const sw = sel.w * zoom * dpr;
    const sh = sel.h * zoom * dpr;
    ctx.strokeStyle = config.canvas.selection_color;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([4 * Math.max(1, dpr), 4 * Math.max(1, dpr)]);
    ctx.strokeRect(
      sx + ctx.lineWidth / 2,
      sy + ctx.lineWidth / 2,
      Math.max(0, sw - ctx.lineWidth),
      Math.max(0, sh - ctx.lineWidth)
    );
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 6. ドキュメント枠線（最外周ピクセルを潰さないよう外側に描画する）
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = config.theme.border;
  const t = dpr; // 枠線太さ（デバイスpx）
  ctx.fillRect(ox - t, oy - t, dwPx + 2 * t, t); // 上
  ctx.fillRect(ox - t, oy + dhPx, dwPx + 2 * t, t); // 下
  ctx.fillRect(ox - t, oy, t, dhPx); // 左
  ctx.fillRect(ox + dwPx, oy, t, dhPx); // 右
  ctx.restore();
}
