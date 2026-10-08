import { describe, expect, it } from "vitest";
import { MemoryBudget, formatUsage, layerBytes, usagePercent } from "./memoryBudget";

/**
 * メモリ予算クラスの単体テスト（改訂版仕様書 2.2）。
 */
describe("MemoryBudget", () => {
  it("1レイヤーのバイト数は 幅×高さ×4", () => {
    expect(layerBytes(64, 64)).toBe(64 * 64 * 4);
    expect(layerBytes(0, 10)).toBe(0);
  });

  it("予算内なら許可される", () => {
    const budget = new MemoryBudget(1536); // MB
    const res = budget.canAllocate(
      { layerCount: 1, width: 512, height: 512, hasSelection: false },
      0
    );
    expect(res.ok).toBe(true);
  });

  it("予算超過なら拒否メッセージ付きで返る", () => {
    const budget = new MemoryBudget(1); // 1MB = 1,048,576 bytes
    // 512x512 は 1 レイヤーでちょうど 1,048,576 バイト → 追加レイヤーで超過
    const res = budget.canAllocate(
      { layerCount: 2, width: 512, height: 512, hasSelection: false },
      0
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("メモリ予算を超えています");
      expect(res.message).toContain("memory.budget_mb");
    }
  });

  it("選択マスクと履歴も合計に含める", () => {
    const budget = new MemoryBudget(10);
    const usage = budget.estimate({
      layerCount: 2,
      width: 100,
      height: 100,
      hasSelection: true,
      historyBytes: 1000,
    });
    expect(usage.layersBytes).toBe(2 * 100 * 100 * 4);
    expect(usage.selectionBytes).toBe(100 * 100);
    expect(usage.historyBytes).toBe(1000);
    expect(usage.totalBytes).toBe(usage.layersBytes + usage.selectionBytes + 1000);
    expect(usage.budgetBytes).toBe(10 * 1024 * 1024);
  });

  it("additionalBytes 分を足して判定する", () => {
    const budget = new MemoryBudget(1); // 1,048,576 bytes
    const parts = { layerCount: 1, width: 16, height: 16, hasSelection: false };
    // レイヤー分 1,024 bytes を引いた残りまでは許可
    expect(budget.canAllocate(parts, 1047552).ok).toBe(true);
    expect(budget.canAllocate(parts, 1047553).ok).toBe(false);
  });
});

describe("使用量の整形", () => {
  const budget = new MemoryBudget(1536);
  const usage = budget.estimate({
    layerCount: 1,
    width: 512,
    height: 512,
    hasSelection: false,
  });

  it("formatUsage は「使用 / 予算 MB」", () => {
    expect(formatUsage(usage)).toBe("1.0 / 1536.0 MB");
  });

  it("usagePercent は 0〜100", () => {
    expect(usagePercent(usage)).toBeCloseTo(100 / 1536, 5);
    expect(usagePercent({ ...usage, totalBytes: usage.budgetBytes * 10 })).toBe(100);
    expect(usagePercent({ ...usage, budgetBytes: 0 })).toBe(0);
  });
});
