import { useState } from "react";
import {
  FilePlus,
  FolderOpen,
  Grid3X3,
  RefreshCw,
  Save,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useConfig } from "../config/ConfigContext";
import { MODE_LABEL } from "../config/mode";
import { useEditor } from "../editor/EditorContext";
import NewDocumentDialog from "./NewDocumentDialog";

function HeaderButton({
  label,
  disabled,
  onClick,
  children,
  title,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      className="flex items-center gap-1.5 rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ border: "1px solid transparent" }}
      disabled={disabled}
      title={title}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--color-panel-alt)";
          e.currentTarget.style.borderColor = "var(--color-border)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/**
 * ヘッダー / メニューバー（仕様書 3. Header）
 * ファイル操作・ズーム率表示・モードバナー
 */
export default function HeaderBar() {
  const { config, source, reload } = useConfig();
  const {
    mode,
    docWidth,
    docHeight,
    view,
    zoomBy,
    resetZoom,
    toggleGrid,
    newDocument,
  } = useEditor();
  const [dialogOpen, setDialogOpen] = useState(false);

  const isPixel = mode === "pixel";
  const accent = config.theme.colors.accent;
  const muted = config.theme.colors.text_muted;

  return (
    <header
      className="flex h-10 shrink-0 items-center gap-1 px-2"
      style={{
        background: "var(--color-header)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* ファイル操作 */}
      <span className="mr-2 font-semibold" style={{ color: accent }}>
        {config.app.name}
      </span>
      <HeaderButton
        label="新規"
        onClick={() => setDialogOpen(true)}
        title="新規ドキュメントを作成"
      >
        <FilePlus size={15} />
      </HeaderButton>
      <HeaderButton
        label="開く"
        disabled
        title="ファイル読み込みは次の実装段階で有効化"
      >
        <FolderOpen size={15} />
      </HeaderButton>
      <HeaderButton label="保存" disabled title="保存は次の実装段階で有効化">
        <Save size={15} />
      </HeaderButton>
      <HeaderButton
        label="設定再読み込み"
        onClick={() => void reload()}
        title={`config.yaml (${source}) を再読み込み`}
      >
        <RefreshCw size={15} />
      </HeaderButton>

      {/* 中央: モードバナー */}
      <div className="flex flex-1 items-center justify-center gap-2">
        {config.ui.show_mode_banner && (
          <span
            className="rounded px-2 py-0.5 font-semibold"
            style={{
              background: isPixel ? accent : "var(--color-panel-alt)",
              color: isPixel ? "#ffffff" : muted,
              border: `1px solid ${isPixel ? accent : "var(--color-border)"}`,
            }}
            title={
              isPixel
                ? `全ツール利用可（<= ${config.canvas.full_feature_threshold}px）`
                : `描画ツール無効・ユーティリティのみ（> ${config.canvas.full_feature_threshold}px）`
            }
          >
            {MODE_LABEL[mode]}
          </span>
        )}
        <span className="text-app-muted font-mono-nums">
          {docWidth}×{docHeight}
        </span>
      </div>

      {/* ズーム操作 */}
      <div className="flex items-center gap-1">
        <button
          className="rounded p-1"
          title={`ズームアウト (${config.shortcuts.zoom_out})`}
          onClick={() => zoomBy(1 / config.ui.zoom_step)}
        >
          <ZoomOut size={15} />
        </button>
        <button
          className="w-14 rounded py-0.5 font-mono-nums"
          style={{ border: "1px solid var(--color-border)" }}
          title={`ズームリセット (${config.shortcuts.zoom_reset})`}
          onClick={resetZoom}
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button
          className="rounded p-1"
          title={`ズームイン (${config.shortcuts.zoom_in})`}
          onClick={() => zoomBy(config.ui.zoom_step)}
        >
          <ZoomIn size={15} />
        </button>
        <button
          className="rounded p-1"
          style={{
            background: view.showGrid ? "var(--color-panel-alt)" : "transparent",
            border: view.showGrid
              ? "1px solid var(--color-border)"
              : "1px solid transparent",
          }}
          title={`グリッド表示切替 (${config.shortcuts.toggle_grid})`}
          onClick={toggleGrid}
        >
          <Grid3X3 size={15} />
        </button>
      </div>

      <NewDocumentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={(w, h) => newDocument(w, h)}
      />
    </header>
  );
}
