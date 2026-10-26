import { describe, expect, it } from "vitest";
import {
  clearRectInPlace,
  copyRect,
  pasteInto,
  getClipboardImage,
  setClipboardImage,
  setFloatingImage,
  getFloatingImage,
} from "./clipboardTools";
import { packRGBA } from "./colorUtils";

/**
 * 内部クリップボードと浮遊レイヤー（改訂版仕様書 4.3: コピー/切り取り/貼り付け）。
 * pixels 本体の操作は React 外の純関数（environment: node で実行可能）。
 */

const RED = packRGBA(255, 0, 0, 255);
const BLUE = packRGBA(0, 0, 255, 255);
const GREEN = packRGBA(0, 255, 0, 255);

/** 4x4 のレイヤー: (x,y) に座標由来の色を入れて識別可能にする */
function patterned(): Uint32Array {
  const px = new Uint32Array(16);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      px[y * 4 + x] = packRGBA(y * 16 + x, 0, 0, 255);
    }
  }
  return px;
}

describe("copyRect", () => {
  it("指定矩形を切り出す（行ごとに詰める）", () => {
    const px = patterned();
    const img = copyRect(px, 4, { x: 1, y: 1, w: 2, h: 2 }, null);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    // (1,1)=0x11, (2,1)=0x12, (1,2)=0x21, (2,2)=0x22
    expect(Array.from(img.pixels)).toEqual([
      px[1 * 4 + 1], px[1 * 4 + 2],
      px[2 * 4 + 1], px[2 * 4 + 2],
    ]);
  });

  it("mask で遮断されたピクセルは透明のまま", () => {
    const px = new Uint32Array(4).fill(RED);
    const mask = Uint8Array.from([1, 0, 1, 0]);
    const img = copyRect(px, 4, { x: 0, y: 0, w: 4, h: 1 }, mask);
    expect(Array.from(img.pixels)).toEqual([RED, 0, RED, 0]);
  });

  it("レイヤー外の矩形はクランプされる", () => {
    const px = patterned();
    const img = copyRect(px, 4, { x: 3, y: 3, w: 5, h: 5 }, null);
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(img.pixels[0]).toBe(px[15]);
  });
});

describe("clearRectInPlace（切り取り）", () => {
  it("矩形内を透明化し、外は触らない", () => {
    const px = new Uint32Array(4).fill(RED);
    clearRectInPlace(px, 4, { x: 1, y: 0, w: 2, h: 1 }, null);
    expect(Array.from(px)).toEqual([RED, 0, 0, RED]);
  });

  it("mask で遮断されたピクセルは残る", () => {
    const px = new Uint32Array(4).fill(RED);
    const mask = Uint8Array.from([1, 0, 1, 1]);
    clearRectInPlace(px, 4, { x: 0, y: 0, w: 4, h: 1 }, mask);
    expect(Array.from(px)).toEqual([0, RED, 0, 0]);
  });
});

describe("pasteInto（浮遊レイヤーの確定書き込み）", () => {
  it("配置位置へ全面置換（透明ピクセルも下地を上書き）", () => {
    const target = new Uint32Array(16).fill(BLUE);
    pasteInto(
      target,
      4,
      4,
      { pixels: Uint32Array.from([GREEN, 0]), width: 2, height: 1, x: 1, y: 1 },
      null
    );
    expect(target[1 * 4 + 1]).toBe(GREEN);
    expect(target[1 * 4 + 2]).toBe(0); // 透明も上書きされる
    expect(target[0]).toBe(BLUE); // 範囲外は不変
  });

  it("ドキュメント外へのはみ出しはクランプされる", () => {
    const target = new Uint32Array(4);
    pasteInto(
      target,
      2,
      2,
      { pixels: Uint32Array.from([RED, RED, RED, RED]), width: 2, height: 2, x: 1, y: 1 },
      null
    );
    expect(target[1 * 2 + 1]).toBe(RED); // (1,1) のみ書き込み
    expect(target[0]).toBe(0);
  });

  it("mask=0 の位置は書き込まない（選択外への貼り付け遮断）", () => {
    const target = new Uint32Array(4).fill(BLUE);
    const mask = Uint8Array.from([1, 0, 1, 1]);
    pasteInto(
      target,
      4,
      1,
      { pixels: Uint32Array.from([GREEN, GREEN]), width: 2, height: 1, x: 0, y: 0 },
      mask
    );
    // (0) は置換、(1) は mask で遮断、(2)(3) は貼り込み範囲外
    expect(Array.from(target)).toEqual([GREEN, BLUE, BLUE, BLUE]);
  });
});

describe("クリップボード/浮遊の状態保持", () => {
  it("クリップボードは保存した内容を保持する", () => {
    setClipboardImage({ pixels: Uint32Array.from([RED]), width: 1, height: 1 });
    expect(getClipboardImage()?.pixels[0]).toBe(RED);
    setClipboardImage(null);
    expect(getClipboardImage()).toBeNull();
  });

  it("浮遊レイヤーは位置と寸法を保持し解除できる", () => {
    setFloatingImage({
      pixels: Uint32Array.from([RED, BLUE]),
      width: 2,
      height: 1,
      x: 3,
      y: 4,
    });
    const fl = getFloatingImage();
    expect(fl).toMatchObject({ x: 3, y: 4, width: 2, height: 1 });
    setFloatingImage(null);
    expect(getFloatingImage()).toBeNull();
  });
});
