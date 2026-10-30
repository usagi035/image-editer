import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useConfig } from "../config/ConfigContext";
import type { BucketMode, MirrorMode, ShapeFillMode } from "../config/configTypes";
import type {
  AdjustParams,
  AdjustParamKey,
} from "./adjustTools";
import type { ExportFormat } from "./ioTools";
import type { Layer } from "./layerUtils";
import { MemoryBudget, type MemoryUsage } from "./memoryBudget";
import { useEditorStore } from "./editorStore";
import { isTypingTarget, matchesShortcut } from "./shortcuts";
import type { WorkerJobState } from "./workerHost";
import type { BucketParams } from "./bucketTools";
import type { ShapeSpec } from "./shapeTools";
import type {
  Rect,
  SelectionState,
  ToolId,
  ViewportSize,
  ViewState,
} from "./types";

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

/** 図形ツール & ミラー描画のオプション（仕様書 4.1） */
export interface ShapeOptions {
  /** 矩形・楕円の塗りモード（枠のみ / 塗り） */
  fillMode: ShapeFillMode;
  /** ミラー描画の対称軸（ペン・消しゴム・図形に適用） */
  mirror: MirrorMode;
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
  /** バケツ実行（閾値以上は Worker・進捗表示とキャンセル付き。仕様書 2.2 / 4.2） */
  runBucket: (
    layerId: string,
    mode: BucketMode,
    params: BucketParams,
    start: { x: number; y: number },
    mask: Uint8Array | null
  ) => void;

  // --- 図形 & ミラー（仕様書 4.1） ---
  shape: ShapeOptions;
  setShapeFillMode: (m: ShapeFillMode) => void;
  setMirrorMode: (m: MirrorMode) => void;
  /** 図形の確定書き込み（離し時。処理量が閾値以上は Worker 実行。仕様書 2.2 / 4.1） */
  runShape: (
    layerId: string,
    spec: ShapeSpec,
    color: number,
    mask: Uint8Array | null
  ) => void;

  // --- Worker 実行基盤（仕様書 2.2: 進捗・キャンセル・編集ロック） ---
  /** 実行中の Worker ジョブ（null = 待機なし。実行中は編集操作をロックする） */
  workerJob: WorkerJobState | null;
  /** 実行中の Worker ジョブをキャンセルする（画像は実行前の状態のまま） */
  cancelWorker: () => void;

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
  /** ピクセル変更時の再描画要求。rect 指定で「その範囲 ∩ ビューポート」のみ再合成 */
  bumpRevision: (rect?: Rect | null) => void;
  /** メモリ使用量（仕様書 3 のヘッダー表示 / 2.2 の予算管理） */
  memoryUsage: MemoryUsage;

  // --- 履歴（仕様書 4.6 Undo / Redo） ---
  canUndo: boolean;
  canRedo: boolean;
  /** 履歴が保持している合計バイト数（メモリ予算に加算） */
  historyBytes: number;
  undo: () => void;
  redo: () => void;
  /** 1 ステップが履歴上限を超える操作の事前確認。false = 中止 */
  confirmHistoryStep: (stepBytes: number) => boolean;
  /** パッチステップ開始（バケツ・色置換など呼び出し側で変更される操作用） */
  historyBegin: (label: string) => boolean;
  /** 変更前のレイヤー全体を記録 */
  historyCaptureLayer: (layerId: string) => void;
  /** ステップを確定して履歴状態を更新 */
  historyCommit: () => void;
  /** ストローク 1 本を 1 ステップとして確定（drawTools の touched Map を受け取る） */
  commitStrokeHistory: (
    layerId: string,
    touched: Map<number, number>,
    width: number,
    height: number,
    pixels: Uint32Array
  ) => void;

  // --- 選択（仕様書 4.3） ---
  selection: SelectionState | null;
  setSelection: (sel: SelectionState | null) => void;
  clearSelection: () => void;
  /** 選択演算: 置換 / 加算(Shift) / 減算(Alt) */
  applySelectionOperation: (
    sel: SelectionState | null,
    mode: "replace" | "add" | "subtract"
  ) => void;
  selectAll: () => void;
  invertSelection: () => void;
  wand: { tolerance: number; contiguous: boolean };
  setWandTolerance: (n: number) => void;
  setWandContiguous: (b: boolean) => void;

