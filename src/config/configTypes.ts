/**
 * config.yaml の型定義。
 * UI の色・フォント・閾値等は全てここ経由で参照し、ハードコードしない。
 */

export interface ThemeColors {
  background: string;
  panel: string;
  panel_alt: string;
  border: string;
  accent: string;
  accent_hover: string;
  text: string;
  text_muted: string;
  danger: string;
  header: string;
}

export interface ThemeFont {
  family: string;
  base_size: string;
  mono_family: string;
}

export interface ThemeConfig {
  colors: ThemeColors;
  font: ThemeFont;
  radius: string;
  density: string;
}

export interface CanvasConfig {
  full_feature_threshold: number;
  max_size: number;
  default_width: number;
  default_height: number;
  grid_line_color: string;
  grid_line_color_strong: string;
  selection_color: string;
  checkerboard_color_a: string;
  checkerboard_color_b: string;
  checker_cell_size: number;
  background_color: string;
}

export type BucketMode = "flood" | "global" | "noise" | "dither" | "eraser";

export interface ToolsConfig {
  pen: { size: number; max_size: number; pixel_perfect: boolean; default_color: string };
  eraser: { size: number; max_size: number };
  bucket: {
    mode: BucketMode;
    tolerance: number;
    jitter: number;
    dither_primary: string;
    dither_secondary: string;
    dither_pattern_size: number;
  };
  eyedropper: { sample_merged: boolean };
  replace: { tolerance: number };
  magic_wand: { tolerance: number; contiguous: boolean };
  adjustment: { hue: number; saturation: number; value: number; contrast: number };
  layers: { default_opacity: number; max_layers: number };
}

export interface UiConfig {
  show_grid: boolean;
  grid_min_zoom: number;
  grid_strong_interval: number;
  grid_max_lines: number;
  zoom_min: number;
  zoom_max: number;
  zoom_step: number;
  show_mode_banner: boolean;
}

export interface ExportConfig {
  default_format: string;
  scales: number[];
  jpeg_quality: number;
  webp_quality: number;
}

export interface AppMeta {
  name: string;
  version: string;
}

export interface AppConfig {
  app: AppMeta;
  theme: ThemeConfig;
  canvas: CanvasConfig;
  tools: ToolsConfig;
  ui: UiConfig;
  export: ExportConfig;
  shortcuts: Record<string, string>;
}
