import { useConfig } from "./config/ConfigContext";

/**
 * 一時的な起動確認用画面（次機能: 画面レイアウト実装で置き換え）。
 * config.yaml の読み込み結果を表示する。
 */
export default function App() {
  const { config, source, loading, reload } = useConfig();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <h1 className="text-2xl font-bold" style={{ color: "var(--color-accent)" }}>
        {config.app.name}
      </h1>
      <p className="text-app-muted">
        v{config.app.version} / threshold: {config.canvas.full_feature_threshold}px
      </p>
      <p className="text-app-muted">
        {loading ? "config.yaml 読み込み中..." : `設定ソース: ${source}`}
      </p>
      <button
        onClick={() => void reload()}
        className="rounded px-3 py-1.5"
        style={{
          background: "var(--color-panel-alt)",
          border: "1px solid var(--color-border)",
        }}
      >
        設定を再読み込み
      </button>
    </div>
  );
}
