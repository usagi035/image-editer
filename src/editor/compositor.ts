import type { Layer } from "./layerUtils";
import { getA, getB, getG, getR, packRGBA } from "./colorUtils";
import type { Rect, ViewState } from "./types";

/**
 * レイヤー合成（改訂版仕様書 4.5 合成 / 2.2 表示 / 7 性能）。
 *
 * - 合成キャッシュは「表示中のビューポート範囲」のデバイス領域のみを保持する。
 *   **画像全体サイズの Canvas は作らない**（8192x8192 でもキャッシュは画面サイズ上限）。
 * - revision 変更時は `markDirty` された差分矩形（doc 座標）∩ ビューポート範囲のみ再合成し、
 *   範囲不明（null）時はビューポート全体を安全側として再合成する。
 * - パン / ズームで範囲が変わった場合はビューポート範囲を丸ごと再合成する。
 *
 * ダーティ矩形はモジュール変数で管理し、合成時（getComposite のミス経路）に消費する。
 * revision を増やす全経路は `markDirty()` を呼ぶこと（未マークの revision 変更は
 * 「範囲不明 → 全域再合成」にフォールバックして安全側に倒す）。
 */

/** 合成キャッシュ（画面デバイス座標の矩形のみを保持） */
export interface CompositeCache {
  canvas: HTMLCanvasElement;
  /** キャンバスが表す領域（画面デバイス座標・整数）。w/h = 0 なら画面外 */
  region: Rect;
  /** パン / ズーム / ビューポートサイズ / DPR 依存のキー（領域変更の検出） */
  regionKey: string;
  /** 合成済み revision */
  revision: number;
}

export interface CompositeInput {
  layers: Layer[];
  revision: number;
  view: ViewState;
  /** ビューポートの CSS px サイズ */
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  docWidth: number;
  docHeight: number;
}

// ============ ダーティ矩形（差分追跡） ============

/** 「何も未処理」を表す空矩形（dirty の初期値 / 消費後の状態） */
const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** null = 変更範囲不明（ドキュメント全体が変わった扱い） */
let dirty: Rect | null = EMPTY_RECT;

/**
 * ドキュメント変更を登録する。rect 省略 / null / 空矩形 → 範囲不明（全域）。
 * 範囲不明のままでは新たに絞り込めない（安全側）。
 */
export function markDirty(rect?: Rect | null): void {
  if (rect && rect.w > 0 && rect.h > 0) {
    if (dirty === null) return; // 既に全域（不明）→ 絞り込めない
    dirty = isEmptyRect(dirty) ? { ...rect } : unionRect(dirty, rect);
  } else {
    dirty = null; // 範囲不明 → 全域
  }
}

/** ダーティ矩形を消費して返す（呼び出し後に空になる） */
export function takeDirty(): Rect | null {
  const d = dirty;
  dirty = { ...EMPTY_RECT };
  return d;
}

/** ダーティ矩形を初期化する（テスト用） */
export function resetDirty(): void {
  dirty = { ...EMPTY_RECT };
}

// ============ 矩形の純関数 ============

export function isEmptyRect(r: Rect): boolean {
  return r.w <= 0 || r.h <= 0;
}

/** 和集合（どちらかが空なら非空側を返す） */
export function unionRect(a: Rect, b: Rect): Rect {
  if (isEmptyRect(a)) return isEmptyRect(b) ? { ...EMPTY_RECT } : { ...b };
  if (isEmptyRect(b)) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** 空間部分（重なっていなければ空矩形） */
export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w <= 0 || h <= 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x, y, w, h };
}

