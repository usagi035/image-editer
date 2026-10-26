import { applyFill, type BucketParams } from "./bucketTools";
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

/** Worker から返すメッセージ */
export type WorkerResponseMessage =
  | { kind: "progress"; done: number; total: number }
  | { kind: "done"; pixels: Uint32Array };

const workerScope = globalThis as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

workerScope.onmessage = (e: MessageEvent) => {
  const job = e.data as BucketJobMessage;
  if (job.kind !== "bucket") return;
  const { pixels, width, height, startX, startY, mode, params, mask } = job;
  applyFill(pixels, width, height, startX, startY, mode, params, mask, (done, total) => {
    workerScope.postMessage({ kind: "progress", done, total } satisfies WorkerResponseMessage);
  });
  // 結果バッファを Transferable で返す（コピーしない）
  workerScope.postMessage({ kind: "done", pixels } satisfies WorkerResponseMessage, [
    pixels.buffer,
  ]);
};
