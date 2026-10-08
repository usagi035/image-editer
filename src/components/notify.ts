import { useSyncExternalStore } from "react";

/**
 * 通知（トースト / エラーダイアログ）のミニストア（改訂版仕様書 2.1）。
 * - 設定の不正値・読み込み失敗 → 画面下部のトースト
 * - 上限超過などの拒否 → エラーダイアログ
 * 状態管理ライブラリに依存しない購読ベースの実装（React 18 useSyncExternalStore）。
 */

export type ToastLevel = "info" | "warn" | "error";

export interface ToastItem {
  id: number;
  message: string;
  level: ToastLevel;
  createdAt: number;
}

export interface NoticeState {
  toasts: ToastItem[];
  error: string | null;
}

let seq = 0;
let toasts: ToastItem[] = [];
let error: string | null = null;
let snapshot: NoticeState = { toasts, error };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { toasts, error };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): NoticeState {
  return snapshot;
}

function getServerSnapshot(): NoticeState {
  return { toasts: [], error: null };
}

/** 画面下部にトーストを表示する（durationMs 後に自動で消える）。 */
export function showToast(message: string, level: ToastLevel = "info", durationMs = 6000): void {
  seq += 1;
  const item: ToastItem = { id: seq, message, level, createdAt: Date.now() };
  toasts = [...toasts, item];
  emit();
  window.setTimeout(() => dismissToast(item.id), durationMs);
}

/** 複数の警告を1つのトーストにまとめる（設定読み込み時の集約表示用）。 */
export function showWarnings(title: string, warnings: string[]): void {
  if (warnings.length === 0) return;
  const detail =
    warnings.length === 1
      ? warnings[0]
      : `${warnings[0]} ほか ${warnings.length - 1} 件（コンソール参照）`;
  showToast(`${title} ${detail}`, "warn", 10000);
  if (warnings.length > 1) console.warn(`[config] ${title}`, warnings);
}

export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** エラーダイアログ（拒否系のメッセージ）を表示する。 */
export function showErrorDialog(message: string): void {
  error = message;
  emit();
}

export function closeErrorDialog(): void {
  error = null;
  emit();
}

/** NotifyHost 用フック。 */
export function useNotices(): NoticeState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