/** doc 座標の矩形を画面デバイス座標へ変換（floor/ceil で外接・過不足なく覆う） */
export function docToDeviceRect(r: Rect, view: ViewState, dpr: number): Rect {
  const sx = view.zoom * dpr;
  const ox = view.panX * dpr;
  const oy = view.panY * dpr;
  const x0 = Math.floor(r.x * sx + ox);
  const y0 = Math.floor(r.y * sx + oy);
  const x1 = Math.ceil((r.x + r.w) * sx + ox);
  const y1 = Math.ceil((r.y + r.h) * sx + oy);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 表示中のドキュメント範囲を画面デバイス座標の整数矩形で返す。
 * ビューポート外（ドキュメントが画面外）なら空矩形。
 */
export function visibleDeviceRegion(
  view: ViewState,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  docWidth: number,
  docHeight: number
): Rect {
  const cw = Math.max(1, Math.round(cssWidth * dpr));
  const ch = Math.max(1, Math.round(cssHeight * dpr));
  // doc x=0 → デバイス panX*dpr、doc x=docWidth → (docWidth*zoom + panX)*dpr
  const x0 = Math.floor(view.panX * dpr);
  const y0 = Math.floor(view.panY * dpr);
  const x1 = Math.ceil((docWidth * view.zoom + view.panX) * dpr);
  const y1 = Math.ceil((docHeight * view.zoom + view.panY) * dpr);
  const x = Math.max(0, x0);
  const y = Math.max(0, y0);
  const w = Math.min(cw, x1) - x;
  const h = Math.min(ch, y1) - y;
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x, y, w, h };
}

// ============ 合成 ============

/**
 * ビューポート範囲のみを合成したキャッシュを返す。
 * - revision・領域が一致 → キャッシュ再利用
 * - 領域一致・revision 変更 → ダーティ矩形 ∩ ビューポートのみ再合成
 * - 領域変更 / ダーティ不明 → ビューポート範囲を丸ごと再合成
 */
export function getComposite(
  cache: CompositeCache | null,
  input: CompositeInput
): CompositeCache {
  const { layers, revision, view, dpr, docWidth, docHeight } = input;
  const region = visibleDeviceRegion(
    view,
    input.cssWidth,
    input.cssHeight,
    dpr,
    docWidth,
    docHeight
  );
  const regionKey = `${region.x},${region.y},${region.w},${region.h}@${view.zoom}:${dpr}:${input.cssWidth}x${input.cssHeight}`;
  const canvas = cache?.canvas ?? document.createElement("canvas");

  // ドキュメントが画面外 → 描画対象なし（領域キーと revision だけ進める）
  if (region.w === 0 || region.h === 0) {
    return { canvas, region, regionKey, revision };
  }

  const sizeMatches = canvas.width === region.w && canvas.height === region.h;
  if (cache && cache.revision === revision && cache.regionKey === regionKey && sizeMatches) {
    return cache; // ヒット（ダーティは発生し得ない: revision 未変更）
  }

  const sameRegion =
    cache !== null && cache.regionKey === regionKey && sizeMatches;
  const dirtyNow = takeDirty(); // ミス経路でのみ消費

  let target = region;
  if (sameRegion) {
    if (dirtyNow !== null && !isEmptyRect(dirtyNow)) {
      target = intersectRect(docToDeviceRect(dirtyNow, view, dpr), region);
      if (isEmptyRect(target)) {
        // 変更が全てビューポート外 → キャッシュは有効のまま revision のみ更新
        return { canvas, region, regionKey, revision };
      }
    }
    // dirtyNow === null / 空 → 範囲不明（安全側）: ビューポート全体を再合成
  }

  if (canvas.width !== region.w || canvas.height !== region.h) {
    canvas.width = region.w; // サイズ変更で内容はクリアされる
    canvas.height = region.h;
  }
  compositeRegion(canvas, layers, view, dpr, region, target);
  return { canvas, region, regionKey, revision };
}

// ============ ピクセル → 描画用ソース（範囲のみ・常設 Canvas 禁止） ============

/**
 * 合成用の一時キャンバス / ImageData（**表示中範囲のソースだけ**を保持し、
 * 画像全体サイズには絶対に広げない。呼び出し間で再利用される）。
 */
let sourceCanvas: HTMLCanvasElement | null = null;
let sourceImage: ImageData | null = null;

/**
 * rect（doc 座標）のレイヤー内容を描画用ソースキャンバスへ移す。
 * 縮小表示（scale < 1）時は k ピクセルおきに間引いてソース寸法を画面サイズに抑える
 * （1/16 ズームで 8192² をそのまま作らないため）。最近傍サンプリングは drawImage 側で行う。
 */