  // --- コピー/切り取り/貼り付け/浮遊（仕様書 4.3） ---
  /** 貼り付け浮遊レイヤーの位置と寸法（null = 浮遊なし）。ピクセル本体は React 外で保持 */
  floatingRect: Rect | null;
  copySelection: () => void;
  cutSelection: () => void;
  pasteSelection: () => void;
  setFloatingPos: (x: number, y: number) => void;
  /** 浮遊レイヤーを現在のレイヤーへ確定書き込み（Enter / 他ツール選択） */
  commitFloating: () => void;
  /** 浮遊レイヤーを破棄（Escape） */
  cancelFloating: () => void;

  // --- 色置換（仕様書 4.3） ---
  replace: { from: string; to: string; tolerance: number; scope: ReplaceScope };
  setReplaceFrom: (hex: string) => void;
  setReplaceTo: (hex: string) => void;
  setReplaceTolerance: (n: number) => void;
  setReplaceScope: (s: ReplaceScope) => void;
  /** 色置換実行（閾値以上は Worker・進捗表示とキャンセル付き。仕様書 2.2 / 4.3） */
  runColorReplace: (
    layerId: string,
    from: number,
    to: number,
    tolerance: number,
    mask: Uint8Array | null
  ) => void;

  // --- 色調整（仕様書 4.4） ---
  adjust: AdjustParams;
  adjustScope: ReplaceScope;
  /** true なら「全レイヤーに適用」（仕様書 4.4 のチェックで切替） */
  adjustAllLayers: boolean;
  setAdjustParam: (key: AdjustParamKey, value: number) => void;
  setAdjustScope: (s: ReplaceScope) => void;
  setAdjustAllLayers: (b: boolean) => void;
  resetAdjust: () => void;
  /** 選択中レイヤーへ破壊的に適用（閾値以上は Worker 実行: 仕様書 2.2 / MS9） */
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
  /** 画面に合わせる（画像全体が収まる最大ズーム・中央寄せ。仕様書 3） */
  fitZoom: () => void;
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
  const historyBytes = useEditorStore((s) => s.historyBytes);
  useEffect(() => {
    const usage = new MemoryBudget(budgetMb).estimate({
      layerCount,
      width: docWidth,
      height: docHeight,
      hasSelection,
      historyBytes,
    });
    useEditorStore.setState({ memoryUsage: usage });
  }, [layerCount, docWidth, docHeight, hasSelection, historyBytes, budgetMb]);

  // config.yaml のショートカット（Undo/Redo・選択・クリップボード・ズーム・グリッド）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const store = useEditorStore.getState();
      // Worker 実行中は編集・履歴操作をロック（仕様書 2.2。ズーム/グリッド/選択表示系は可）
      const locked = store.workerJob !== null;
      if (e.key === "Escape") {
        // 浮遊レイヤーがあれば先に破棄、なければ選択解除（仕様書 4.3）
        if (store.floatingRect) {
          store.cancelFloating();
        } else {
          store.clearSelection();
        }
        return;
      }
      if (e.key === "Enter") {
        // 貼り付け浮遊レイヤーの確定（仕様書 4.3）
        if (store.floatingRect) store.commitFloating();
        return;
      }
      if (matchesShortcut(e, config.shortcuts.copy)) {
        e.preventDefault();
        store.copySelection();
      } else if (matchesShortcut(e, config.shortcuts.cut)) {
        e.preventDefault();
        if (!locked) store.cutSelection();
      } else if (matchesShortcut(e, config.shortcuts.paste)) {
        e.preventDefault();
        if (!locked) store.pasteSelection();
      } else if (matchesShortcut(e, config.shortcuts.select_all)) {
        e.preventDefault();
        store.selectAll();
      } else if (matchesShortcut(e, config.shortcuts.deselect)) {
        e.preventDefault();
        store.clearSelection();
      } else if (matchesShortcut(e, config.shortcuts.invert_selection)) {
        e.preventDefault();
        store.invertSelection();
      } else if (matchesShortcut(e, config.shortcuts.undo)) {
        e.preventDefault();
        if (!locked) store.undo();
      } else if (
        matchesShortcut(e, config.shortcuts.redo) ||
        matchesShortcut(e, config.shortcuts.redo_alternative)
      ) {
        e.preventDefault();
        if (!locked) store.redo();
      } else if (matchesShortcut(e, config.shortcuts.toggle_grid)) {
        e.preventDefault();
        store.toggleGrid();
      } else if (matchesShortcut(e, config.shortcuts.zoom_in)) {
        e.preventDefault();
        store.zoomBy(config.ui.zoom_step);
      } else if (matchesShortcut(e, config.shortcuts.zoom_out)) {
        e.preventDefault();
        store.zoomBy(1 / config.ui.zoom_step);
      } else if (matchesShortcut(e, config.shortcuts.fit)) {
        e.preventDefault();
        store.fitZoom();
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
