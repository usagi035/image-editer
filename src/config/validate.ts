import type { AppConfig } from "./configTypes";
import { DEFAULT_CONFIG } from "./defaultConfig";

/**
 * config.yaml の検証（改訂版仕様書 2.1）。
 * - 欠落キー: 既定値で補完（警告なし）
 * - 不正値（型違い・範囲外・色書式エラー）: 既定値にフォールバックし警告に記録
 * - 未知のキー: 無視し警告に記録
 * 警告は画面下部のトーストで表示され、アプリは起動を続行する。
 */

export interface ValidationResult {
  config: AppConfig;
  warnings: string[];
}

const HEX_OR_CSS_COLOR =
  /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]*\)|transparent)$/;

/** カラーとして扱うキー名（末尾一致 / 完全一致） */
const COLOR_SUFFIX = "_color";
const COLOR_NAMES = new Set([
  "background",
  "panel",
  "panel_alt",
  "border",
  "accent",
  "accent_hover",
  "text",
  "text_muted",
  "danger",
  "header",
  "jpeg_background",
  "selection_color",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => clone(x)) as unknown as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = clone(val);
    return out as T;
  }
  return v;
}

/** パスごとの数値範囲・書式チェック。修正した場合は警告を積む。 */
function normalize(path: string, value: unknown, warnings: string[]): unknown {
  const num = (v: unknown): number => Number(v);
  const clampNum = (v: unknown, min: number, max: number, label: string): number => {
    const n = num(v);
    if (n < min || n > max) {
      const c = Math.min(max, Math.max(min, n));
      warnings.push(`${path}: ${label}を ${min}〜${max} の範囲に収めました（${n} → ${c}）`);
      return c;
    }
    return n;
  };

  if (typeof value === "string") {
    const isColorKey =
      path.endsWith(COLOR_SUFFIX) || COLOR_NAMES.has(path.split(".").pop() ?? "");
    if (isColorKey && !HEX_OR_CSS_COLOR.test(value)) {
      warnings.push(`${path}: 色の書式が不正です（${value}）→ 既定値を使用します`);
      return undefined;
    }
  }

  if (typeof value !== "number") return value;

  switch (path) {
    case "canvas.max_pixels":
    case "canvas.worker_pixel_threshold":
    case "canvas.grid_min_zoom":
    case "canvas.grid_strong_interval":
    case "canvas.grid_max_lines":
    case "canvas.checker_cell_size":
    case "canvas.default_width":
    case "canvas.default_height":
    case "memory.budget_mb":
    case "history.max_steps":
    case "tools.pen.size":
    case "tools.pen.max_size":
    case "tools.eraser.size":
    case "tools.eraser.max_size":
      return clampNum(value, 1, Number.MAX_SAFE_INTEGER, "1 以上の値が必要です");
    case "history.max_memory_mb":
      return clampNum(value, 0, Number.MAX_SAFE_INTEGER, "0 以上の値が必要です");
    case "export.jpeg_quality":
    case "export.webp_quality":
      return clampNum(value, 0, 100, "品質は 0〜100 です");
    case "canvas.zoom_min":
      return clampNum(value, 1 / 1024, 1024, "ズーム最小倍率は 1/1024〜1024 です");
    case "canvas.zoom_max":
      return clampNum(value, 1 / 1024, 1024, "ズーム最大倍率は 1/1024〜1024 です");
    case "tools.bucket.tolerance":
    case "tools.replace.tolerance":
    case "tools.magic_wand.tolerance":
      return clampNum(value, 0, 255, "許容値は 0〜255 です");
    case "tools.bucket.jitter":
      return clampNum(value, 0, 100, "ノイズ強度は 0〜100 です");
    case "tools.layers.default_opacity":
      return clampNum(value, 0, 100, "不透明度は 0〜100 です");
    default:
      return value;
  }
}

function sanitize(base: unknown, value: unknown, path: string, warnings: string[]): unknown {
  if (isPlainObject(base)) {
    if (value === undefined) return clone(base);
    if (!isPlainObject(value)) {
      warnings.push(`${path}: セクションとして不正です（${typeOf(value)}）→ 既定値を使用します`);
      return clone(base);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) {
      out[key] = sanitize(
        (base as Record<string, unknown>)[key],
        value[key],
        path ? `${path}.${key}` : key,
        warnings
      );
    }
    for (const key of Object.keys(value)) {
      if (!(key in base)) warnings.push(`${path ? `${path}.${key}` : key}: 未知のキーのため無視します`);
    }
    return out;
  }

  // プリミティブ / 配列
  if (value === undefined) return clone(base);
  if (typeOf(value) !== typeOf(base)) {
    warnings.push(
      `${path}: 型が不正です（${typeOf(base)} が必要、${typeOf(value)} が指定）→ 既定値を使用します`
    );
    return clone(base);
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(value)) {
      warnings.push(`${path}: 配列が必要です → 既定値を使用します`);
      return clone(base);
    }
    if (base.every((x) => typeof x === "number") && !value.every((x: unknown) => typeof x === "number")) {
      warnings.push(`${path}: 数値の配列が必要です → 既定値を使用します`);
      return clone(base);
    }
    return clone(value);
  }
  const normalized = normalize(path, value, warnings);
  if (normalized === undefined) return clone(base);
  return normalized;
}

/** 不正値を既定値へフォールバックさせ、警告一覧を返す。 */
export function validateConfig(doc: unknown): ValidationResult {
  const warnings: string[] = [];
  const config = sanitize(DEFAULT_CONFIG, doc, "", warnings) as AppConfig;
  // 論理チェック（zoom_min < zoom_max など）
  if (config.canvas.zoom_min >= config.canvas.zoom_max) {
    warnings.push(
      `canvas.zoom_min/zoom_max: 最小が最大以上です → 既定値（${DEFAULT_CONFIG.canvas.zoom_min}〜${DEFAULT_CONFIG.canvas.zoom_max}）を使用します`
    );
    config.canvas.zoom_min = DEFAULT_CONFIG.canvas.zoom_min;
    config.canvas.zoom_max = DEFAULT_CONFIG.canvas.zoom_max;
  }
  return { config, warnings };
}
