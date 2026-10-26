import { describe, expect, it } from "vitest";
import { packRGBA } from "./colorUtils";
import { beginStroke, continueStroke } from "./drawTools";
import { createBlankLayer } from "./layerUtils";
import {
  constrainShapeEnd,
  mirrorShapes,
  shapePixelEstimate,
  shapePoints,
  writeShape,
  type ShapeSpec,
} from "./shapeTools";

/**
 * 図形ツール & ミラー描画（改訂版仕様書 4.1）のテスト。
 * 全関数が純関数（environment: node で実行可能）。
 */

const RED = packRGBA(255, 0, 0, 255);
const BLUE = packRGBA(0, 0, 255, 255);

function spec(kind: ShapeSpec["kind"], sx: number, sy: number, ex: number, ey: number, fill: ShapeSpec["fill"] = "outline"): ShapeSpec {
  return { kind, start: { x: sx, y: sy }, end: { x: ex, y: ey }, fill };
}

/** w x h の全 0 レイヤー配列 */
function blank(w: number, h: number): Uint32Array {
  return new Uint32Array(w * h);
}

describe("constrainShapeEnd — Shift 拘束（仕様書 4.1）", () => {
  it("直線: 45 度（8方向）へスナップ", () => {
    // 17 度程度の傾き → 水平（0 度）へ
    expect(constrainShapeEnd("line", { x: 0, y: 0 }, { x: 10, y: 3 }, true)).toEqual({ x: 10, y: 0 });
    // 73 度程度 → 垂直（90 度）へ
    expect(constrainShapeEnd("line", { x: 0, y: 0 }, { x: 3, y: 10 }, true)).toEqual({ x: 0, y: 10 });
    // ちょうど 45 度はそのまま
    expect(constrainShapeEnd("line", { x: 0, y: 0 }, { x: 7, y: 7 }, true)).toEqual({ x: 7, y: 7 });
    // 右上（-45 度）
    expect(constrainShapeEnd("line", { x: 5, y: 5 }, { x: 9, y: 1 }, true)).toEqual({ x: 9, y: 1 });
  });

  it("矩形: 正方形（辺長=長辺）", () => {
    expect(constrainShapeEnd("rect", { x: 0, y: 0 }, { x: 5, y: 2 }, true)).toEqual({ x: 5, y: 5 });
    // 左上方向へのドラッグも象限を維持
    expect(constrainShapeEnd("rect", { x: 5, y: 5 }, { x: 2, y: 4 }, true)).toEqual({ x: 2, y: 2 });
  });

  it("楕円: 正円", () => {
    expect(constrainShapeEnd("ellipse", { x: 1, y: 1 }, { x: 6, y: 3 }, true)).toEqual({ x: 6, y: 6 });
  });

  it("Shift なしはそのまま", () => {
    expect(constrainShapeEnd("line", { x: 0, y: 0 }, { x: 10, y: 3 }, false)).toEqual({ x: 10, y: 3 });
  });
});

describe("mirrorShapes — ミラー展開（仕様書 4.1）", () => {
  const s = spec("rect", 1, 2, 3, 4);

  it("none は原点のみ", () => {
    expect(mirrorShapes(s, 10, 10, "none")).toEqual([s]);
  });

  it("vertical（縦軸）は x を反転", () => {
    const out = mirrorShapes(s, 10, 8, "vertical");
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      kind: "rect",
      start: { x: 8, y: 2 },
      end: { x: 6, y: 4 },
      fill: "outline",
    });
  });

  it("horizontal（横軸）は y を反転", () => {
    const out = mirrorShapes(s, 10, 8, "horizontal");
    expect(out[1].start).toEqual({ x: 1, y: 5 });
    expect(out[1].end).toEqual({ x: 3, y: 3 });
  });

  it("both は 4 種類", () => {
    const out = mirrorShapes(s, 10, 8, "both");
    expect(out).toHaveLength(4);
    expect(out[3].start).toEqual({ x: 8, y: 5 });
  });
});

