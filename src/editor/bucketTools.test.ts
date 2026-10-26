import { describe, expect, it } from "vitest";
import { applyFill, replacePixels, type BucketParams } from "./bucketTools";
import { needsWorker } from "./workerHost";
import { packRGBA } from "./colorUtils";

/**
 * 特殊バケツツール（改訂版仕様書 4.2）と Worker 閾値判定（2.2）のテスト。
 * environment: node のため applyFill / needsWorker といった純関数のみ対象。
 */

const RED = packRGBA(255, 0, 0, 255);
const BLUE = packRGBA(0, 0, 255, 255);
const GREEN = packRGBA(0, 255, 0, 255);
const CLEAR = 0;

function params(over?: Partial<BucketParams>): BucketParams {
  return { color: BLUE, color2: GREEN, tolerance: 0, jitter: 0, ditherCell: 1, ...over };
}

/** 横 w 縦 h の単色レイヤー */
function solid(w: number, h: number, color: number): Uint32Array {
  return new Uint32Array(w * h).fill(color);
}

describe("applyFill — Flood Fill（連続同色領域のみ）", () => {
  it("Tolerance 0 では隣接する完全一致色のみが塗られる", () => {
    // 4x4: 左上 2x2 が赤、残りは青
    const px = Uint32Array.from([
      RED, RED, BLUE, BLUE,
      RED, RED, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
    ]);
    applyFill(px, 4, 4, 0, 0, "flood", params({ color: GREEN }));
    expect(Array.from(px)).toEqual([
      GREEN, GREEN, BLUE, BLUE,
      GREEN, GREEN, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
    ]);
  });

  it("離れた同色領域は Flood Fill では塗られない", () => {
    const px = Uint32Array.from([
      RED, BLUE, BLUE, RED,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
    ]);
    applyFill(px, 4, 4, 0, 0, "flood", params({ color: GREEN }));
    expect(px[0]).toBe(GREEN);
    expect(px[3]).toBe(RED); // 離れた赤はそのまま
  });

  it("Tolerance により近似色も対象になる（チェビシェフ距離）", () => {
    const nearRed = packRGBA(250, 5, 0, 255); // 最大差 5
    const px = Uint32Array.from([RED, nearRed, BLUE, BLUE]);
    applyFill(px, 2, 2, 0, 0, "flood", params({ color: GREEN, tolerance: 5 }));
    expect(px[0]).toBe(GREEN);
    expect(px[1]).toBe(GREEN);
    expect(px[2]).toBe(BLUE);
  });

  it("選択マスク外は探索自体が行われない", () => {
    const px = solid(4, 1, RED);
    const mask = Uint8Array.from([1, 1, 0, 0]);
    applyFill(px, 4, 1, 0, 0, "flood", params({ color: BLUE }), mask);
    expect(Array.from(px)).toEqual([BLUE, BLUE, RED, RED]);
  });

  it("範囲外の開始座標は何もしない", () => {
    const px = solid(2, 2, RED);
    applyFill(px, 2, 2, 5, 0, "flood", params({ color: BLUE }));
    expect(px.every((p) => p === RED)).toBe(true);
  });
});

describe("applyFill — Global Fill / Eraser Fill / Dither / Noise", () => {
  it("Global Fill は隣接を無視して離れた同色も塗る", () => {
    const px = Uint32Array.from([
      RED, BLUE, BLUE, RED,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
    ]);
    applyFill(px, 4, 4, 0, 0, "global", params({ color: GREEN }));
    expect(px[0]).toBe(GREEN);
    expect(px[3]).toBe(GREEN); // 離れた赤も塗られる
    expect(px[1]).toBe(BLUE);
  });

  it("Eraser Fill は対象領域を完全透明にする", () => {
    const px = solid(2, 2, RED);
    applyFill(px, 2, 2, 0, 0, "eraser", params());
    expect(px.every((p) => p === CLEAR)).toBe(true);
  });

  it("Dither Fill は (x+y)%2 で主色/副色を交互に塗る", () => {
    const px = solid(2, 2, RED);
    applyFill(px, 2, 2, 0, 0, "dither", params());
    expect(Array.from(px)).toEqual([BLUE, GREEN, GREEN, BLUE]);
  });

  it("Noise Fill は Jitter 0 なら主色のまま", () => {
    const px = solid(2, 2, packRGBA(128, 128, 128, 255));
    applyFill(px, 2, 2, 0, 0, "noise", params({ jitter: 0 }));
    expect(px.every((p) => p === BLUE)).toBe(true);
  });

  it("Noise Fill は Jitter>0 でもアルファと塗り色の色相は保つ", () => {
    const mid = packRGBA(128, 128, 255, 255); // 明度変化を検出しやすい中間色
    const px = solid(1, 1, packRGBA(128, 128, 128, 255));
    applyFill(px, 1, 1, 0, 0, "noise", params({ color: mid, jitter: 50 }));
    const a = (px[0] >>> 24) & 255;
    expect(a).toBe(255); // アルファは不変
    expect(px[0] & 255).toBeGreaterThan(0); // R/G/V がランダムに変動する
  });

  it("8192 相当の単色埋めでもスタックオーバーフローせず完了する（BFS・再帰なし）", () => {
    const size = 4096; // テスト高速化のため縮小（実運用では 8192x8192）
    const px = solid(size, size, RED);
    applyFill(px, size, size, 0, 0, "flood", params({ color: GREEN }));
    expect(px.every((p) => p === GREEN)).toBe(true);
  });
});

