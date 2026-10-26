import { describe, expect, it } from "vitest";
import {
  bytesToUint32,
  cloneLayer,
  createBlankLayer,
  cropPixels,
  rectBytes,
  writeRectBytes,
  type Layer,
} from "./layerUtils";
import { sampleMergedPixel } from "./compositor";

/**
 * レイヤー本体（Uint32Array）のテスト（改訂版仕様書 8: マイルストーン4 / 4.5）。
 * - レイヤーは Canvas を持たず Uint32Array だけを持つ
 * - 履歴パッチ用のバイト列往復（Uint32Array ⇔ RGBA バイト列）
 * - 合成色サンプリング（Canvas 非経由の source-over）
 * environment: node のため document を触らない関数のみ対象。
 */

function layerOf(pixels: number[], width: number, height: number, over?: Partial<Layer>): Layer {
  return {
    id: "l1",
    name: "L",
    pixels: Uint32Array.from(pixels),
    width,
    height,
    visible: true,
    opacity: 100,
    ...over,
  };
}

/** packRGBA(r,g,b,a) 相当（リトルエンディアン ABGR） */
const pack = (r: number, g: number, b: number, a: number): number =>
  ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

describe("createBlankLayer / cloneLayer — Canvas を持たないレイヤー本体", () => {
  it("幅×高さぶんの Uint32Array を保持し canvas を持たない", () => {
    const l = createBlankLayer(4, 3, "空");
    expect(l.pixels).toBeInstanceOf(Uint32Array);
    expect(l.pixels.length).toBe(12);
    expect(l.width).toBe(4);
    expect(l.height).toBe(3);
    expect("canvas" in l).toBe(false);
    expect(l.pixels.every((p) => p === 0)).toBe(true);
  });

  it("fill 指定色は全ピクセルに入る", () => {
    const l = createBlankLayer(2, 2, "背景", "#ff0000");
    expect(l.pixels[0]).toBe(pack(255, 0, 0, 255));
    expect(l.pixels[3]).toBe(pack(255, 0, 0, 255));
  });

  it("複製は画素を独立コピーする（元を書き換えても影響しない）", () => {
    const src = createBlankLayer(2, 2, "元", "#00ff00");
    const copy = cloneLayer(src, "コピー");
    expect(copy.pixels).toEqual(src.pixels);
    expect(copy.pixels).not.toBe(src.pixels);
    copy.pixels[0] = 0;
    expect(src.pixels[0]).not.toBe(0);
  });
});

describe("cropPixels — クロップ（範囲外は透明で埋める）", () => {
  const pixels = Uint32Array.from([
    1, 2, 3, 4,
    5, 6, 7, 8,
    9, 10, 11, 12,
  ]);

  it("範囲内の切り出し", () => {
    const out = cropPixels(pixels, 4, 3, { x: 1, y: 1, w: 2, h: 2 });
    expect(Array.from(out!)).toEqual([6, 7, 10, 11]);
  });

  it("ドキュメント外は 0 埋め（drawImage と同挙動）", () => {
    const out = cropPixels(pixels, 4, 3, { x: 3, y: 2, w: 2, h: 2 });
    expect(Array.from(out!)).toEqual([12, 0, 0, 0]);
  });

  it("完全に外側 → 全域 0、負の開始も 0 埋め", () => {
    expect(Array.from(cropPixels(pixels, 4, 3, { x: 10, y: 10, w: 2, h: 2 })!)).toEqual([
      0, 0, 0, 0,
    ]);
    // 範囲 (-1,-1)〜(0,0) → 実体は (0,0) のみが入り、出力の右下 (col1,row1) へ配置される
    expect(Array.from(cropPixels(pixels, 4, 3, { x: -1, y: -1, w: 2, h: 2 })!)).toEqual([
      0, 0, 0, 1,
    ]);
  });
});

