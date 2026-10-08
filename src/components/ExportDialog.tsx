import { useState } from "react";
import { useConfig } from "../config/ConfigContext";
import { useEditor } from "../editor/EditorContext";
import type { ExportFormat } from "../editor/ioTools";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * エクスポート（書き出し）ダイアログ（仕様書 5. データ入出力仕様）
 * 形式: PNG / JPEG / WebP、倍率: config.export.scales（1x/2x/4x/8x）
 */
export default function ExportDialog({ open, onClose }: Props) {
  const { config } = useConfig();
  const { exportImage, docWidth, docHeight, docName } = useEditor();
  const [format, setFormat] = useState<ExportFormat>(
    config.export.default_format as ExportFormat
  );
  const [scale, setScale] = useState<number>(config.export.scales[0] ?? 1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) return null;

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await exportImage(format, scale);
      setMessage(saved ? `書き出しました: ${saved}` : "キャンセルしました");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "書き出しに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const outW = Math.round(docWidth * scale);
  const outH = Math.round(docHeight * scale);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-72 rounded p-4 shadow-xl"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 font-semibold">エクスポート</h2>
        <label className="mb-2 flex items-center gap-2">
          <span className="w-8 text-app-muted">形式</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="flex-1 rounded px-2 py-1"
            style={{
              background: "var(--color-panel-alt)",
              border: "1px solid var(--color-border)",
            }}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label className="mb-2 flex items-center gap-2">
          <span className="w-8 text-app-muted">倍率</span>
          <select
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="flex-1 rounded px-2 py-1"
            style={{
              background: "var(--color-panel-alt)",
              border: "1px solid var(--color-border)",
            }}
          >
            {config.export.scales.map((s) => (
              <option key={s} value={s}>
                {s}x（{docWidth * s}×{docHeight * s}）
              </option>
            ))}
          </select>
        </label>
        <p className="mb-1 text-app-muted" style={{ fontSize: "0.85em" }}>
          出力: {outW}×{outH}px / {docName || "untitled"}
        </p>
        {format !== "png" && (
          <p className="mb-2 text-app-muted" style={{ fontSize: "0.85em" }}>
            品質: {Math.round(
              format === "jpeg" ? config.export.jpeg_quality : config.export.webp_quality
            )}
            %（config: export.{format === "jpeg" ? "jpeg" : "webp"}_quality）
            {format === "jpeg" && ` / 背景 ${config.export.jpeg_background}`}
          </p>
        )}
        {message && (
          <p className="mb-2" style={{ color: "var(--color-text-muted)", fontSize: "0.85em" }}>
            {message}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded px-3 py-1"
            style={{
              background: "var(--color-panel-alt)",
              border: "1px solid var(--color-border)",
            }}
            onClick={onClose}
          >
            閉じる
          </button>
          <button
            className="rounded px-3 py-1 font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--color-accent)" }}
            disabled={busy}
            onClick={() => void run()}
          >
            書き出し
          </button>
        </div>
      </div>
    </div>
  );
}