export function layerSource(
  layer: Layer,
  rect: Rect,
  scale: number
): HTMLCanvasElement | null {
  if (rect.w <= 0 || rect.h <= 0) return null;
  const k = scale >= 1 ? 1 : Math.max(1, Math.round(1 / scale));
  const sw = Math.ceil(rect.w / k);
  const sh = Math.ceil(rect.h / k);
  if (!sourceCanvas) sourceCanvas = document.createElement("canvas");
  if (sourceCanvas.width !== sw || sourceCanvas.height !== sh) {
    sourceCanvas.width = sw;
    sourceCanvas.height = sh;
  }
  if (!sourceImage || sourceImage.width !== sw || sourceImage.height !== sh) {
    sourceImage = new ImageData(sw, sh);
  }
  const u32 = new Uint32Array(sourceImage.data.buffer);
  const lw = layer.width;
  if (k === 1) {
    // 等倍: 行コピーのみ（JS ループを回避）
    for (let row = 0; row < sh; row++) {
      const srcRow = (rect.y + row) * lw + rect.x;
      u32.set(layer.pixels.subarray(srcRow, srcRow + sw), row * sw);
    }
  } else {
    for (let row = 0; row < sh; row++) {
      const srcRow = (rect.y + row * k) * lw + rect.x;
      const dstRow = row * sw;
      for (let col = 0; col < sw; col++) {
        u32[dstRow + col] = layer.pixels[srcRow + col * k];
      }
    }
  }
  const ctx = sourceCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(sourceImage, 0, 0);
  return sourceCanvas;
}

/** キャンバス座標で target 領域をクリアしてからレイヤーを合成する */
function compositeRegion(
  canvas: HTMLCanvasElement,
  layers: Layer[],
  view: ViewState,
  dpr: number,
  region: Rect,
  target: Rect
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ox = target.x - region.x;
  const oy = target.y - region.y;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(ox, oy, target.w, target.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, target.w, target.h);
  ctx.clip();
  const scale = view.zoom * dpr;
  // doc 座標 → キャンバス座標（キャンバス原点 = region 左上）
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    view.panX * dpr - region.x,
    view.panY * dpr - region.y
  );
  ctx.imageSmoothingEnabled = false;
  // 再合成対象（target）に写るドキュメント範囲だけを切り出す
  const docRect = deviceToDocRect(target, view, dpr);
  // 下層 → 上層の順にアルファブレンド
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const rect = intersectLayerRect(docRect, layer);
    if (!rect) continue;
    const src = layerSource(layer, rect, scale);
    if (!src) continue;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 画面デバイス座標の矩形が写すドキュメント範囲（整数・レイヤー境界でクランプ） */
export function deviceToDocRect(r: Rect, view: ViewState, dpr: number): Rect {
  const scale = view.zoom * dpr;
  const ox = view.panX * dpr;
  const oy = view.panY * dpr;
  return {
    x: Math.floor((r.x - ox) / scale),
    y: Math.floor((r.y - oy) / scale),
    w: Math.ceil((r.x + r.w - ox) / scale) - Math.floor((r.x - ox) / scale),
    h: Math.ceil((r.y + r.h - oy) / scale) - Math.floor((r.y - oy) / scale),
  };
}

export function intersectLayerRect(r: Rect, layer: Layer): Rect | null {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const w = Math.min(layer.width, r.x + r.w) - x;
  const h = Math.min(layer.height, r.y + r.h) - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * 指定 doc 座標の合成色を 1px だけ取得する（スポイト用）。
 * Canvas を一切使わず、Uint32Array から source-over を直接計算する（仕様書 2.2 表示）。
 */
export function sampleMergedPixel(layers: Layer[], x: number, y: number): number {
  // straight alpha の合成色（0〜255 / 0〜1）
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    if (x < 0 || y < 0 || x >= layer.width || y >= layer.height) continue;
    const px = layer.pixels[y * layer.width + x];
    const alpha = (getA(px) / 255) * (layer.opacity / 100);
    if (alpha <= 0) continue;
    const outA = alpha + sa * (1 - alpha);
    if (outA <= 0) {
      sr = sg = sb = sa = 0;
      continue;
    }
    sr = (getR(px) * alpha + sr * sa * (1 - alpha)) / outA;
    sg = (getG(px) * alpha + sg * sa * (1 - alpha)) / outA;
    sb = (getB(px) * alpha + sb * sa * (1 - alpha)) / outA;
    sa = outA;
  }
  if (sa <= 0) return 0;
  return packRGBA(Math.round(sr), Math.round(sg), Math.round(sb), Math.round(sa * 255));
}
