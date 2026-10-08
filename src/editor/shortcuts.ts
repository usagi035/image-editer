/**
 * config.yaml の shortcuts.* を KeyboardEvent と照合する軽量エンジン。
 * 形式: "Ctrl+S", "G", "Space", "Ctrl+Plus"（'+' 区切り、大文字小文字は区別しない）
 */

interface ParsedShortcut {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function normalizeKey(key: string): string {
  switch (key.toLowerCase()) {
    case "plus":
      return "+";
    case "minus":
      return "-";
    case "space":
      return " ";
    case "esc":
      return "escape";
    default:
      return key.toLowerCase();
  }
}

export function parseShortcut(spec: string): ParsedShortcut {
  const parts = spec.split("+").map((s) => s.trim());
  const rawKey = parts[parts.length - 1] ?? "";
  const mods = parts.slice(0, -1).map((s) => s.toLowerCase());
  return {
    ctrl: mods.includes("ctrl") || mods.includes("control"),
    meta: mods.includes("meta") || mods.includes("cmd"),
    alt: mods.includes("alt"),
    shift: mods.includes("shift"),
    key: normalizeKey(rawKey),
  };
}

function keyMatches(e: KeyboardEvent, spec: ParsedShortcut): boolean {
  const pressed = e.key.toLowerCase();
  if (pressed === spec.key) return true;
  // Shift 押下で記号キーの表記が変わるものへの対応 (例: Ctrl++ / Ctrl+=)
  if (spec.key === "+" && (pressed === "+" || pressed === "=")) return true;
  return false;
}

/** config.yaml 由来のショートカット表記とイベントを照合する。 */
export function matchesShortcut(e: KeyboardEvent, spec?: string): boolean {
  if (!spec) return false;
  const s = parseShortcut(spec);
  // Ctrl は Mac では Cmd としても扱う
  if (s.ctrl && !(e.ctrlKey || e.metaKey)) return false;
  if (s.meta && !(e.metaKey || e.ctrlKey)) return false;
  if (!s.ctrl && !s.meta && (e.ctrlKey || e.metaKey)) return false;
  if (s.alt !== e.altKey) return false;
  if (s.shift !== e.shiftKey) return false;
  return keyMatches(e, s);
}

/** 入力欄へのキー入力をショートカット対象外にするか判定。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