describe("shapePoints — ラスタ化", () => {
  it("直線: Bresenham で両端を含む", () => {
    const pts = shapePoints(spec("line", 0, 0, 3, 0));
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    const diag = shapePoints(spec("line", 0, 0, 2, 2));
    expect(diag).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("矩形: 枠のみは外周ピクセルのみ（コーナー重複なし）", () => {
    const pts = shapePoints(spec("rect", 0, 0, 2, 2, "outline"));
    expect(pts).toHaveLength(8); // 3x3 の外周
    const set = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(set.size).toBe(8);
    expect(set.has("1,1")).toBe(false); // 内部は含まない
  });

  it("矩形: 塗りは外接矩形をすべて含む", () => {
    const pts = shapePoints(spec("rect", 1, 1, 3, 2, "fill"));
    expect(pts).toHaveLength(3 * 2); // (3-1+1) x (2-1+1)
  });

  it("楕円: 外接矩形に収まり左右対称", () => {
    const pts = shapePoints(spec("ellipse", 0, 0, 8, 6, "outline"));
    const set = new Set(pts.map((p) => `${p.x},${p.y}`));
    // 左右対称: (x,y) が在れば (8-x, y) も在る
    for (const key of set) {
      const [x, y] = key.split(",").map(Number);
      expect(set.has(`${8 - x},${y}`)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(8);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(6);
    }
    // 上下端と左右端を打つ
    expect(set.has("4,0")).toBe(true);
    expect(set.has("4,6")).toBe(true);
    expect(set.has("0,3")).toBe(true);
    expect(set.has("8,3")).toBe(true);
  });

  it("楕円: 塗りは中心行を含む", () => {
    const pts = shapePoints(spec("ellipse", 0, 0, 8, 6, "fill"));
    const set = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(set.has("4,3")).toBe(true);
    expect(set.has("1,3")).toBe(true); // 中心行は幅広
    expect(set.has("0,0")).toBe(false); // コーナーは塗らない
    expect(set.has("8,0")).toBe(false);
  });
});

describe("writeShape — レイヤー書き込み", () => {
  it("矩形（塗り）を主色で書き込み、元値を touched に記録する", () => {
    const pixels = blank(8, 8);
    const touched = new Map<number, number>();
    writeShape(pixels, 8, 8, spec("rect", 1, 1, 2, 2, "fill"), { color: RED, mask: null, mirror: "none" }, touched);
    expect(pixels[1 * 8 + 1]).toBe(RED);
    expect(pixels[2 * 8 + 2]).toBe(RED);
    expect(pixels[0]).toBe(0); // 範囲外
    expect(touched.get(1 * 8 + 1)).toBe(0); // 変更前の値を記録
  });

  it("選択マスクの無い箇所は書き込まない（仕様書 4.3）", () => {
    const pixels = blank(8, 8);
    const mask = new Uint8Array(8 * 8);
    for (let x = 2; x <= 5; x++) mask[3 * 8 + x] = 1; // y=3 の x=2..5 のみ許可
    writeShape(pixels, 8, 8, spec("rect", 0, 0, 7, 7, "fill"), { color: RED, mask, mirror: "none" }, new Map());
    expect(pixels[3 * 8 + 2]).toBe(RED);
    expect(pixels[3 * 8 + 5]).toBe(RED);
    expect(pixels[3 * 8 + 1]).toBe(0); // マスク外
    expect(pixels[0]).toBe(0); // マスク外
  });

  it("ミラー描画で対称位置にも同時に書き込む", () => {
    const pixels = blank(8, 8);
    const touched = new Map<number, number>();
    // vertical（縦軸）: (1,2)-(2,2) の直線 → x=5,6 にも対称に出现
    writeShape(pixels, 8, 8, spec("line", 1, 2, 2, 2), { color: RED, mask: null, mirror: "vertical" }, touched);
    expect(pixels[2 * 8 + 1]).toBe(RED);
    expect(pixels[2 * 8 + 2]).toBe(RED);
    expect(pixels[2 * 8 + 5]).toBe(RED); // 8-1-2 = 5
    expect(pixels[2 * 8 + 6]).toBe(RED); // 8-1-1 = 6
    expect(pixels[2 * 8 + 3]).toBe(0);
  });

  it("ドキュメント外のピクセルは無視する", () => {
    const pixels = blank(4, 4);
    writeShape(pixels, 4, 4, spec("rect", -2, -2, 5, 5, "fill"), { color: RED, mask: null, mirror: "none" }, new Map());
    // 外接矩形がドキュメントを覆う塗り → クリップされて全ピクセルが書き込まれる
    expect(pixels[0]).toBe(RED);
    expect(pixels[15]).toBe(RED);
    // 輪郭のみの場合はドキュメント外の枠線は描かれず内部は変化しない
    const pixels2 = blank(4, 4);
    writeShape(pixels2, 4, 4, spec("rect", -2, -2, 5, 5, "outline"), { color: RED, mask: null, mirror: "none" }, new Map());
    expect(pixels2[0]).toBe(0); // (0,0) は外へはみ出した輪郭の内部
  });

  it("onProgress で完了/合計を通知する", () => {
    const pixels = blank(8, 8);
    const calls: [number, number][] = [];
    writeShape(pixels, 8, 8, spec("rect", 0, 0, 1, 3, "fill"), { color: RED, mask: null, mirror: "none" }, new Map(), (d, t) => calls.push([d, t]));
    expect(calls.length).toBe(4); // 4 行
    expect(calls[calls.length - 1]).toEqual([4, 4]);
  });

  it("塗りの書き込みは元値が同一でも上書きされる", () => {
    const pixels = blank(4, 4).fill(BLUE);
    const touched = new Map<number, number>();
    writeShape(pixels, 4, 4, spec("rect", 0, 0, 1, 1, "fill"), { color: BLUE, mask: null, mirror: "none" }, touched);
    // 同色なので実質無変更（履歴では commitStroke 側が無変化を除外する）
    expect(touched.size).toBe(4);
    expect(pixels[0]).toBe(BLUE);
  });
});

describe("shapePixelEstimate — Worker 閾値判定用の見積もり", () => {
  it("直線は最大軸長 + 1", () => {
    expect(shapePixelEstimate(spec("line", 0, 0, 4, 0))).toBe(5);
    expect(shapePixelEstimate(spec("line", 0, 0, 3, 5))).toBe(6);
  });

  it("塗りは外接矩形の面積・輪郭は外周の近似", () => {
    expect(shapePixelEstimate(spec("rect", 0, 0, 3, 3, "fill"))).toBe(16);
    expect(shapePixelEstimate(spec("rect", 0, 0, 3, 3, "outline"))).toBe(16);
  });
});

describe("ペンのミラー描画（仕様書 4.1）", () => {
  it("ストローク点と同時にミラー点へ押印する", () => {
    const layer = createBlankLayer(8, 8, "test", "#00000000");
    const s = beginStroke(layer, { color: RED, size: 1, erase: false, pixelPerfect: true, mirror: "vertical" }, { x: 1, y: 1 });
    expect(s).not.toBeNull();
    if (!s) return;
    continueStroke(s, { x: 2, y: 1 });
    expect(layer.pixels[1 * 8 + 1]).toBe(RED);
    expect(layer.pixels[1 * 8 + 2]).toBe(RED);
    // 縦軸ミラー: x' = 7 - x
    expect(layer.pixels[1 * 8 + 6]).toBe(RED);
    expect(layer.pixels[1 * 8 + 5]).toBe(RED);
    expect(layer.pixels[1 * 8 + 3]).toBe(0); // 中間は非押印
    expect(layer.pixels[1 * 8 + 4]).toBe(0);
  });

  it("both は上下左右 4 象限に押印する", () => {
    const layer = createBlankLayer(8, 8, "test", "#00000000");
    const s = beginStroke(layer, { color: RED, size: 1, erase: false, pixelPerfect: false, mirror: "both" }, { x: 2, y: 2 });
    if (!s) throw new Error("session should start");
    expect(layer.pixels[2 * 8 + 2]).toBe(RED);
    expect(layer.pixels[2 * 8 + 5]).toBe(RED); // x 反転
    expect(layer.pixels[5 * 8 + 2]).toBe(RED); // y 反転
    expect(layer.pixels[5 * 8 + 5]).toBe(RED); // 両方
  });

  it("ミラー描画中は Pixel-Perfect を無効化する", () => {
    const layer = createBlankLayer(8, 8, "test", "#00000000");
    const s = beginStroke(layer, { color: RED, size: 1, erase: false, pixelPerfect: true, mirror: "vertical" }, { x: 1, y: 1 });
    expect(s?.pixelPerfect).toBe(false);
  });
});
