import { afterEach, describe, expect, it } from "vitest";
import {
  docToDeviceRect,
  intersectRect,
  isEmptyRect,
  markDirty,
  resetDirty,
  takeDirty,
  unionRect,
  visibleDeviceRegion,
} from "./compositor";
import { segmentBounds } from "./drawTools";
import { fitViewState, type ViewState } from "./types";

/**
 * 合成の純関数テスト（改訂版仕様書 8: マイルストーン2）。
 * - ビューポート範囲（表示中ドキュメント範囲）の計算 — 画像全体サイズの Canvas を作らない
 * - ダーティ矩形の追跡（差分 ∩ ビューポートのみ再合成）
 * - 画面に合わせるズームの計算
 * environment: node のため canvas を触る経路は対象外（計算のみ検証）
 */

function view(over?: Partial<ViewState>): ViewState {
  return { zoom: 1, panX: 0, panY: 0, showGrid: false, ...over };
}

afterEach(() => {
  resetDirty();
});

describe("visibleDeviceRegion — 表示中ドキュメント範囲（doc全体を作らない根拠）", () => {
  it("ドキュメントが画面に収まるとき: ドキュメント全体 = 領域", () => {
    const r = visibleDeviceRegion(view(), 100, 100, 1, 50, 50);
    expect(r).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });

  it("拡大時（zoom64）: 領域はビューポートを超えない", () => {
    const r = visibleDeviceRegion(view({ zoom: 64 }), 300, 200, 1, 4096, 4096);
    expect(r.w).toBeLessThanOrEqual(300);
    expect(r.h).toBeLessThanOrEqual(200);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it("縮小時（4096 @1/16）: 画面に収まるドキュメント全体を領域とする", () => {
    const r = visibleDeviceRegion(
      view({ zoom: 1 / 16 }),
      300,
      300,
      1,
      4096,
      4096
    );
    expect(r).toEqual({ x: 0, y: 0, w: 256, h: 256 });
  });

  it("右へパン（panX>0）: 左側が領域から外れる", () => {
    const r = visibleDeviceRegion(view({ panX: 10 }), 100, 100, 1, 50, 50);
    expect(r).toEqual({ x: 10, y: 0, w: 50, h: 50 });
  });

  it("左へパン（panX<0）: 右端がドキュメント幅で切られる", () => {
    const r = visibleDeviceRegion(view({ panX: -25 }), 100, 100, 1, 50, 50);
    expect(r).toEqual({ x: 0, y: 0, w: 25, h: 50 });
  });

  it("ドキュメントが画面外 → 空矩形（描画対象なし）", () => {
    const offLeft = visibleDeviceRegion(view({ panX: -200 }), 100, 100, 1, 50, 50);
    expect(isEmptyRect(offLeft)).toBe(true);
    const offTop = visibleDeviceRegion(view({ panY: 300 }), 100, 100, 1, 50, 50);
    expect(isEmptyRect(offTop)).toBe(true);
  });

  it("DPR=2 でも領域はデバイス解像度でビューポートを超えない", () => {
    const r = visibleDeviceRegion(view({ zoom: 4 }), 300, 200, 2, 4096, 4096);
    expect(r.w).toBeLessThanOrEqual(600);
    expect(r.h).toBeLessThanOrEqual(400);
  });
});

describe("markDirty / takeDirty — 差分矩形の追跡（仕様書 7 性能）", () => {
  it("初期状態は空（未処理）: getComposite 側で全域合成にフォールバックする", () => {
    const d = takeDirty();
    expect(d).not.toBeNull();
    expect(isEmptyRect(d!)).toBe(true);
  });

  it("rect なし markDirty は範囲不明（null = ビューポート全体を再合成）", () => {
    markDirty();
    expect(takeDirty()).toBeNull();
    // 消費後は空に戻る
    expect(isEmptyRect(takeDirty()!)).toBe(true);
  });

  it("rect 指定 → その矩形が返る", () => {
    markDirty({ x: 10, y: 20, w: 5, h: 5 });
    expect(takeDirty()).toEqual({ x: 10, y: 20, w: 5, h: 5 });
  });

  it("複数回の markDirty は和集合になる", () => {
    markDirty({ x: 10, y: 20, w: 5, h: 5 });
    markDirty({ x: 0, y: 0, w: 2, h: 2 });
    expect(takeDirty()).toEqual({ x: 0, y: 0, w: 15, h: 25 });
  });

  it("全域マーク後は rect 指定では絞り込めない（安全側）", () => {
    markDirty();
    markDirty({ x: 1, y: 1, w: 1, h: 1 });
    expect(takeDirty()).toBeNull();
  });

  it("空 rect の markDirty は範囲不明扱い", () => {
    markDirty({ x: 0, y: 0, w: 0, h: 0 });
    expect(takeDirty()).toBeNull();
  });
});

describe("矩形ユーティリティ", () => {
  it("unionRect: 和集合（空は無視）", () => {
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 3, y: 4, w: 1, h: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 5,
    });
    expect(unionRect({ x: 0, y: 0, w: 0, h: 0 }, { x: 3, y: 4, w: 1, h: 1 })).toEqual({
      x: 3,
      y: 4,
      w: 1,
      h: 1,
    });
  });

  it("intersectRect: 重なり / 重なっていなければ空", () => {
    expect(
      intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })
    ).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(
      intersectRect({ x: 0, y: 0, w: 3, h: 3 }, { x: 5, y: 5, w: 3, h: 3 })
    ).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("docToDeviceRect: floor/ceil でデバイスピクセルを過不足なく覆う", () => {
    expect(docToDeviceRect({ x: 0, y: 0, w: 10, h: 10 }, view({ zoom: 2, panX: 10, panY: 10 }), 1)).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 20,
    });
    // 小数ズームでも端数ピクセルを含める（部分再合成の取りこぼし防止）
    const r = docToDeviceRect({ x: 1, y: 1, w: 1, h: 1 }, view({ zoom: 0.5 }), 1);
    expect(r.x).toBeLessThanOrEqual(0.5); // 左端を floor で覆う
    expect(r.x + r.w).toBeGreaterThanOrEqual(1); // 右端を ceil で覆う
  });
});