describe("rectBytes / writeRectBytes — 履歴パッチの往復", () => {
  it("切り出し → 書き戻しで元に戻る", () => {
    const pixels = Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const rect = { x: 1, y: 1, w: 2, h: 2 };
    const before = rectBytes(pixels, 4, 3, rect)!;
    expect(before.length).toBe(2 * 2 * 4);
    // 破壊
    pixels[5] = 999;
    pixels[10] = 999;
    writeRectBytes(pixels, 4, 3, rect, before);
    expect(Array.from(pixels)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("RGBA バイト列は Uint32 のメモリ表現と一致する", () => {
    const px = pack(1, 2, 3, 4);
    const bytes = rectBytes(Uint32Array.from([px]), 1, 1, { x: 0, y: 0, w: 1, h: 1 })!;
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it("範囲外 rect は null / 書き戻しは安全に無視", () => {
    const pixels = Uint32Array.from([1, 2, 3, 4]);
    expect(rectBytes(pixels, 2, 2, { x: 5, y: 5, w: 1, h: 1 })).toBeNull();
    expect(() =>
      writeRectBytes(pixels, 2, 2, { x: 5, y: 5, w: 1, h: 1 }, new Uint8ClampedArray(4))
    ).not.toThrow();
  });
});

describe("bytesToUint32", () => {
  it("アライン済みはビュー、非アラインはコピー", () => {
    const aligned = new Uint8ClampedArray(8);
    expect(bytesToUint32(aligned).length).toBe(2);
    const buffer = new ArrayBuffer(9);
    const odd = new Uint8ClampedArray(buffer, 1, 8);
    const view = bytesToUint32(odd);
    expect(view.length).toBe(2);
    view[0] = 123;
    expect(new Uint8ClampedArray(buffer, 1, 4)[0]).toBe(0); // 元バッファへ影響しない
  });
});

describe("sampleMergedPixel — Canvas を使わない合成色サンプリング", () => {
  it("単一レイヤーはそのピクセルを返す", () => {
    const l = layerOf([pack(10, 20, 30, 255)], 1, 1);
    expect(sampleMergedPixel([l], 0, 0)).toBe(pack(10, 20, 30, 255));
  });

  it("非表示レイヤーは無視される", () => {
    const bottom = layerOf([pack(255, 0, 0, 255)], 1, 1);
    const top = layerOf([pack(0, 255, 0, 255)], 1, 1, { visible: false });
    expect(sampleMergedPixel([bottom, top], 0, 0)).toBe(pack(255, 0, 0, 255));
  });

  it("不透明レイヤーの重なりは上層が勝つ", () => {
    const bottom = layerOf([pack(255, 0, 0, 255)], 1, 1);
    const top = layerOf([pack(0, 0, 255, 255)], 1, 1);
    expect(sampleMergedPixel([bottom, top], 0, 0)).toBe(pack(0, 0, 255, 255));
  });

  it("上層が 50% の場合、下層と半分ずつ混ざる", () => {
    const bottom = layerOf([pack(0, 0, 0, 255)], 1, 1);
    const top = layerOf([pack(255, 255, 255, 255)], 1, 1, { opacity: 50 });
    const px = sampleMergedPixel([bottom, top], 0, 0);
    const r = px & 255;
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(128);
  });

  it("透明な上層は下層を透過して見せる", () => {
    const bottom = layerOf([pack(200, 100, 50, 255)], 1, 1);
    const top = layerOf([pack(0, 0, 0, 0)], 1, 1);
    expect(sampleMergedPixel([bottom, top], 0, 0)).toBe(pack(200, 100, 50, 255));
  });

  it("範囲外は 0（完全透明）、全レイヤー透明も 0", () => {
    const l = layerOf([pack(1, 2, 3, 255)], 1, 1);
    expect(sampleMergedPixel([l], 1, 0)).toBe(0);
    expect(sampleMergedPixel([layerOf([0], 1, 1)], 0, 0)).toBe(0);
  });
});
