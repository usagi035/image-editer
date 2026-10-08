import { useCallback, useEffect, useMemo, useState } from "react";
import { createContext, useContext, type ReactNode } from "react";
import { load as parseYaml } from "js-yaml";
import type { AppConfig } from "./configTypes";
import { DEFAULT_CONFIG } from "./defaultConfig";
import { validateConfig } from "./validate";
import { showToast, showWarnings } from "../components/notify";

export type ConfigSource = "electron" | "file" | "default";

export interface ConfigContextValue {
  config: AppConfig;
  source: ConfigSource;
  loading: boolean;
  /** 読み込み時に出た警告（不正値のフォールバック等） */
  warnings: string[];
  /** config.yaml を再読み込みする（ヘッダーの「設定再読み込み」から呼ぶ）。 */
  reload: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

/** テーマ（色・フォント・角丸・チェッカー色）を :root の CSS 変数へ適用する。 */
function applyTheme(config: AppConfig): void {
  const root = document.documentElement;
  const t = config.theme;
  root.style.setProperty("--color-background", t.background);
  root.style.setProperty("--color-panel", t.panel);
  root.style.setProperty("--color-panel-alt", t.panel_alt);
  root.style.setProperty("--color-border", t.border);
  root.style.setProperty("--color-accent", t.accent);
  root.style.setProperty("--color-accent-hover", t.accent_hover);
  root.style.setProperty("--color-text", t.text);
  root.style.setProperty("--color-text-muted", t.text_muted);
  root.style.setProperty("--color-danger", t.danger);
  root.style.setProperty("--color-header", t.header);
  root.style.setProperty("--font-family-ui", t.font);
  root.style.setProperty("--font-size-base", t.font_size);
  root.style.setProperty("--font-family-mono", t.font_mono);
  root.style.setProperty("--control-radius", t.radius);
  root.style.setProperty("--checker-a", config.canvas.checkerboard_color_a);
  root.style.setProperty("--checker-b", config.canvas.checkerboard_color_b);
}

/** YAML をパースし、不正値は既定値へフォールバックした設定と警告一覧を返す。 */
function parseConfig(text: string): { config: AppConfig; warnings: string[] } {
  const doc = parseYaml(text) as unknown;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("config.yaml のパース結果が空です");
  }
  return validateConfig(doc);
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [source, setSource] = useState<ConfigSource>("default");
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) Electron: userData/config.yaml（main プロセスが生成・優先される）
      const electronText = await window.electronAPI?.loadConfig?.();
      if (electronText) {
        const { config: parsed, warnings } = parseConfig(electronText);
        setConfig(parsed);
        setSource("electron");
        setWarnings(warnings);
        showWarnings("config.yaml:", warnings);
        return;
      }
      // 2) Web: public/config.yaml
      const res = await fetch(`./config.yaml?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const { config: parsed, warnings } = parseConfig(await res.text());
        setConfig(parsed);
        setSource("file");
        setWarnings(warnings);
        showWarnings("config.yaml:", warnings);
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn("[config] 読み込み失敗、既定値を使用します:", err);
      showToast(
        "config.yaml を読み込めないため、既定値で起動します（詳細はコンソール参照）",
        "warn"
      );
      setConfig(DEFAULT_CONFIG);
      setSource("default");
      setWarnings([err instanceof Error ? err.message : String(err)]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // テーマ（色・フォント）を :root へ適用
  useEffect(() => {
    applyTheme(config);
  }, [config]);

  const value = useMemo<ConfigContextValue>(
    () => ({ config, source, loading, warnings, reload: load }),
    [config, source, loading, warnings, load]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig は ConfigProvider 配下でのみ使用できます");
  return ctx;
}
