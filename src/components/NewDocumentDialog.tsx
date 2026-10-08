import { useState } from "react";
import { useConfig } from "../config/ConfigContext";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (width: number, height: number) => void;
}

/** 新規ドキュメント作成ダイアログ（寸法は config.yaml の上限を参照） */
export default function NewDocumentDialog({ open, onClose, onCreate }: Props) {
  const { config } = useConfig();
  const [width, setWidth] = useState(config.canvas.default_width);
  const [height, setHeight] = useState(config.canvas.default_height);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const max = config.canvas.max_size;
  const submit = () => {
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
      setError("1 以上の数値を入力してください");
      return;
    }
    if (w > max || h > max) {
      setError(`上限は ${max}px です（config: canvas.max_size）`);
      return;
    }
    onCreate(w, h);
    setError(null);
    onClose();
  };

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
        <h2 className="mb-3 font-semibold">新規ドキュメント</h2>
        <div className="mb-2 flex items-center gap-2">
          <label className="w-8 text-app-muted" htmlFor="nd-w">
            幅
          </label>
          <input
            id="nd-w"
            type="number"
            min={1}
            max={max}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-full rounded px-2 py-1"
            style={{
              background: "var(--color-panel-alt)",
              border: "1px solid var(--color-border)",
            }}
          />
          <span className="text-app-muted">px</span>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <label className="w-8 text-app-muted" htmlFor="nd-h">
            高
          </label>
          <input
            id="nd-h"
            type="number"
            min={1}
            max={max}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            className="w-full rounded px-2 py-1"
            style={{
              background: "var(--color-panel-alt)",
              border: "1px solid var(--color-border)",
            }}
          />
          <span className="text-app-muted">px</span>
        </div>
        <p className="mb-2 text-app-muted" style={{ fontSize: "0.85em" }}>
          {config.canvas.default_width}×{config.canvas.default_height} はマインクラフトの
          1 ブロック = 16px 想定の既定値
        </p>
        {error && (
          <p className="mb-2" style={{ color: "var(--color-danger)" }}>
            {error}
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
            キャンセル
          </button>
          <button
            className="rounded px-3 py-1 font-semibold text-white"
            style={{ background: "var(--color-accent)" }}
            onClick={submit}
          >
            作成
          </button>
        </div>
      </div>
    </div>
  );
}
