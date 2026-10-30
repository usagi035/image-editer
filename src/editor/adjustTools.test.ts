import { describe, expect, it } from "vitest";
import {
  ADJUST_LIMITS,
  adjustPixels,
  isIdentityAdjust,
  type AdjustParams,
} from "./adjustTools";
import { getA, getB, getG, getR, packRGBA } from "./colorUtils";

/**
 * 色調整（仕様書 4.4 HSV / 明度 / コントラスト）の純関数テスト。
 * Worker 化（MS9）により adjustPixels は Worker 内からも呼ばれる。
 */

const IDENTITY: AdjustParams = { hue: 0, saturation: 0, value: 0, contrast: 0 };

describe("isIdentityAdjust", () => {
  it("全パラメータ 0 のときだけ true", () => {
    expect(isIdentityAdjust(IDENTITY)).toBe(true);
    expect(isIdentityAdjust({ ...IDENTITY, hue: 1 })).toBe(false);
    expect(isIdentityAdjust({ ...IDENTITY, contrast: -1 })).toBe(false);
  });
});

describe("ADJUST_LIMITS", () => {
  it("仕様書 4.4 のスライダー範囲どおり", () => {
    expect(ADJUST_LIMITS.hue).toEqual({ min: -180, max: 180 });
    expect(ADJUST_LIMITS.saturation).toEqual({ min: -100, max: 100 });
    expect(ADJUST_LIMITS.value).toEqual({ min: -100, max: 100 });
    expect(ADJUST_LIMITS.contrast).toEqual({ min: -100, max: 100 });
  });
});

describe("adjustPixels", () => {
  it("Hue +120 で赤 → 緑になる", () => {
    const px = new Uint32Array([packRGBA(255, 0, 0, 255)]);
    adjustPixels(px, { ...IDENTITY, hue: 120 });
    const [out] = px;
    expect(getR(out)).toBe(0);
    expect(getG(out)).toBe(255);
    expect(getB(out)).toBe(0);
    expect(getA(out)).toBe(255);
  });

  it("コントラスト +100 で明度が寄る（clamp される）", () => {
    const px = new Uint32Array([packRGBA(200, 128, 64, 255)]);
    adjustPixels(px, { ...IDENTITY, contrast: 100 });
    const [out] = px;
    expect(getR(out)).toBe(255); // (200-128)*2+128 = 272 → 255
    expect(getG(out)).toBe(128); // (128-128)*2+128 = 128
    expect(getB(out)).toBe(0); // (64-128)*2+128 = 0
  });

  it("透過ピクセル（A=0）は変更しない", () => {
    const px = new Uint32Array([packRGBA(10, 20, 30, 0)]);
    adjustPixels(px, { ...IDENTITY, hue: 90, saturation: 100 });
    const [out] = px;
    expect(getA(out)).toBe(0);
    expect(getR(out)).toBe(10);
  });

  it("マスクは 1 のピクセルのみ処理する", () => {
    const px = new Uint32Array([
      packRGBA(255, 0, 0, 255),
      packRGBA(255, 0, 0, 255),
    ]);
    const mask = new Uint8Array([1, 0]);
    adjustPixels(px, { ...IDENTITY, hue: 120 }, mask);
    expect(getG(px[0])).toBe(255); // マスク 1 → 変更される
    expect(getR(px[1])).toBe(255); // マスク 0 → 変更されない
    expect(getG(px[1])).toBe(0);
  });

  it("恒等変換はピクセルを触らない", () => {
    const px = new Uint32Array([packRGBA(1, 2, 3, 4)]);
    adjustPixels(px, IDENTITY);
    expect(px[0]).toBe(packRGBA(1, 2, 3, 4));
  });

  it("onProgress が定期的に呼ばれる（Worker 進捗通知用）", () => {
    const px = new Uint32Array(1 << 17); // 131072 px → 65536 ごとに 2 回
    const calls: Array<[number, number]> = [];
    adjustPixels(px, { ...IDENTITY, hue: 10 }, null, (done, total) => {
      calls.push([done, total]);
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]).toEqual([0, px.length]);
    expect(calls[calls.length - 1][1]).toBe(px.length);
    expect(calls[calls.length - 1][0]).toBeGreaterThan(0);
  });
});
