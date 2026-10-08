import type { AppConfig } from "./configTypes";

/**
 * config.yaml が読み込めなかった場合のフォールバック値。
 * 値は public/config.yaml と同一（ハードコード禁止の例外：安全網のみ）。
 */
export const DEFAULT_CONFIG: AppConfig = {
  app: { name: "Image Editor", version: "0.1.0" },
  theme: {
    colors: {
      background: "#1b1c22",
      panel: "#24262e",
      panel_alt: "#2c2f39",
      border: "#3a3e4b",
      accent: "#5b8cff",
      accent_hover: "#7aa3ff",
      text: "#e7e9f0",
      text_muted: "#99a0b5",
      danger: "#ff5f6d",
      header: "#17181e",
    },
    font: {
      family: "'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif",
      base_size: "13px",
      mono_family: "'Consolas', 'Menlo', monospace",
    },
    radius: "4px",
    density: "compact",
  },
  canvas: {
    full_feature_threshold: 512,
    max_size: 5000,
    default_width: 32,
    default_height: 32,
    grid_line_color: "rgba(255,255,255,0.07)",
    grid_line_color_strong: "rgba(255,255,255,0.16)",
    selection_color: "#5b8cff",
    checkerboard_color_a: "#3a3e4b",
    checkerboard_color_b: "#2b2e38",
    checker_cell_size: 8,
    background_color: "#00000000",
  },
  tools: {
    pen: { size: 1, max_size: 16, pixel_perfect: true, default_color: "#000000ff" },
    eraser: { size: 1, max_size: 16 },
    bucket: {
      mode: "flood",
      tolerance: 16,
      jitter: 30,
      dither_primary: "#000000ff",
      dither_secondary: "#ffffffff",
      dither_pattern_size: 2,
    },
    eyedropper: { sample_merged: true },
    replace: { tolerance: 16 },
    magic_wand: { tolerance: 16, contiguous: true },
    adjustment: { hue: 0, saturation: 0, value: 0, contrast: 0 },
    layers: { default_opacity: 100, max_layers: 64 },
  },
  ui: {
    show_grid: true,
    grid_min_zoom: 8,
    grid_strong_interval: 16,
    grid_max_lines: 1024,
    zoom_min: 0.05,
    zoom_max: 64,
    zoom_step: 1.25,
    show_mode_banner: true,
  },
  export: {
    default_format: "png",
    scales: [1, 2, 4, 8],
    jpeg_quality: 0.92,
    webp_quality: 0.92,
  },
  shortcuts: {
    save: "Ctrl+S",
    zoom_in: "Ctrl+Plus",
    zoom_out: "Ctrl+Minus",
    zoom_reset: "Ctrl+0",
    toggle_grid: "G",
    pan: "Space",
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 深いマージ（配列は置換）。部分的な yaml でも安全に動作する。
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T)) ?? base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const baseValue = (base as Record<string, unknown>)[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      out[key] = deepMerge(baseValue, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}
