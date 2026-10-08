import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useConfig } from "../config/ConfigContext";
import type { BucketMode } from "../config/configTypes";
import type {
  AdjustParams,
  AdjustParamKey,
} from "./adjustTools";
import type { ExportFormat } from "./ioTools";
import type { Layer } from "./layerUtils";
import { MemoryBudget, type MemoryUsage } from "./memoryBudget";
import { useEditorStore } from "./editorStore";
import { isTypingTarget, matchesShortcut } from "./shortcuts";
import type { SelectionState, ToolId, ViewportSize, ViewState } from "./types";

/**
 * エディタ公開 API（改訂版仕様書 1: 状態管理は Zustand）。
 *
 * - 型と Provider（設定同期・整合性補正・ショートカット）のみをこのモジュールが持つ
 * - 実体の状態とアクションは `editorStore.ts`（Zustand ストア）が保持する
 * - `useEditor()` は従来と同じ API でストアを購読する（呼び出し側は無変更）
 */

export type ReplaceScope = "selection" | "layer";

export interface PenOptions {
  size: number;
  pixelPerfect: boolean;
}

export interface BucketOptions {
  mode: BucketMode;
  tolerance: number;
  jitter: number;
}

export interface EditorContextValue {
  // --- ドキュメント ---
  docWidth: number;
  docHeight: number;
  /** ドキュメント名（保存時の既定ファイル名に使用） */
  docName: string;
  /** 全レイヤーを含めてリサイズ（仕様書 5） */
  setDocumentSize: (w: number, h: number) => void;
  /** 新規作成: 寸法変更 + レイヤー初期化を同時に行う */
  newDocument: (w: number, h: number) => void;
  /** 画像読み込み（dataUrl/objectURL）: ドキュメント置換 */
  loadImage: (src: string, name: string) => Promise<void>;
  /** 選択範囲（未選択時は全画面）で全レイヤーを切り出す */
  cropDocument: (x: number, y: number, w: number, h: number) => void;
  /** 書き出し（Electron 保存 or ブラウザDL）。戻り値は保存先（キャンセル時は null） */
  exportImage: (format: ExportFormat, scale: number) => Promise<string | null>;

  // --- ツール ---
  tool: ToolId;
  setTool: (t: ToolId) => void;

  // --- カラー ---
  primaryColor: string; // "#rrggbb"
  setPrimaryColor: (c: string) => void;
  secondaryColor: string;
  setSecondaryColor: (c: string) => void;
  swapColors: () => void;

  // --- ツールオプション ---
  pen: PenOptions;
  setPenSize: (n: number) => void;
  setPenPixelPerfect: (b: boolean) => void;
  eraserSize: number;
  setEraserSize: (n: number) => void;
  bucket: BucketOptions;
  setBucketMode: (m: BucketMode) => void;
  setBucketTolerance: (n: number) => void;
  setBucketJitter: (n: number) => void;

  // --- レイヤー（仕様書 4.5） ---
  layers: Layer[]; // index 0 = 下層
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  addLayer: () => void;
  duplicateLayer: (id: string) => void;
  deleteLayer: (id: string) => void;
  /** dir: +1 で上へ、-1 で下へ */
  moveLayer: (id: string, dir: 1 | -1) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  toggleLayerVisible: (id: string) => void;
  mergeDown: (id: string) => void;
  /** ピクセル変更時の再描画要求カウンタ */
  revision: number;
  bumpRevision: () => void;
  /** メモリ使用量（仕様書 3 のヘッダー表示 / 2.2 の予算管理） */
  memoryUsage: MemoryUsage;

  // --- 選択（仕様書 4.3） ---
  selection: SelectionState | null;
  setSelection: (sel: SelectionState | null) => void;
  clearSelection: () => void;
  wand: { tolerance: number; contiguous: boolean };
  setWandTolerance: (n: number) => void;
  setWandContiguous: (b: boolean) => void;

