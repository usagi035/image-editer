import type { BucketJobMessage } from "./pixelWorker";

/**
 * Worker 実行基盤（改訂版仕様書 2.2: 進捗表示・キャンセル・編集ロック）。
 * - 対象ピクセル数が `canvas.worker_pixel_threshold` 以上の処理は Worker で実行する
 * - ピクセルはコピーして Transferable で転送（元レイヤーは完了まで触らない）
 * - キャンセルは Worker を破棄して結果を捨てる（画像は実行前の状態のまま）
 */

/** ストアへ公開する実行中ジョブの状態 */
export interface WorkerJobState {
  label: string;
  /** 進捗 0〜1 */
  progress: number;
}

export interface JobHandle {
  /** 完了: 結果ピクセル。キャンセル/失敗: null（画像は実行前のまま） */
  promise: Promise<Uint32Array | null>;
  cancel: () => void;
}

/** ピクセル数が閾値以上なら Worker 実行（仕様書 2.2） */
export function needsWorker(pixelCount: number, threshold: number): boolean {
  return threshold > 0 && pixelCount >= threshold;
}

/** バケツジョブを Worker で実行する（呼び出し側は必ず cancel か完了のどちらかで片付ける） */
export function runBucketJob(
  job: Omit<BucketJobMessage, "kind">,
  onProgress?: (progress: number) => void
): JobHandle {
  const worker = new Worker(new URL("./pixelWorker.ts", import.meta.url), {
    type: "module",
  });
  // 元レイヤーの配列は触らない（postMessage の転送で detach されるため独立コピーを渡す）
  const pixels = job.pixels.slice();
  const mask = job.mask ? job.mask.slice() : null;

  let cancelFn: (() => void) | null = null;
  const promise = new Promise<Uint32Array | null>((resolve) => {
    let settled = false;
    const finish = (value: Uint32Array | null) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(value);
    };
    cancelFn = () => finish(null); // キャンセル: 結果を破棄し画像は実行前のまま
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { kind: string; done?: number; total?: number; pixels?: Uint32Array };
      if (msg.kind === "progress") {
        const total = msg.total ?? 0;
        onProgress?.(total > 0 ? Math.min(1, (msg.done ?? 0) / total) : 0);
      } else if (msg.kind === "done" && msg.pixels) {
        finish(msg.pixels);
      }
    };
    worker.onerror = () => finish(null); // 失敗時も実行前の状態を維持
    worker.postMessage({ kind: "bucket", ...job, pixels, mask } satisfies BucketJobMessage, [
      pixels.buffer,
      ...(mask ? [mask.buffer] : []),
    ]);
  });

  return { promise, cancel: () => cancelFn?.() };
}
