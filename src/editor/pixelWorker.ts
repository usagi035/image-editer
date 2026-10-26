import { applyFill, replacePixels, type BucketParams } from "./bucketTools";
import type { BucketMode } from "../config/configTypes";

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

/** Worker へ送るジョブの合流型 */
export type PixelJobMessage = BucketJobMessage | ReplaceJobMessage;

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
  } else {
    return;
  }
  // 結果バッファを Transferable で返す（コピーしない）
  workerScope.postMessage({ kind: "done", pixels: job.pixels } satisfies WorkerResponseMessage, [
    job.pixels.buffer,
  ]);
};
