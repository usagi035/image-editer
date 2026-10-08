/**
 * メモリ予算の管理クラス（改訂版仕様書 2.2）。
 * 全レイヤー + 選択マスク + 履歴の合計が memory.budget_mb を超える操作は拒否する。
 * - 1レイヤー = 幅×高さ×4 バイト（Uint32Array）
 * - 選択マスク = 幅×高さ バイト（Uint8Array）
 * - 履歴 = history モジュールが加算する（実装は MS5）
 */

export interface MemoryParts {
  /** 合計対象のレイヤー枚数 */
  layerCount: number;
  /** ドキュメント幅 */
  width: number;
  /** ドキュメント高さ */
  height: number;
  /** 選択マスクが存在するか */
  hasSelection: boolean;
  /** 履歴の合計バイト数（未実装時は省略） */
  historyBytes?: number;
}

export interface MemoryUsage {
  layersBytes: number;
  selectionBytes: number;
  historyBytes: number;
  totalBytes: number;
  budgetBytes: number;
}

/** 1レイヤーのバイト数（幅×高さ×4）。 */
export function layerBytes(width: number, height: number): number {
  return Math.max(0, Math.round(width)) * Math.max(0, Math.round(height)) * 4;
}

export class MemoryBudget {
  private budgetBytes: number;

  constructor(budgetMb: number) {
    this.budgetBytes = Math.max(1, budgetMb) * 1024 * 1024;
  }

  /** 現在の構成の使用量を推定する。 */
  estimate(parts: MemoryParts): MemoryUsage {
    const layersBytes = layerBytes(parts.width, parts.height) * Math.max(0, parts.layerCount);
    const selectionBytes =
      parts.hasSelection ? Math.max(0, parts.width) * Math.max(0, parts.height) : 0;
    const historyBytes = Math.max(0, parts.historyBytes ?? 0);
    return {
      layersBytes,
      selectionBytes,
      historyBytes,
      totalBytes: layersBytes + selectionBytes + historyBytes,
      budgetBytes: this.budgetBytes,
    };
  }

  /**
   * 指定した構成に additionalBytes を追加しても予算内かを判定する。
   * 超過時は拒否メッセージ付き。
   */
  canAllocate(
    parts: MemoryParts,
    additionalBytes: number
  ): { ok: true; usage: MemoryUsage } | { ok: false; usage: MemoryUsage; message: string } {
    const usage = this.estimate(parts);
    const total = usage.totalBytes + Math.max(0, additionalBytes);
    if (total <= usage.budgetBytes) return { ok: true, usage };
    const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      usage,
      message:
        `メモリ予算を超えています（必要 ${mb(total)} MB / 予算 ${mb(usage.budgetBytes)} MB）。\n` +
        `レイヤー数・画像サイズを減らすか、config.yaml の memory.budget_mb を増やしてください。`,
    };
  }
}

/** 使用量を「12.4 / 1536 MB」形式で整形する。 */
export function formatUsage(usage: MemoryUsage): string {
  const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
  return `${mb(usage.totalBytes)} / ${mb(usage.budgetBytes)} MB`;
}

/** 予算に対する使用割合（%）。 */
export function usagePercent(usage: MemoryUsage): number {
  if (usage.budgetBytes <= 0) return 0;
  return Math.min(100, (usage.totalBytes / usage.budgetBytes) * 100);
}
