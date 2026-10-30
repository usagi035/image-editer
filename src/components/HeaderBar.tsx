import { useEffect, useRef, useState } from "react";
import {
  Download,
  FilePlus,
  FolderOpen,
  Grid3X3,
  Maximize,
  Redo2,
  RefreshCw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useConfig } from "../config/ConfigContext";
import { useEditor } from "../editor/EditorContext";
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
    fitZoom,
    toggleGrid,
    newDocument,
    loadImage,
    loadOra,
    saveOra,
    memoryUsage,
    canUndo,
    canRedo,
    undo,
    redo,
    workerJob,
    cancelWorker,
  } = useEditor();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** ファイルをドキュメントへ読み込む（.ora はプロジェクトとして、他は単一レイヤー） */
  const openFromBytes = async (file: File) => {
    if (file.name.toLowerCase().endsWith(".ora")) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadOra(bytes, file.name);
    } else {
      const url = URL.createObjectURL(file);
      try {
        await loadImage(url, file.name);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  };

  /** ファイル読み込み（Electron ダイアログ or ブラウザ file input） */
  const openFile = async () => {
    setLoadError(null);
    try {
      if (window.electronAPI?.openImageFile) {
        const picked = await window.electronAPI.openImageFile();
        if (!picked) return;
        if (picked.name.toLowerCase().endsWith(".ora")) {
          // dataUrl の base64 部分を bytes にして .ora として読む
          const comma = picked.dataUrl.indexOf(",");
          const bin = atob(picked.dataUrl.slice(comma + 1));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          await loadOra(bytes, picked.name, picked.path);
        } else {
          await loadImage(picked.dataUrl, picked.name);
        }
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
      await openFromBytes(file);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "読み込みに失敗しました");
    }
  };

  // Ctrl+S: .ora プロジェクト保存（config: shortcuts.save / 仕様書 5.1）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (matchesShortcut(e, config.shortcuts.save)) {
        e.preventDefault();
        void saveOra();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.shortcuts.save, saveOra]);

  // ウィンドウタイトルにアプリ名とバージョンを表示（Electron も document.title を使用）
  useEffect(() => {
    document.title = `${config.app.name} v${config.app.version} “${config.app.codename}”`;
  }, [config.app.name, config.app.version, config.app.codename]);

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
      <span className="mr-1 font-semibold" style={{ color: accent }}>
        {config.app.name}
      </span>
      {/* バージョン（config: app.version / app.codename） */}
      <span
        className="mr-2 font-mono-nums"
        style={{ color: muted, fontSize: "0.75em" }}
        title={`バージョン ${config.app.version}「${config.app.codename}」（config: app.version / app.codename）`}
      >
        v{config.app.version} “{config.app.codename}”
      </span>
      <HeaderButton
        label="新規"
        onClick={() => setDialogOpen(true)}
        title="新規ドキュメントを作成"
      >
        <FilePlus size={15} />
      </HeaderButton>
      <HeaderButton label="開く" onClick={() => void openFile()} title="ファイルを開く（.ora / PNG / JPEG / WebP / GIF）">
        <FolderOpen size={15} />
      </HeaderButton>
      <HeaderButton
        label="保存"
        onClick={() => void saveOra()}
        title={`プロジェクトを .ora に保存（${config.shortcuts.save}・未保存は名前付き）`}
      >
        <Save size={15} />
      </HeaderButton>
      <HeaderButton
        label="書き出し"
        onClick={() => setExportOpen(true)}
        title="画像として書き出し（PNG / JPEG / WebP・解像度倍率対応）"
      >
        <Download size={15} />
      </HeaderButton>
      <HeaderButton
        label="元に戻す"
        disabled={!canUndo || workerJob !== null}
        onClick={undo}
        title={`元に戻す（${config.shortcuts.undo}）`}
      >
        <Undo2 size={15} />
      </HeaderButton>
      <HeaderButton
        label="やり直す"
        disabled={!canRedo || workerJob !== null}
        onClick={redo}
        title={`やり直す（${config.shortcuts.redo}）`}
      >
        <Redo2 size={15} />
      </HeaderButton>
      <HeaderButton
        label="設定再読み込み"
        onClick={() => void reload()}
        title={`config.yaml (${source}) を再読み込み`}
      >
        <RefreshCw size={15} />
      </HeaderButton>

      {/* 中央: ドキュメント情報 / Worker 実行進捗 */}
      <div className="flex flex-1 items-center justify-center gap-2">
        {workerJob ? (
          /* 進捗表示 + キャンセル（仕様書 2.2: 実行中は編集をロックしキャンセル可能） */
          <div className="flex items-center gap-2">
            <span className="font-mono-nums" style={{ fontSize: "0.85em" }}>
              {workerJob.label}中… {Math.round(workerJob.progress * 100)}%
            </span>
            <progress
              className="h-2 w-40"
              max={100}
              value={Math.round(workerJob.progress * 100)}
            />
            <button
              className="rounded px-2 py-0.5"
              style={{
                border: "1px solid var(--color-border)",
                color: "var(--color-danger)",
                fontSize: "0.85em",
              }}
              title="実行中の処理をキャンセル（画像は実行前の状態のまま）"
              onClick={cancelWorker}
            >
              キャンセル
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
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
          title={`画面に合わせる (${config.shortcuts.fit})`}
          onClick={fitZoom}
        >
          <Maximize size={15} />
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
        accept=".ora,image/openraster,image/png,image/jpeg,image/webp,image/gif"
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
