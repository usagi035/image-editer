/**
 * config.yaml の型定義（スキーマ v2 / 改訂版仕様書 2.1 準拠）。
 * UI の色・フォント・閾値等は全てここ経由で参照し、ハードコードしない。
 */

export interface ThemeConfig {
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
  /** font-family 相当（仕様書 theme.font） */
  font: string;
  font_size: string;
  font_mono: string;
  radius: string;
}

export interface CanvasConfig {
  /** 新規ドキュメントのデフォルト寸法 */
  default_width: number;
  default_height: number;
  /** 幅×高さの上限（仕様書 2.2: 既定 8192x8192 = 67108864） */
  max_pixels: number;
  /** これ以上のピクセル数の処理は Worker 対象（仕様書 2.2、実装は MS6） */
  worker_pixel_threshold: number;
  /** この倍率以上でグリッド線を表示 */
  grid_min_zoom: number;
  grid_strong_interval: number;
  /** グリッド描画する最大画素数（性能ガード） */
  grid_max_lines: number;
  /** ズーム範囲（1倍未満は 1/16, 1/8, 1/4, 1/2） */
  zoom_min: number;
  zoom_max: number;
  /** 【廃止予定】モード切替閾値（改訂版 2.2 でモード分け廃止、MS1 途中で削除） */
  full_feature_threshold: number;
  grid_line_color: string;
  grid_line_color_strong: string;
  selection_color: string;
  checkerboard_color_a: string;
  checkerboard_color_b: string;
  checker_cell_size: number;
  /** 新規キャンバス初期色（RGBA） */
  background_color: string;
}

/** 全レイヤー + 選択マスク + 履歴の合計メモリ上限（仕様書 2.2） */
export interface MemoryConfig {
  budget_mb: number;
}

/** Undo/Redo の上限（仕様書 4.6） */
export interface HistoryConfig {
  max_steps: number;
  max_memory_mb: number;
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
  zoom_step: number;
  show_mode_banner: boolean;
}

export interface ExportConfig {
  default_format: string;
  scales: number[];
  /** 0〜100（仕様書 2.1 の export.jpeg_quality と同じ尺度） */
  jpeg_quality: number;
  /** JPEG の透過部分を塗る背景色 */
  jpeg_background: string;
  /** 0〜100 */
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
  memory: MemoryConfig;
  history: HistoryConfig;
  tools: ToolsConfig;
  ui: UiConfig;
  export: ExportConfig;
  shortcuts: Record<string, string>;
}
