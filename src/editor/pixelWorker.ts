import { applyFill, replacePixels, type BucketParams } from "./bucketTools";
import { writeShape, type ShapeSpec } from "./shapeTools";
import { adjustPixels, type AdjustParams } from "./adjustTools";
import type { BucketMode, MirrorMode } from "../config/configTypes";

/**
 * ピクセル処理 Worker（改訂版仕様書 2.2: 重い画素処理は Worker で実行）。
 * メインスレッドから Transferable で渡されたピクセルコピーを操作し、
 * 結果のバッファを Transferable で返す。進捗は定期的に通知する。
 */

/** Worker へ送るバケツジョブ（pixels / mask は transfer で渡る独立バッファ） */
export interface BucketJobMessage {
  kind: "bucket";
  pixels: Uint32Array;
  width: number;
  height: number;
  startX: number;
  startY: number;
  mode: BucketMode;
  params: BucketParams;
  mask: Uint8Array | null;
}

/** Worker へ送る色置換ジョブ（pixels / mask は transfer で渡る独立バッファ） */
export interface ReplaceJobMessage {
  kind: "replace";
  pixels: Uint32Array;
  from: number;
  to: number;
  tolerance: number;
  mask: Uint8Array | null;
}

/** Worker へ送る図形ジョブ（pixels / mask は transfer で渡る独立バッファ） */
export interface ShapeJobMessage {
  kind: "shape";
  pixels: Uint32Array;
  width: number;
  height: number;
  spec: ShapeSpec;
  color: number;
  mask: Uint8Array | null;
  mirror: MirrorMode;
}

/** Worker へ送る色調整ジョブ（pixels / mask は transfer で渡る独立バッファ） */
export interface AdjustJobMessage {
  kind: "adjust";
  pixels: Uint32Array;
  params: AdjustParams;
  mask: Uint8Array | null;
}

/** Worker へ送るジョブの合流型 */
export type PixelJobMessage =
  | BucketJobMessage
  | ReplaceJobMessage
  | ShapeJobMessage
  | AdjustJobMessage;

/** Worker から返すメッセージ */
export type WorkerResponseMessage =
  | { kind: "progress"; done: number; total: number }
  | { kind: "done"; pixels: Uint32Array };

const workerScope = globalThis as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

workerScope.onmessage = (e: MessageEvent) => {
  const job = e.data as PixelJobMessage;
  const onProgress = (done: number, total: number): void => {
    workerScope.postMessage({ kind: "progress", done, total } satisfies WorkerResponseMessage);
  };
  if (job.kind === "bucket") {
    const { pixels, width, height, startX, startY, mode, params, mask } = job;
    applyFill(pixels, width, height, startX, startY, mode, params, mask, onProgress);
  } else if (job.kind === "replace") {
    const { pixels, from, to, tolerance, mask } = job;
    replacePixels(pixels, from, to, tolerance, mask, onProgress);
  } else if (job.kind === "shape") {
    const { pixels, width, height, spec, color, mask, mirror } = job;
    writeShape(
      pixels,
      width,
      height,
      spec,
      { color, mask, mirror },
      new Map(),
      (done, total) => onProgress(done, total)
    );
  } else if (job.kind === "adjust") {
    const { pixels, params, mask } = job;
    adjustPixels(pixels, params, mask, onProgress);
  } else {
    return;
  }
  // 結果バッファを Transferable で返す（コピーしない）
  workerScope.postMessage({ kind: "done", pixels: job.pixels } satisfies WorkerResponseMessage, [
    job.pixels.buffer,
  ]);
};
