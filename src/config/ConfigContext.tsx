import { useCallback, useEffect, useMemo, useState } from "react";
import { load as parseYaml } from "js-yaml";
import type { AppConfig } from "./configTypes";
import { DEFAULT_CONFIG, deepMerge } from "./defaultConfig";

export type ConfigSource = "electron" | "file" | "default";

export interface ConfigContextValue {
  config: AppConfig;
  source: ConfigSource;
  loading: boolean;
  /** config.yaml を再読み込みする（ヘッダーの「設定再読み込み」から呼ぶ）。 */
  reload: () => Promise<void>;
}

import { createContext, useContext, type ReactNode } from "react";

const ConfigContext = createContext<ConfigContextValue | null>(null);

function applyTheme(config: AppConfig): void {
  const root = document.documentElement;
  const c = config.theme.colors;
  root.style.setProperty("--color-background", c.background);
  root.style.setProperty("--color-panel", c.panel);
  root.style.setProperty("--color-panel-alt", c.panel_alt);
  root.style.setProperty("--color-border", c.border);
  root.style.setProperty("--color-accent", c.accent);
  root.style.setProperty("--color-accent-hover", c.accent_hover);
  root.style.setProperty("--color-text", c.text);
  root.style.setProperty("--color-text-muted", c.text_muted);
  root.style.setProperty("--color-danger", c.danger);
  root.style.setProperty("--color-header", c.header);
  root.style.setProperty("--font-family-ui", config.theme.font.family);
  root.style.setProperty("--font-size-base", config.theme.font.base_size);
  root.style.setProperty("--font-family-mono", config.theme.font.mono_family);
  root.style.setProperty("--control-radius", config.theme.radius);
  root.style.setProperty(
    "--checker-a",
    config.canvas.checkerboard_color_a
  );
  root.style.setProperty(
    "--checker-b",
    config.canvas.checkerboard_color_b
  );
}

function parseConfig(text: string): AppConfig {
  const doc = parseYaml(text) as Partial<AppConfig> | undefined;
  if (!doc || typeof doc !== "object") {
    throw new Error("config.yaml のパース結果が空です");
  }
  return deepMerge(DEFAULT_CONFIG, doc);
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [source, setSource] = useState<ConfigSource>("default");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) Electron: ローカルファイルシステムの config.yaml
      const electronText = await window.electronAPI?.loadConfig?.();
      if (electronText) {
        setConfig(parseConfig(electronText));
        setSource("electron");
        return;
      }
      // 2) Web: public/config.yaml
      const res = await fetch(`./config.yaml?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        setConfig(parseConfig(await res.text()));
        setSource("file");
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn("[config] 読み込み失敗、既定値を使用します:", err);
      setConfig(DEFAULT_CONFIG);
      setSource("default");
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
    () => ({ config, source, loading, reload: load }),
    [config, source, loading, load]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig は ConfigProvider 配下でのみ使用できます");
  return ctx;
}
