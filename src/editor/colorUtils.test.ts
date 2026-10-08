import { describe, expect, it } from "vitest";
import { getA, getB, getG, getR, hexToRgba, hexToUint32, packRGBA, uint32ToHex } from "./colorUtils";

/**
 * 色変換ユーティリティの単体テスト（改訂版仕様書 7: 色変換は packRGBA/unpack 系が唯一の変換口）。
 */
describe("packRGBA / getR,G,B,A", () => {
  it("パック → アンパックの往復", () => {
    const px = packRGBA(10, 20, 30, 255);
    expect(getR(px)).toBe(10);
    expect(getG(px)).toBe(20);
    expect(getB(px)).toBe(30);
    expect(getA(px)).toBe(255);
  });

  it("リトルエンディアンの ABGR 並び（A<<24|B<<16|G<<8|R）", () => {
    // 仕様どおりの並びになっているか（エンディアン非依存の値）
    expect(packRGBA(0x11, 0x22, 0x33, 0x44) >>> 0).toBe(0x44332211);
  });

  it("範囲外の入力は 0-255 にマスクされる", () => {
    const px = packRGBA(256, -1, 511, 1);
    expect(getR(px)).toBe(0);
    expect(getG(px)).toBe(255);
    expect(getB(px)).toBe(255);
    expect(getA(px)).toBe(1);
  });
});

describe("hexToUint32 / uint32ToHex", () => {
  it("#rrggbb → Uint32（アルファは不透明）", () => {
    const px = hexToUint32("#ff8000");
    expect(getR(px)).toBe(255);
    expect(getG(px)).toBe(128);
    expect(getB(px)).toBe(0);
    expect(getA(px)).toBe(255);
  });

  it("#rrggbbaa → Uint32", () => {
    const px = hexToUint32("#00000080");
    expect(getA(px)).toBe(128);
  });

  it("#rgb 短縮形は展開される", () => {
    const px = hexToUint32("#f0a");
    expect(getR(px)).toBe(255);
    expect(getG(px)).toBe(0);
    expect(getB(px)).toBe(170);
    expect(getA(px)).toBe(255);
  });

  it("不正な値は透明黒にフォールバック", () => {
    expect(hexToUint32("#ggzzzz")).toBe(0x00000000);
    expect(hexToUint32("nope")).toBe(0x00000000);
  });

  it("Uint32 → #rrggbb の往復", () => {
    expect(uint32ToHex(hexToUint32("#123456"))).toBe("#123456");
  });
});

describe("hexToRgba", () => {
  it("#rrggbbaa を RGBA 各値に分解", () => {
    expect(hexToRgba("#11223344")).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x44 });
  });
});
