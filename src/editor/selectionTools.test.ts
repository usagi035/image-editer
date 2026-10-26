import { describe, expect, it } from "vitest";
import {
  buildMaskSelection,
  buildSelectionMask,
  combineMasks,
  createRectSelection,
  createWandSelection,
  invertMask,
  maskBounds,
  matchesWithTolerance,
  selectAllSelection,
} from "./selectionTools";
import { packRGBA } from "./colorUtils";

/**
 * 範囲選択（改訂版仕様書 4.3）のテスト。
 * 選択演算・マスク合成は純関数（environment: node で実行可能）。
 */

const RED = packRGBA(255, 0, 0, 255);
const BLUE = packRGBA(0, 0, 255, 255);

/** w x h の単色レイヤー */
function solid(w: number, h: number, color: number): Uint32Array {
  return new Uint32Array(w * h).fill(color);
}

describe("matchesWithTolerance — チェビシェフ距離", () => {
  it("各チャンネル最大差が許容値以内なら同色", () => {
    const near = packRGBA(250, 5, 0, 255);
    expect(matchesWithTolerance(near, RED, 5)).toBe(true);
    expect(matchesWithTolerance(near, RED, 4)).toBe(false);
  });

  it("アルファも同じ基準で比較する", () => {
    const half = packRGBA(255, 0, 0, 128);
    expect(matchesWithTolerance(half, RED, 127)).toBe(true);
    expect(matchesWithTolerance(half, RED, 126)).toBe(false);
  });
});

describe("createRectSelection", () => {
  it("ドラッグ無しのクリックは 1x1 選択", () => {
    const sel = createRectSelection(3, 5, 3, 5, 16, 16);
    expect(sel).toEqual({ kind: "rect", x: 3, y: 5, w: 1, h: 1, mask: null });
  });

  it("両端のセルを含むインクルシブ・座標逆転も許容", () => {
    const sel = createRectSelection(5, 5, 2, 2, 16, 16);
    expect(sel).toEqual({ kind: "rect", x: 2, y: 2, w: 4, h: 4, mask: null });
  });

  it("バッファ外はクランプされる", () => {
    const sel = createRectSelection(-5, -5, 100, 100, 8, 8);
    expect(sel).toEqual({ kind: "rect", x: 0, y: 0, w: 8, h: 8, mask: null });
  });
});

describe("createWandSelection", () => {
  /** 4x4: 左上 2x2 が赤、残りは青 */
  const px = Uint32Array.from([
    RED, RED, BLUE, BLUE,
    RED, RED, BLUE, BLUE,
    BLUE, BLUE, BLUE, BLUE,
    BLUE, BLUE, BLUE, BLUE,
  ]);

  it("contiguous: 連続する同色領域のみを選択する", () => {
    const sel = createWandSelection(px, 4, 4, 0, 0, 0, true);
    expect(sel).not.toBeNull();
    expect(sel!.mask).not.toBeNull();
    expect(sel!.mask!.slice(0, 4)).toEqual(Uint8Array.from([1, 1, 0, 0]));
    expect(sel!.x).toBe(0);
    expect(sel!.y).toBe(0);
    expect(sel!.w).toBe(2);
    expect(sel!.h).toBe(2);
  });

  it("全域: 離れた同色ピクセルもすべて選択する", () => {
    const px2 = Uint32Array.from([
      RED, BLUE, BLUE, RED,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
    ]);
    const sel = createWandSelection(px2, 4, 4, 0, 0, 0, false);
    expect(sel!.mask![0]).toBe(1);
    expect(sel!.mask![3]).toBe(1); // 離れた赤も対象
    expect(sel!.w).toBe(4);
  });

  it("Tolerance により近似色も対象になる", () => {
    const px3 = solid(2, 1, RED);
    px3[1] = packRGBA(252, 3, 0, 255);
    const sel = createWandSelection(px3, 2, 1, 0, 0, 5, false);
    expect(sel!.mask![1]).toBe(1);
  });
});

describe("選択演算（combineMasks / invertMask / maskBounds）", () => {
  const a = Uint8Array.from([1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]); // 3x4
  const b = Uint8Array.from([0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  it("union は和集合になる", () => {
    expect(combineMasks(a, b, "union")).toEqual(
      Uint8Array.from([1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1])
    );
  });

  it("subtract は a から b を減算する", () => {
    expect(combineMasks(a, b, "subtract")).toEqual(
      Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])
    );
  });

  it("合成結果は元マスクを破壊しない", () => {
    const before = Array.from(a);
    combineMasks(a, b, "union");
    expect(Array.from(a)).toEqual(before);
  });

  it("invertMask は 0/1 を反転する", () => {
    expect(invertMask(Uint8Array.from([1, 0, 1]))).toEqual(
      Uint8Array.from([0, 1, 0])
    );
  });

  it("maskBounds は外接矩形を返し、空なら null", () => {
    expect(maskBounds(a, 3, 4)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(maskBounds(new Uint8Array(12), 3, 4)).toBeNull();
  });
});

describe("buildMaskSelection / selectAllSelection / buildSelectionMask", () => {
  it("空マスクの buildMaskSelection は null（選択なし）", () => {
    expect(buildMaskSelection(new Uint8Array(16), 4, 4)).toBeNull();
  });

  it("マスクから bbox 付きの選択状態を構築する", () => {
    const mask = new Uint8Array(16);
    mask[5] = 1; // (1,1)
    mask[6] = 1; // (2,1)
    mask[9] = 1; // (1,2)
    const sel = buildMaskSelection(mask, 4, 4);
    expect(sel).toEqual({ kind: "wand", x: 1, y: 1, w: 2, h: 2, mask });
  });

  it("selectAllSelection はドキュメント全体（mask なし）", () => {
    expect(selectAllSelection(8, 4)).toEqual({
      kind: "rect",
      x: 0,
      y: 0,
      w: 8,
      h: 4,
      mask: null,
    });
    expect(selectAllSelection(0, 4)).toBeNull();
  });

  it("buildSelectionMask: rect は bbox マスク、wand は既存マスクを返す", () => {
    const rectMask = buildSelectionMask(
      { kind: "rect", x: 1, y: 1, w: 2, h: 1, mask: null },
      4,
      4
    );
    expect(Array.from(rectMask!)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const wandMask = Uint8Array.from([1, 0, 0, 0]);
    const sel = { kind: "wand" as const, x: 0, y: 0, w: 1, h: 1, mask: wandMask };
    expect(buildSelectionMask(sel, 4, 1)).toBe(wandMask);
    expect(buildSelectionMask(null, 4, 4)).toBeNull();
  });
});
