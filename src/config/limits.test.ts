import { describe, expect, it } from "vitest";
import { checkPixelLimit, maxEdgeLength } from "./limits";

/**
 * 画像サイズ上限チェックの単体テスト（改訂版仕様書 2.2 / 5.2）。
 */
describe("checkPixelLimit", () => {
  it("上限以内は null を返す", () => {
    expect(checkPixelLimit(32, 32, 1024)).toBeNull();
    expect(checkPixelLimit(8192, 8192, 67108864)).toBeNull();
    expect(checkPixelLimit(64, 64, 67108864)).toBeNull();
  });

  it("上限超過はエラーメッセージを返す", () => {
    const err = checkPixelLimit(33, 33, 1024);
    expect(err).not.toBeNull();
    expect(err).toContain("上限");
    expect(err).toContain("33×33");
    expect(err).toContain("1,089");
    expect(err).toContain("canvas.max_pixels");
  });

  it("1024px 上限なら 32x32 は通る", () => {
    expect(checkPixelLimit(32, 33, 1024)).not.toBeNull();
    expect(checkPixelLimit(32, 32, 1024)).toBeNull();
  });
});

describe("maxEdgeLength", () => {
  it("正方形ならこの辺長まで開ける", () => {
    expect(maxEdgeLength(1024)).toBe(32);
    expect(maxEdgeLength(67108864)).toBe(8192);
  });

  it("極小の上限でも 0 未満にならない", () => {
    expect(maxEdgeLength(1)).toBe(1);
  });
});