describe("applyFill — 進捗通知（Worker の進捗表示用）", () => {
  it("onProgress が完了時に総数へ到達する", () => {
    const size = 2048;
    const px = solid(size, size, RED);
    const calls: Array<[number, number]> = [];
    applyFill(px, size, size, 0, 0, "global", params({ color: BLUE }), null, (done, total) => {
      calls.push([done, total]);
    });
    expect(calls.length).toBeGreaterThan(1); // 途中経過が報告される
    const last = calls[calls.length - 1];
    expect(last[0]).toBe(last[1]);
    expect(last[1]).toBe(size * size);
    // 単調増加
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
    }
  });

  it("Flood Fill でも進捗が報告される", () => {
    const size = 2048;
    const px = solid(size, size, RED);
    let lastDone = -1;
    applyFill(px, size, size, 0, 0, "flood", params({ color: BLUE }), null, (done) => {
      lastDone = done;
    });
    expect(lastDone).toBeGreaterThan(0);
    expect(px[0]).toBe(BLUE);
  });
});

describe("replacePixels — 色置換（仕様書 4.3）", () => {
  it("指定色 A を B へ置換し、他の色は変えない", () => {
    const px = Uint32Array.from([RED, BLUE, RED, GREEN]);
    replacePixels(px, RED, GREEN, 0, null);
    expect(Array.from(px)).toEqual([GREEN, BLUE, GREEN, GREEN]);
  });

  it("Tolerance により近似色も置換対象になる", () => {
    const near = packRGBA(252, 3, 0, 255);
    const px = Uint32Array.from([RED, near, BLUE]);
    replacePixels(px, RED, GREEN, 5, null);
    expect(px[0]).toBe(GREEN);
    expect(px[1]).toBe(GREEN);
    expect(px[2]).toBe(BLUE);
  });

  it("mask で遮断されたピクセルは置換されない", () => {
    const px = Uint32Array.from([RED, RED]);
    const mask = Uint8Array.from([1, 0]);
    replacePixels(px, RED, GREEN, 0, mask);
    expect(Array.from(px)).toEqual([GREEN, RED]);
  });

  it("onProgress が完了時に総数へ到達する", () => {
    const px = solid(2048, 2048, RED);
    const calls: Array<[number, number]> = [];
    replacePixels(px, RED, BLUE, 0, null, (done, total) => calls.push([done, total]));
    expect(calls.length).toBeGreaterThan(1);
    const last = calls[calls.length - 1];
    expect(last[0]).toBe(last[1]);
    expect(px[0]).toBe(BLUE);
  });
});

describe("needsWorker — Worker 実行閾値（config: canvas.worker_pixel_threshold）", () => {
  it("閾値以上は Worker、未満はメインスレッド", () => {
    expect(needsWorker(1_000_000, 1_000_000)).toBe(true);
    expect(needsWorker(999_999, 1_000_000)).toBe(false);
    expect(needsWorker(16_777_216, 1_000_000)).toBe(true); // 4096x4096
  });

  it("閾値 0 以下は常にメインスレッド（無効値フォールバック）", () => {
    expect(needsWorker(1, 0)).toBe(false);
    expect(needsWorker(1, -5)).toBe(false);
  });
});
