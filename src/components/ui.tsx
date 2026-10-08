import type { ReactNode } from "react";

/** パネル内セクション見出し */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3
      className="px-3 py-1.5 font-semibold"
      style={{
        background: "var(--color-panel-alt)",
        borderBottom: "1px solid var(--color-border)",
        borderTop: "1px solid var(--color-border)",
        fontSize: "0.9em",
      }}
    >
      {children}
    </h3>
  );
}

/** 数値スライダー行 */
export function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
      <span className="w-16 shrink-0 text-app-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
        style={{ accentColor: "var(--color-accent)" }}
      />
      <span className="w-10 text-right font-mono-nums">
        {value}
        {suffix}
      </span>
    </label>
  );
}

/** チェックボックス行 */
export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--color-accent)" }}
      />
      <span>{label}</span>
    </label>
  );
}

/** 補助テキスト */
export function Hint({ text }: { text: string }) {
  return (
    <p className="text-app-muted" style={{ fontSize: "0.85em" }}>
      {text}
    </p>
  );
}

/** 小型アイコン/テキストボタン */
export function IconButton({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className="flex items-center gap-1 rounded px-1.5 py-1 disabled:cursor-not-allowed disabled:opacity-35"
      style={{
        background: "var(--color-panel-alt)",
        border: "1px solid var(--color-border)",
        color: danger ? "var(--color-danger)" : "var(--color-text)",
      }}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