  // --- 色置換（仕様書 4.3） ---
  replace: { from: string; to: string; tolerance: number; scope: ReplaceScope };
  setReplaceFrom: (hex: string) => void;
  setReplaceTo: (hex: string) => void;
  setReplaceTolerance: (n: number) => void;
  setReplaceScope: (s: ReplaceScope) => void;

  // --- 色調整（仕様書 4.4） ---
  adjust: AdjustParams;
  adjustScope: ReplaceScope;
  setAdjustParam: (key: AdjustParamKey, value: number) => void;
  setAdjustScope: (s: ReplaceScope) => void;
  resetAdjust: () => void;
  /** 選択中レイヤーへ破壊的に適用（全レイヤーは MS9 のチェックで切替） */
  applyAdjust: () => void;

  // --- ビューポート ---
  view: ViewState;
  setView: Dispatch<SetStateAction<ViewState>>;
  viewportSize: ViewportSize;
  setViewportSize: Dispatch<SetStateAction<ViewportSize>>;
  /** anchor はビューポート座標(CSS px)。省略時は中心。 */
  setZoom: (zoom: number, anchor?: { x: number; y: number }) => void;
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void;
  resetZoom: () => void;
  toggleGrid: () => void;
}

/**
 * エディタ状態の配下に置く（状態本体は Zustand ストア）。
 * ここでは設定の同期・レイヤー整合性の補正・メモリ使用量の再計算・
 * ショートカット購読といった「ストアを補助する副作用」だけを実行する。
 */
export function EditorProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig();

  // config.yaml（再）読み込み時にストアへ反映する（ツール初期値・ズーム範囲・グリッド）
  useEffect(() => {
    useEditorStore.getState().syncFromConfig(config);
  }, [config]);

  // アクティブレイヤーの整合性（削除済みレイヤーを指している場合は末尾へ補正）
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useEffect(() => {
    if (layers.length === 0) return;
    if (!layers.some((l) => l.id === activeLayerId)) {
      useEditorStore.getState().setActiveLayerId(layers[layers.length - 1].id);
    }
  }, [layers, activeLayerId]);

  // メモリ使用量の再計算（仕様書 2.2: 予算チェックとヘッダー表示）
  const layerCount = useEditorStore((s) => s.layers.length);
  const docWidth = useEditorStore((s) => s.docWidth);
  const docHeight = useEditorStore((s) => s.docHeight);
  const hasSelection = useEditorStore((s) => s.selection !== null);
  const budgetMb = useEditorStore((s) => s.config.memory.budget_mb);
  useEffect(() => {
    const usage = new MemoryBudget(budgetMb).estimate({
      layerCount,
      width: docWidth,
      height: docHeight,
      hasSelection,
    });
    useEditorStore.setState({ memoryUsage: usage });
  }, [layerCount, docWidth, docHeight, hasSelection, budgetMb]);

  // config.yaml のショートカット（選択解除・ズーム・グリッド）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const store = useEditorStore.getState();
      if (e.key === "Escape") {
        // 選択解除
        store.clearSelection();
        return;
      }
      if (matchesShortcut(e, config.shortcuts.toggle_grid)) {
        e.preventDefault();
        store.toggleGrid();
      } else if (matchesShortcut(e, config.shortcuts.zoom_in)) {
        e.preventDefault();
        store.zoomBy(config.ui.zoom_step);
      } else if (matchesShortcut(e, config.shortcuts.zoom_out)) {
        e.preventDefault();
        store.zoomBy(1 / config.ui.zoom_step);
      } else if (matchesShortcut(e, config.shortcuts.zoom_reset)) {
        e.preventDefault();
        store.resetZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.shortcuts, config.ui.zoom_step]);

  return <>{children}</>;
}

/** Zustand ストアを購読する（従来の Context 版と同一の API）。 */
export function useEditor(): EditorContextValue {
  return useEditorStore((s) => s);
}
