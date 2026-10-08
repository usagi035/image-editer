import { describe, expect, it } from "vitest";
import { validateConfig } from "./validate";
import { DEFAULT_CONFIG } from "./defaultConfig";

/**
 * config.yaml 検証の単体テスト（改訂版仕様書 2.1）。
 * - 欠落キーは既定値で補完（警告なし）
 * - 不正値は既定値へフォールバック + 警告
 * - 未知のキーは無視 + 警告
 */
describe("validateConfig", () => {
  it("空オブジェクトは既定値と同じになる（欠落は無警告で補完）", () => {
    const { config, warnings } = validateConfig({});
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings).toEqual([]);
  });

  it("正しい値は上書きされ警告なしだ", () => {
    const { config, warnings } = validateConfig({
      canvas: { max_pixels: 16777216 },
      memory: { budget_mb: 2048 },
      theme: { accent: "#ff0000" },
    });
    expect(warnings).toEqual([]);
    expect(config.canvas.max_pixels).toBe(16777216);
    expect(config.memory.budget_mb).toBe(2048);
    expect(config.theme.accent).toBe("#ff0000");
    // 上書きしていないキーは既定値のまま
    expect(config.canvas.zoom_max).toBe(DEFAULT_CONFIG.canvas.zoom_max);
  });

  it("型が違う値は既定値へフォールバックし警告する", () => {
    const { config, warnings } = validateConfig({ canvas: { zoom_max: "abc" } });
    expect(config.canvas.zoom_max).toBe(DEFAULT_CONFIG.canvas.zoom_max);
    expect(warnings.some((w) => w.includes("canvas.zoom_max"))).toBe(true);
  });

  it("範囲外の品質値は 0〜100 に丸め警告する", () => {
    const { config, warnings } = validateConfig({
      export: { jpeg_quality: 300 },
    });
    expect(config.export.jpeg_quality).toBe(100);
    expect(warnings.some((w) => w.includes("export.jpeg_quality"))).toBe(true);
  });

  it("色の書式が不正なら既定値へ戻し警告する", () => {
    const { config, warnings } = validateConfig({
      theme: { accent: "not-a-color" },
    });
    expect(config.theme.accent).toBe(DEFAULT_CONFIG.theme.accent);
    expect(warnings.some((w) => w.includes("theme.accent"))).toBe(true);
  });

  it("rgba 形式の色は許容される", () => {
    const { config, warnings } = validateConfig({
      canvas: { grid_line_color: "rgba(0,0,0,0.5)" },
    });
    expect(warnings).toEqual([]);
    expect(config.canvas.grid_line_color).toBe("rgba(0,0,0,0.5)");
  });

  it("未知のキーは無視して警告する", () => {
    const { warnings } = validateConfig({ unknown_section: { a: 1 } });
    expect(warnings.some((w) => w.includes("unknown_section"))).toBe(true);
  });

  it("セクションがオブジェクト以外なら既定へ戻す", () => {
    const { config, warnings } = validateConfig({ tools: 42 });
    expect(config.tools).toEqual(DEFAULT_CONFIG.tools);
    expect(warnings.some((w) => w.includes("tools"))).toBe(true);
  });

  it("zoom_min >= zoom_max は論理チェックで既定へ戻す", () => {
    const { config, warnings } = validateConfig({
      canvas: { zoom_min: 8, zoom_max: 0.5 },
    });
    expect(config.canvas.zoom_min).toBe(DEFAULT_CONFIG.canvas.zoom_min);
    expect(config.canvas.zoom_max).toBe(DEFAULT_CONFIG.canvas.zoom_max);
    expect(warnings.some((w) => w.includes("zoom_min/zoom_max"))).toBe(true);
  });

  it("負の上限値は 1 以上へ丸める", () => {
    const { config } = validateConfig({ canvas: { max_pixels: -5 } });
    expect(config.canvas.max_pixels).toBe(1);
  });

  it("配列キーに数値以外が入ると既定へ戻す", () => {
    const { config, warnings } = validateConfig({ export: { scales: "x2" } });
    expect(config.export.scales).toEqual(DEFAULT_CONFIG.export.scales);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("部分指定でも他キーの型は保持される", () => {
    const { config } = validateConfig({ ui: { show_grid: false } });
    expect(config.ui.show_grid).toBe(false);
    expect(config.ui.zoom_step).toBe(DEFAULT_CONFIG.ui.zoom_step);
    expect(typeof config.theme.background).toBe("string");
  });
});
