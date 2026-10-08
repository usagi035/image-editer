import { useEffect, useRef, useState } from "react";
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
import { useEditor } from "../editor/EditorContext";
import type { ExportFormat } from "../editor/ioTools";
import { formatUsage, usagePercent } from "../editor/memoryBudget";
import { isTypingTarget, matchesShortcut } from "../editor/shortcuts";
import ExportDialog from "./ExportDialog";
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
 * ファイル操作・ズーム率表示・メモリ使用量
 */
export default function HeaderBar() {
  const { config, source, reload } = useConfig();
  const {
    docWidth,
    docHeight,
    view,
    zoomBy,
    resetZoom,
    toggleGrid,
    newDocument,
    loadImage,
    exportImage,
    memoryUsage,
  } = useEditor();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** ファイル読み込み（Electron ダイアログ or ブラウザ file input） */
  const openFile = async () => {
    setLoadError(null);
    try {
      if (window.electronAPI?.openImageFile) {
        const picked = await window.electronAPI.openImageFile();
        if (picked) await loadImage(picked.dataUrl, picked.name);
        return;
      }
      fileInputRef.current?.click();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "読み込みに失敗しました");
    }
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLoadError(null);
    try {
      const url = URL.createObjectURL(file);
      await loadImage(url, file.name);
      URL.revokeObjectURL(url);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "読み込みに失敗しました");
    }
  };

  // Ctrl+S: 既定形式・1x で即書き出し（config: shortcuts.save / export.*）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (matchesShortcut(e, config.shortcuts.save)) {
        e.preventDefault();
        void exportImage(
          config.export.default_format as ExportFormat,
          config.export.scales[0] ?? 1
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.export.default_format, config.export.scales, config.shortcuts.save, exportImage]);

  const accent = config.theme.accent;
  const muted = config.theme.text_muted;

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
      <HeaderButton label="開く" onClick={() => void openFile()} title="画像ファイルを読み込む（PNG/JPEG/WebP/GIF）">
        <FolderOpen size={15} />
      </HeaderButton>
      <HeaderButton
        label="保存"
        onClick={() => setExportOpen(true)}
        title={`エクスポート（${config.shortcuts.save} でも書き出し）`}
      >
        <Save size={15} />
      </HeaderButton>
      <HeaderButton
        label="設定再読み込み"
        onClick={() => void reload()}
        title={`config.yaml (${source}) を再読み込み`}
      >
        <RefreshCw size={15} />
      </HeaderButton>

      {/* 中央: ドキュメント情報 */}
      <div className="flex flex-1 items-center justify-center gap-2">
        <span className="text-app-muted font-mono-nums">
          {docWidth}×{docHeight}
        </span>
        {/* メモリ使用量（仕様書 3: 予算に対する割合、config: memory.budget_mb） */}
        <span
          className="font-mono-nums"
          style={{
            color: usagePercent(memoryUsage) >= 80 ? "var(--color-danger)" : muted,
            fontSize: "0.85em",
          }}
          title={`メモリ使用量 / 予算 ${Math.round(usagePercent(memoryUsage))}%（config: memory.budget_mb）`}
        >
          メモリ {formatUsage(memoryUsage)}
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

      {loadError && (
        <span className="mx-2" style={{ color: "var(--color-danger)", fontSize: "0.85em" }}>
          {loadError}
        </span>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void onFileSelected(e)}
      />

      <NewDocumentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={(w, h) => newDocument(w, h)}
      />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </header>
  );
}