describe("fitViewState — 画面に合わせる（仕様書 3）", () => {
  it("ドキュメントが画面より小さいときは拡大して中央表示", () => {
    const fit = fitViewState(800, 600, 100, 100, 1 / 16, 64);
    expect(fit.zoom).toBe(6); // min(800/100, 600/100)
    expect(fit.panX).toBe(100); // (800 - 600) / 2
    expect(fit.panY).toBe(0);
  });

  it("4096x4096 を 1000x800 の画面に合わせる（縮小・中央寄せ）", () => {
    const fit = fitViewState(1000, 800, 4096, 4096, 1 / 16, 64);
    expect(fit.zoom).toBeCloseTo(800 / 4096, 6);
    expect(fit.panX).toBeCloseTo((1000 - 4096 * fit.zoom) / 2, 6);
    expect(fit.panY).toBeCloseTo(0, 6);
  });

  it("zoom_max / zoom_min でクランプされる", () => {
    expect(fitViewState(800, 600, 1, 1, 1 / 16, 64).zoom).toBe(64);
    expect(fitViewState(10, 10, 4096, 4096, 1 / 16, 64).zoom).toBe(1 / 16);
  });

  it("ビューポート未計測時は 1 倍を返す（呼び出し側ガードと二重防御）", () => {
    expect(fitViewState(0, 0, 100, 100, 1 / 16, 64).zoom).toBe(1);
  });
});

describe("segmentBounds — ストロークのダーティ矩形（doc 座標・移動分のみ）", () => {
  it("1 点（from=to）はブラシサイズぶんの正方形", () => {
    expect(segmentBounds({ x: 5, y: 5 }, { x: 5, y: 5 }, 1)).toEqual({
      x: 5,
      y: 5,
      w: 1,
      h: 1,
    });
    expect(segmentBounds({ x: 5, y: 5 }, { x: 5, y: 5 }, 3)).toEqual({
      x: 4,
      y: 4,
      w: 3,
      h: 3,
    });
  });

  it("線分は両端 + ブラシぶんの外接矩形（ストローク全体ではない）", () => {
    expect(
      segmentBounds({ x: 10, y: 10 }, { x: 14, y: 12 }, 1)
    ).toEqual({ x: 10, y: 10, w: 5, h: 3 });
    // 逆方向でも同じ
    expect(
      segmentBounds({ x: 14, y: 12 }, { x: 10, y: 10 }, 1)
    ).toEqual({ x: 10, y: 10, w: 5, h: 3 });
  });

  it("矩形外へはみ出すがドキュメント座標の負値も許容（flush 側でクランプ）", () => {
    const r = segmentBounds({ x: 0, y: 0 }, { x: 1, y: 0 }, 3);
    expect(r).toEqual({ x: -1, y: -1, w: 4, h: 3 }); // -1..2（2 点ぶんのブラシの和）
  });
});
