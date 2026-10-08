import { AlertTriangle, Info, X, XCircle } from "lucide-react";
import { closeErrorDialog, dismissToast, useNotices, type ToastLevel } from "./notify";

/** トーストのレベルごとの見た目（config.yaml のテーマカラーのみ使用） */
const TOAST_STYLE: Record<ToastLevel, { border: string; icon: typeof Info }> = {
  info: { border: "var(--color-accent)", icon: Info },
  warn: { border: "var(--color-accent-hover)", icon: AlertTriangle },
  error: { border: "var(--color-danger)", icon: XCircle },
};

/**
 * 通知の描画ホスト（仕様書 2.1）。
 * - 画面下部: 設定まわりのトースト
 * - 中央: 上限超過などのエラーダイアログ
 * App 直下に1つだけマウントする。
 */
export default function NotifyHost() {
  const { toasts, error } = useNotices();

  return (
    <>
      {error !== null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={closeErrorDialog}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-80 rounded p-4 shadow-xl"
            style={{
              background: "var(--color-panel)",
              border: "1px solid var(--color-danger)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2 font-semibold" style={{ color: "var(--color-danger)" }}>
              <XCircle size={16} />
              エラー
            </div>
            <p className="whitespace-pre-wrap text-sm">{error}</p>
            <div className="mt-4 flex justify-end">
              <button
                className="rounded px-3 py-1 font-semibold text-white"
                style={{ background: "var(--color-accent)" }}
                onClick={closeErrorDialog}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="pointer-events-none fixed inset-x-0 bottom-3 z-[80] flex flex-col items-center gap-1.5 px-3"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const style = TOAST_STYLE[t.level];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex max-w-[min(92vw,40rem)] items-start gap-2 rounded px-3 py-2 shadow-lg"
              style={{
                background: "var(--color-panel)",
                border: `1px solid ${style.border}`,
                color: "var(--color-text)",
              }}
            >
              <Icon
                size={15}
                className="mt-0.5 shrink-0"
                style={{ color: style.border }}
                aria-hidden
              />
              <span className="whitespace-pre-wrap break-words text-sm">{t.message}</span>
              <button
                className="ml-1 shrink-0 rounded p-0.5"
                style={{ color: "var(--color-text-muted)" }}
                title="閉じる"
                onClick={() => dismissToast(t.id)}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
