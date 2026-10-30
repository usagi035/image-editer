import { create } from "zustand";
import type { AppConfig } from "../config/configTypes";
import { DEFAULT_CONFIG } from "../config/defaultConfig";
import { checkPixelLimit } from "../config/limits";
import { showErrorDialog } from "../components/notify";
import {
  ADJUST_LIMITS,
  applyAdjustToLayer,
  buildAdjustMask,
  isIdentityAdjust,
} from "./adjustTools";
import {
  canvasToBlob,
  cropLayers,
  downloadBlob,
  EXPORT_EXT,
  layerFromImage,
  loadImageElement,
  qualityFor,
  renderExportCanvas,
  resizeLayers,
} from "./ioTools";
import {
  bytesToUint32,
  cloneLayer,
  createBlankLayer,
  canvasToPixels,
  pixelsToCanvas,
  rectBytes,
  scalePixels,
  writeRectBytes,
  type Layer,
} from "./layerUtils";
import {
  HistoryEngine,
  type HistoryHost,
  type LayerContent,
  type StructureSnapshot,
} from "./history";
import { MemoryBudget } from "./memoryBudget";
import { markDirty } from "./compositor";
import { applyFill, replacePixels } from "./bucketTools";
import {
  buildMaskSelection,
  buildSelectionMask,
  combineMasks,
  invertMask,
  selectAllSelection as createFullSelection,
} from "./selectionTools";
import {
  clearRectInPlace,
  copyRect,
  getClipboardImage,
  getFloatingImage,
  pasteInto,
  setClipboardImage,
  setFloatingImage,
} from "./clipboardTools";
import {
  needsWorker,
  runAdjustJob,
  runBucketJob,
  runReplaceJob,
  runShapeJob,
  type JobHandle,
} from "./workerHost";
import { fitViewState, type Rect } from "./types";
import { mirrorShapes, shapePixelEstimate, writeShape } from "./shapeTools";
import type { EditorContextValue, ReplaceScope } from "./EditorContext";

/**
 * エディタ状態ストア（改訂版仕様書 1: 状態管理は Zustand）。
 *
 * 旧来的な React Context + useState ベースの EditorContext を移行したもの。
 * - 状態とアクションはモジュールレベルで保持され、コンポーネントツリーを跨いで共有される
 * - 公開 API は EditorContextValue と同一（`useEditor()` がそのまま購読する）
 * - 設定（config.yaml）は ConfigContext の値を `config` へミラーし、アクション内部から参照する
 * - 画素データ（レイヤーの Canvas）自体は React state に入れず、
 *   ストアでは「レイヤー配列への参照」と revision（再描画要求）のみを保持する（仕様書 §9）
 */
export interface EditorStoreState extends EditorContextValue {
  /** ConfigContext の現在値（アクションが設定へアクセスするためのミラー） */
  config: AppConfig;
  /** config（再）読み込み時にツール初期値・ズーム範囲・グリッドを同期する */
  syncFromConfig: (config: AppConfig) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** "#000000ff" 形式（RGBA）→ "#000000" に正規化 */
function toHexColor(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const [, r, g, b] = c;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#000000";
}

function nextLayerName(existing: Layer[]): string {
  // 既存の最大番号 + 1（純粋な計算・モジュール状態を持たない）
  let max = 0;
  for (const l of existing) {
    const m = /^レイヤー (\d+)/.exec(l.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `レイヤー ${max + 1}`;
}

/** 予算チェック用（config.memory.budget_mb から都度生成） */
function budgetOf(config: AppConfig): MemoryBudget {
  return new MemoryBudget(config.memory.budget_mb);
}

const DEFAULT_LAYER = createBlankLayer(
  DEFAULT_CONFIG.canvas.default_width,
  DEFAULT_CONFIG.canvas.default_height,
  "レイヤー 1",
  DEFAULT_CONFIG.canvas.background_color
);

/** 実行中の Worker ジョブのキャンセルハンドル（編集ロック中かどうかは workerJob で判定） */
let workerCancel: (() => void) | null = null;

/**
 * Worker ジョブを 1 ステップとして実行する共通処理（仕様書 2.2）。
 * 実行中は workerJob で編集をロックし、キャンセル/失敗時は履歴ステップを成立させない
 * （画像は実行前のまま）。完了時は applyResult で本体へ書き戻して 1 ステップに確定する。
 */
function runWorkerPixelStep(
  label: string,
  layerId: string,
  start: (onProgress: (progress: number) => void) => JobHandle,
  applyResult: (result: Uint32Array) => void
): void {
  useEditorStore.setState({ workerJob: { label, progress: 0 } });
  historyEngine.beginStep(label);
  historyEngine.captureLayerBefore(layerId);
  const handle = start((progress) => {
    useEditorStore.setState({ workerJob: { label, progress } });
  });
  workerCancel = handle.cancel;
  void handle.promise.then((result) => {
    workerCancel = null;
    useEditorStore.setState({ workerJob: null });
    if (!result) {
      // キャンセル/失敗: 画像は実行前のまま・履歴ステップも成立させない
      historyEngine.abortStep();
      return;
    }
    applyResult(result);
    markDirty();
    historyEngine.commitStep();
    useEditorStore.setState((st) => ({ revision: st.revision + 1, ...historySync() }));
  });
}

/**
 * 複数レイヤー対象の Worker ジョブを 1 ステップとして並列実行する共通処理（仕様書 2.2）。
 * 進捗は全レイヤーの加重平均。1 つでもキャンセル/失敗したら全結果を破棄し
 * 画像は実行前のまま（履歴ステップも成立させない）。
 */
function runWorkerMultiLayerStep(
  label: string,
  layerIds: string[],
  starts: Array<(onProgress: (progress: number) => void) => JobHandle>,
  applyResults: (results: Uint32Array[]) => void
): void {
  useEditorStore.setState({ workerJob: { label, progress: 0 } });
  historyEngine.beginStep(label);
  for (const id of layerIds) historyEngine.captureLayerBefore(id);
  const progresses = starts.map(() => 0);
  const handles = starts.map((start, i) =>
    start((progress) => {
      progresses[i] = progress;
      const avg = progresses.reduce((a, b) => a + b, 0) / progresses.length;
      useEditorStore.setState({ workerJob: { label, progress: avg } });
    })
  );
  workerCancel = () => {
    for (const h of handles) h.cancel();
  };
  void Promise.all(handles.map((h) => h.promise)).then((results) => {
    workerCancel = null;
    useEditorStore.setState({ workerJob: null });
    if (results.some((r) => !r)) {
      historyEngine.abortStep();
      return;
    }
    applyResults(results as Uint32Array[]);
    markDirty();
    historyEngine.commitStep();
    useEditorStore.setState((st) => ({ revision: st.revision + 1, ...historySync() }));
  });
}

export const useEditorStore = create<EditorStoreState>()((set, get) => ({
  // ============ 設定ミラー ============
  config: DEFAULT_CONFIG,

  syncFromConfig(config) {
    const s = get();
    historyEngine.setLimits({
      maxSteps: config.history.max_steps,
      maxMemoryMb: config.history.max_memory_mb,
    });
    set({
      config,
      pen: {
        size: config.tools.pen.size,
        pixelPerfect: config.tools.pen.pixel_perfect,
      },
      eraserSize: config.tools.eraser.size,
      shape: {
        fillMode: config.tools.shape.fill_mode,
        mirror: config.tools.shape.mirror,
      },
      bucket: {
        mode: config.tools.bucket.mode,
        tolerance: config.tools.bucket.tolerance,
        jitter: config.tools.bucket.jitter,
      },
      primaryColor: toHexColor(config.tools.pen.default_color),
      secondaryColor: toHexColor(config.tools.bucket.dither_secondary),
      wand: {
        tolerance: config.tools.magic_wand.tolerance,
        contiguous: config.tools.magic_wand.contiguous,
      },
      replace: { ...s.replace, tolerance: config.tools.replace.tolerance },
      adjust: {
        hue: config.tools.adjustment.hue,
        saturation: config.tools.adjustment.saturation,
        value: config.tools.adjustment.value,
        contrast: config.tools.adjustment.contrast,
      },
      view: {
        ...s.view,
        zoom: clamp(s.view.zoom, config.canvas.zoom_min, config.canvas.zoom_max),
        showGrid: config.ui.show_grid,
      },
    });
  },

  // ============ ドキュメント ============
  docWidth: DEFAULT_CONFIG.canvas.default_width,
  docHeight: DEFAULT_CONFIG.canvas.default_height,
  docName: "untitled",

  setDocumentSize(w, h) {
    const s = get();
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    // 幅×高さの上限チェック（仕様書 2.2: canvas.max_pixels）
    const limitError = checkPixelLimit(nw, nh, s.config.canvas.max_pixels);
    if (limitError) {
      showErrorDialog(limitError);
      return;
    }
    if (nw === s.docWidth && nh === s.docHeight) {
      set({ selection: null }); // 従来通り選択解除のみ（履歴には残さない）
      return;
    }
    // 履歴上限の事前確認（仕様書 4.6: 1 ステップで超過する操作は確認して実行）
    const beforeBytes = s.layers.length * s.docWidth * s.docHeight * 4;
    const afterBytes = s.layers.length * nw * nh * 4;
    if (!get().confirmHistoryStep((beforeBytes + afterBytes) * 2)) return;
    // 全レイヤーのピクセルをスケール（仕様書 5 リサイズ）
    historyEngine.beginStep("リサイズ");
    for (const l of s.layers) historyEngine.noteRemovedLayer(l.id);
    resizeLayers(s.layers, nw, nh);
    for (const l of s.layers) historyEngine.noteAddedLayer(l.id);
    historyEngine.commitStep();
    markDirty(); // ドキュメントサイズ変更 → ビューポート全体を再合成
    set({
      layers: [...s.layers],
      docWidth: nw,
      docHeight: nh,
      selection: null,
      revision: s.revision + 1,
      ...historySync(),
    });
  },

  newDocument(w, h) {
    const s = get();
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    const limitError = checkPixelLimit(nw, nh, s.config.canvas.max_pixels);
    if (limitError) {
      showErrorDialog(limitError);
      return;
    }
    // 1レイヤーでも予算超過なら拒否（仕様書 2.2）
    const mem = budgetOf(s.config).canAllocate(
      { layerCount: 1, width: nw, height: nh, hasSelection: false },
      0
    );
    if (!mem.ok) {
      showErrorDialog(mem.message);
      return;
    }
    const layer = createBlankLayer(
      nw,
      nh,
      "レイヤー 1",
      s.config.canvas.background_color
    );
    historyEngine.clear(); // 新規ドキュメントで履歴をリセット
    markDirty();
    set({
      docWidth: nw,
      docHeight: nh,
      docName: "untitled",
      layers: [layer],
      activeLayerId: layer.id,
      selection: null, // 新規作成時は選択を解除
      revision: s.revision + 1,
    });
    set(historySync());
  },

  async loadImage(src, name) {
    const s = get();
    const img = await loadImageElement(src);
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    // 超える画像は開かない（仕様書 5.2）
    const limitError = checkPixelLimit(nw, nh, s.config.canvas.max_pixels);
    if (limitError) {
      showErrorDialog(limitError);
      return;
    }
    // 1レイヤーでも予算超過なら拒否（仕様書 2.2）
    const mem = budgetOf(s.config).canAllocate(
      { layerCount: 1, width: nw, height: nh, hasSelection: false },
      0
    );
    if (!mem.ok) {
      showErrorDialog(mem.message);
      return;
    }
    const layer = layerFromImage(img);
    historyEngine.clear(); // 読み込みで履歴をリセット
    markDirty();
    set({
      docWidth: nw,
      docHeight: nh,
      docName: name.replace(/\.[^.]+$/, "") || "untitled",
      layers: [layer],
      activeLayerId: layer.id,
      selection: null,
      revision: s.revision + 1,
    });
    set(historySync());
    // 画像を開いたときの初期ズームは「画面に合わせる」（仕様書 3）
    get().fitZoom();
  },

  cropDocument(x, y, w, h) {
    const s = get();
    const sx = clamp(Math.round(x), 0, s.docWidth - 1);
    const sy = clamp(Math.round(y), 0, s.docHeight - 1);
    const sw = clamp(Math.round(w), 1, s.docWidth - sx);
    const sh = clamp(Math.round(h), 1, s.docHeight - sy);
    // 履歴上限の事前確認（仕様書 4.6）
    const beforeBytes = s.layers.length * s.docWidth * s.docHeight * 4;
    const afterBytes = s.layers.length * sw * sh * 4;
    if (!get().confirmHistoryStep((beforeBytes + afterBytes) * 2)) return;
    historyEngine.beginStep("クロップ");
    for (const l of s.layers) historyEngine.noteRemovedLayer(l.id);
    cropLayers(s.layers, sx, sy, sw, sh);
    for (const l of s.layers) historyEngine.noteAddedLayer(l.id);
    markDirty(); // ドキュメントサイズ変更 → ビューポート全体を再合成
    set({
      layers: [...s.layers],
      docWidth: sw,
      docHeight: sh,
      selection: null,
      revision: s.revision + 1,
    });
    historyEngine.commitStep();
    set(historySync());
  },

  async exportImage(format, scale) {
    const s = get();
    const canvas = renderExportCanvas(
      s.layers,
      s.docWidth,
      s.docHeight,
      scale,
      format === "jpeg" ? s.config.export.jpeg_background : undefined
    );
    const quality = qualityFor(
      format,
      format === "jpeg"
        ? s.config.export.jpeg_quality
        : s.config.export.webp_quality
    );
    const fileName = `${s.docName || "untitled"}.${EXPORT_EXT[format]}`;
    // Electron: ネイティブ保存ダイアログ（仕様書 5）
    if (window.electronAPI?.saveImageFile) {
      const dataUrl = canvas.toDataURL(
        format === "png"
          ? "image/png"
          : format === "jpeg"
            ? "image/jpeg"
            : "image/webp",
        quality
      );
      const res = await window.electronAPI.saveImageFile({
        defaultName: fileName,
        dataUrl,
      });
      if (res.canceled || !res.path) return null;
      return res.path;
    }
    // ブラウザ: ダウンロード
    const blob = await canvasToBlob(canvas, format, quality);
    downloadBlob(blob, fileName);
    return fileName;
  },

  // ============ ツール ============
  tool: "pen",
  setTool: (t) => {
    // 貼り付け浮遊レイヤーの確定操作（Enter/他ツール選択: 仕様書 4.3）
    if (get().floatingRect) get().commitFloating();
    set({ tool: t });
  },

  // ============ カラー ============
  primaryColor: toHexColor(DEFAULT_CONFIG.tools.pen.default_color),
  setPrimaryColor: (c) => set({ primaryColor: c }),
  secondaryColor: toHexColor(DEFAULT_CONFIG.tools.bucket.dither_secondary),
  setSecondaryColor: (c) => set({ secondaryColor: c }),
  swapColors() {
    const s = get();
    set({
      primaryColor: s.secondaryColor,
      secondaryColor: s.primaryColor,
    });
  },

  // ============ ツールオプション ============
  pen: {
    size: DEFAULT_CONFIG.tools.pen.size,
    pixelPerfect: DEFAULT_CONFIG.tools.pen.pixel_perfect,
  },
  setPenSize(n) {
    const max = get().config.tools.pen.max_size;
    set((s) => ({
      pen: { ...s.pen, size: clamp(Math.round(n), 1, max) },
    }));
  },
  setPenPixelPerfect: (b) => set((s) => ({ pen: { ...s.pen, pixelPerfect: b } })),
  eraserSize: DEFAULT_CONFIG.tools.eraser.size,
  setEraserSize(n) {
    const max = get().config.tools.eraser.max_size;
    set({ eraserSize: clamp(Math.round(n), 1, max) });
  },
  bucket: {
    mode: DEFAULT_CONFIG.tools.bucket.mode,
    tolerance: DEFAULT_CONFIG.tools.bucket.tolerance,
    jitter: DEFAULT_CONFIG.tools.bucket.jitter,
  },
  setBucketMode: (m) => set((s) => ({ bucket: { ...s.bucket, mode: m } })),
  setBucketTolerance: (n) =>
    set((s) => ({
      bucket: { ...s.bucket, tolerance: clamp(Math.round(n), 0, 255) },
    })),
  setBucketJitter: (n) =>
    set((s) => ({
      bucket: { ...s.bucket, jitter: clamp(Math.round(n), 0, 100) },
    })),

  // ============ Worker 実行基盤（仕様書 2.2: 進捗・キャンセル・編集ロック） ============
  workerJob: null,
  cancelWorker() {
    workerCancel?.(); // 実行中ジョブを破棄（promise 側が workerJob を null に戻す）
  },
  runBucket(layerId, mode, params, start, mask) {
    const s = get();
    if (s.workerJob) return; // 実行中は編集をロック（仕様書 2.2）
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const pixelsTotal = layer.width * layer.height;
    // 履歴上限の事前確認（仕様書 4.6: 全域操作の可能性）
    if (!get().confirmHistoryStep(pixelsTotal * 4 * 2)) return;

    if (!needsWorker(pixelsTotal, s.config.canvas.worker_pixel_threshold)) {
      // 小画像: メインスレッドで同期実行（従来どおり）
      historyEngine.beginStep("バケツ");
      historyEngine.captureLayerBefore(layerId);
      applyFill(layer.pixels, layer.width, layer.height, start.x, start.y, mode, params, mask);
      markDirty();
      historyEngine.commitStep();
      set((st) => ({ revision: st.revision + 1, ...historySync() }));
      return;
    }

    // 大画像: Worker で実行（進捗表示・キャンセル可能・実行中は編集ロック）
    runWorkerPixelStep(
      "バケツ",
      layerId,
      (onProgress) =>
        runBucketJob(
          {
            pixels: layer.pixels,
            width: layer.width,
            height: layer.height,
            startX: start.x,
            startY: start.y,
            mode,
            params,
            mask,
          },
          onProgress
        ),
      (result) => layer.pixels.set(result)
    );
  },
  runColorReplace(layerId, from, to, tolerance, mask) {
    const s = get();
    if (s.workerJob) return; // 実行中は編集をロック（仕様書 2.2）
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const pixelsTotal = layer.width * layer.height;
    if (!get().confirmHistoryStep(pixelsTotal * 4 * 2)) return;

    if (!needsWorker(pixelsTotal, s.config.canvas.worker_pixel_threshold)) {
      historyEngine.beginStep("色置換");
      historyEngine.captureLayerBefore(layerId);
      replacePixels(layer.pixels, from, to, tolerance, mask);
      markDirty();
      historyEngine.commitStep();
      set((st) => ({ revision: st.revision + 1, ...historySync() }));
      return;
    }

    runWorkerPixelStep(
      "色置換",
      layerId,
      (onProgress) =>
        runReplaceJob({ pixels: layer.pixels, from, to, tolerance, mask }, onProgress),
      (result) => layer.pixels.set(result)
    );
  },

  // ============ 図形 & ミラー（仕様書 4.1） ============
  shape: {
    fillMode: DEFAULT_CONFIG.tools.shape.fill_mode,
    mirror: DEFAULT_CONFIG.tools.shape.mirror,
  },
  setShapeFillMode: (m) => set((s) => ({ shape: { ...s.shape, fillMode: m } })),
  setMirrorMode: (m) => set((s) => ({ shape: { ...s.shape, mirror: m } })),
  runShape(layerId, spec, color, mask) {
    const s = get();
    if (s.workerJob) return; // 実行中は編集をロック（仕様書 2.2）
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const mirror = s.shape.mirror;
    // 塗り図形は対象ピクセル数が巨大になり得る → 閾値以上は Worker 実行（仕様書 2.2）
    const estimate =
      shapePixelEstimate(spec) *
      mirrorShapes(spec, layer.width, layer.height, mirror).length;
    if (!get().confirmHistoryStep(estimate * 4 * 2)) return;

    if (!needsWorker(estimate, s.config.canvas.worker_pixel_threshold)) {
      // 小さめ: メインスレッドで同期実行（touched マップで 1 ステップの履歴に確定）
      historyEngine.beginStep("図形");
      const touched = new Map<number, number>();
      writeShape(
        layer.pixels,
        layer.width,
        layer.height,
        spec,
        { color, mask, mirror },
        touched
      );
      markDirty();
      historyEngine.commitStroke(
        layerId,
        touched,
        layer.width,
        layer.height,
        layer.pixels
      );
      set((st) => ({ revision: st.revision + 1, ...historySync() }));
      return;
    }

    runWorkerPixelStep(
      "図形",
      layerId,
      (onProgress) =>
        runShapeJob(
          {
            pixels: layer.pixels,
            width: layer.width,
            height: layer.height,
            spec,
            color,
            mask,
            mirror,
          },
          onProgress
        ),
      (result) => layer.pixels.set(result)
    );
  },

  // ============ レイヤー（仕様書 4.5） ============
  layers: [DEFAULT_LAYER],
  activeLayerId: "",
  setActiveLayerId: (id) => set({ activeLayerId: id }),

  addLayer() {
    const s = get();
    if (s.layers.length >= s.config.tools.layers.max_layers) return;
    // メモリ予算チェック（仕様書 2.2: 超過は拒否してメッセージを表示）
    const check = budgetOf(s.config).canAllocate(
      {
        layerCount: s.layers.length + 1,
        width: s.docWidth,
        height: s.docHeight,
        hasSelection: s.selection !== null,
      },
      0
    );
    if (!check.ok) {
      showErrorDialog(check.message);
      return;
    }
    const index = s.layers.findIndex((l) => l.id === s.activeLayerId);
    const insertAt = index >= 0 ? index + 1 : s.layers.length;
    const layer = createBlankLayer(
      s.docWidth,
      s.docHeight,
      nextLayerName(s.layers),
      s.config.canvas.background_color
    );
    const next = [...s.layers];
    next.splice(insertAt, 0, layer);
    historyEngine.beginStep("レイヤー追加");
    markDirty(); // レイヤー構成変更 → ビューポート全体を再合成
    set({
      layers: next,
      activeLayerId: layer.id,
      revision: s.revision + 1,
    });
    historyEngine.noteAddedLayer(layer.id); // Redo で再生成するため内容を記録
    historyEngine.commitStep();
    set(historySync());
  },

  duplicateLayer(id) {
    const s = get();
    const index = s.layers.findIndex((l) => l.id === id);
    if (index < 0) return;
    // メモリ予算チェック（仕様書 2.2）
    const check = budgetOf(s.config).canAllocate(
      {
        layerCount: s.layers.length + 1,
        width: s.docWidth,
        height: s.docHeight,
        hasSelection: s.selection !== null,
      },
      0
    );
    if (!check.ok) {
      showErrorDialog(check.message);
      return;
    }
    const source = s.layers[index];
    const copy = cloneLayer(source, `${source.name} のコピー`);
    const next = [...s.layers];
    next.splice(index + 1, 0, copy);
    historyEngine.beginStep("レイヤー複製");
    markDirty(); // レイヤー構成変更 → ビューポート全体を再合成
    set({
      layers: next,
      activeLayerId: copy.id,
      revision: s.revision + 1,
    });
    historyEngine.noteAddedLayer(copy.id); // Redo で再生成するため内容を記録
    historyEngine.commitStep();
    set(historySync());
  },

  deleteLayer(id) {
    const s = get();
    let layers = s.layers;
    if (layers.length > 1) {
      const index = layers.findIndex((l) => l.id === id);
      if (index >= 0) {
        historyEngine.beginStep("レイヤー削除");
        historyEngine.noteRemovedLayer(id); // Undo で画素ごと復元するため内容を記録
        layers = layers.filter((l) => l.id !== id);
      }
    }
    markDirty(); // レイヤー構成変更 → ビューポート全体を再合成
    set({ layers, revision: s.revision + 1 });
    historyEngine.commitStep();
    set(historySync());
  },

  moveLayer(id, dir) {
    const s = get();
    const index = s.layers.findIndex((l) => l.id === id);
    const target = index + dir;
    let layers = s.layers;
    if (index >= 0 && target >= 0 && target < layers.length) {
      historyEngine.beginStep("レイヤー移動");
      layers = [...layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
    }
    markDirty(); // レイヤー構成変更 → ビューポート全体を再合成
    set({ layers, revision: s.revision + 1 });
    historyEngine.commitStep();
    set(historySync());
  },

  setLayerOpacity(id, opacity) {
    const s = get();
    const v = clamp(Math.round(opacity), 0, 100);
    historyEngine.beginStep("不透明度");
    markDirty(); // 合成結果が全体に変わる → ビューポート全体を再合成
    set({
      layers: s.layers.map((l) => (l.id === id ? { ...l, opacity: v } : l)),
      revision: s.revision + 1,
    });
    historyEngine.commitStep();
    set(historySync());
  },

  toggleLayerVisible(id) {
    const s = get();
    historyEngine.beginStep("表示切替");
    markDirty(); // 合成結果が全体に変わる → ビューポート全体を再合成
    set({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
      revision: s.revision + 1,
    });
    historyEngine.commitStep();
    set(historySync());
  },

  mergeDown(id) {
    const s = get();
    const layers = s.layers;
    const index = layers.findIndex((l) => l.id === id);
    if (index <= 0) return;
    const src = layers[index];
    const dst = layers[index - 1];
    // 履歴上限の事前確認（仕様書 4.6: 下層は全域書き換えになる）
    if (!get().confirmHistoryStep(dst.width * dst.height * 4 * 2)) {
      return;
    }
    historyEngine.beginStep("レイヤー統合");
    historyEngine.noteRemovedLayer(src.id); // Undo でレイヤーごと復元
    historyEngine.captureLayerBefore(dst.id); // 下層の書き換えをパッチで記録
    // source-over 統合（従来の drawImage と同一結果）。一時 Canvas は保持しない。
    const base = pixelsToCanvas(dst.pixels, dst.width, dst.height);
    const over = pixelsToCanvas(src.pixels, src.width, src.height);
    const ctx = base.getContext("2d")!;
    ctx.globalAlpha = src.opacity / 100;
    ctx.drawImage(over, 0, 0);
    ctx.globalAlpha = 1;
    dst.pixels = canvasToPixels(base).pixels;
    markDirty(); // レイヤー統合 → ビューポート全体を再合成
    set({
      layers: layers.filter((l) => l.id !== src.id),
      activeLayerId: dst.id,
      revision: s.revision + 1,
    });
    historyEngine.commitStep();
    set(historySync());
  },

  revision: 0,
  /**
   * ピクセル変更時の再描画要求（仕様書 7 性能）。
   * rect を渡すと「その範囲 ∩ ビューポート」のみ再合成される（範囲不明 = ビューポート全体）。
   */
  bumpRevision: (rect) => {
    markDirty(rect);
    set((s) => ({ revision: s.revision + 1 }));
  },

  // メモリ使用量は EditorProvider が状態変化のたびに再計算する
  memoryUsage: new MemoryBudget(DEFAULT_CONFIG.memory.budget_mb).estimate({
    layerCount: 1,
    width: DEFAULT_CONFIG.canvas.default_width,
    height: DEFAULT_CONFIG.canvas.default_height,
    hasSelection: false,
  }),

  // ============ 履歴（仕様書 4.6 Undo / Redo） ============
  canUndo: false,
  canRedo: false,
  historyBytes: 0,

  undo() {
    if (!historyEngine.undo()) return;
    markDirty(); // 復元範囲はステップにより異なる → ビューポート全体を再合成
    set((s) => ({ revision: s.revision + 1, ...historySync() }));
  },
  redo() {
    if (!historyEngine.redo()) return;
    markDirty(); // 再適用範囲はステップにより異なる → ビューポート全体を再合成
    set((s) => ({ revision: s.revision + 1, ...historySync() }));
  },

  confirmHistoryStep(stepBytes) {
    const maxBytes = get().config.history.max_memory_mb * 1024 * 1024;
    if (stepBytes <= maxBytes) return true;
    // 仕様書 4.6: 単独で上限を超える操作は事前確認して実行する（保存はされない）
    return window.confirm(
      "この操作は元に戻せません（履歴のメモリ上限超過）。実行しますか？"
    );
  },

  historyBegin(label) {
    historyEngine.beginStep(label);
    return true;
  },
  historyCaptureLayer(layerId) {
    historyEngine.captureLayerBefore(layerId);
  },
  historyCommit() {
    historyEngine.commitStep();
    set(historySync());
  },
  commitStrokeHistory(layerId, touched, width, height, pixels) {
    historyEngine.commitStroke(layerId, touched, width, height, pixels);
    set(historySync());
  },

  // ============ 選択（仕様書 4.3） ============
  selection: null,
  setSelection: (sel) => set({ selection: sel }),
  clearSelection: () => {
    if (get().selection !== null) set({ selection: null });
  },
  wand: {
    tolerance: DEFAULT_CONFIG.tools.magic_wand.tolerance,
    contiguous: DEFAULT_CONFIG.tools.magic_wand.contiguous,
  },
  setWandTolerance: (n) =>
    set((s) => ({
      wand: { ...s.wand, tolerance: Math.max(0, Math.min(255, Math.round(n))) },
    })),
  setWandContiguous: (b) => set((s) => ({ wand: { ...s.wand, contiguous: b } })),

  // ============ 選択演算（仕様書 4.3: 通常/加算 Shift/減算 Alt・全選択・反転） ============
  applySelectionOperation(newSel, mode) {
    const s = get();
    const cur = s.selection;
    if (mode === "replace" || !cur || !newSel) {
      set({ selection: newSel });
      return;
    }
    // 矩形同士: 加算は bbox の和集合で完結（マスク配列を確保しない）
    if (cur.mask === null && newSel.mask === null && mode === "add") {
      const x0 = Math.min(cur.x, newSel.x);
      const y0 = Math.min(cur.y, newSel.y);
      const x1 = Math.max(cur.x + cur.w, newSel.x + newSel.w);
      const y1 = Math.max(cur.y + cur.h, newSel.y + newSel.h);
      set({ selection: { kind: "rect", x: x0, y: y0, w: x1 - x0, h: y1 - y0, mask: null } });
      return;
    }
    if (cur.mask === null && newSel.mask === null && mode === "subtract") {
      const disjoint =
        newSel.x + newSel.w <= cur.x ||
        cur.x + cur.w <= newSel.x ||
        newSel.y + newSel.h <= cur.y ||
        cur.y + cur.h <= newSel.y;
      if (disjoint) return; // 重なりなし = 現状維持
      const contains =
        newSel.x <= cur.x &&
        newSel.y <= cur.y &&
        newSel.x + newSel.w >= cur.x + cur.w &&
        newSel.y + newSel.h >= cur.y + cur.h;
      if (contains) {
        set({ selection: null }); // 全体を減算 = 選択解除
        return;
      }
      // 部分重複: マスク合成へフォールバック
    }
    const a = buildSelectionMask(cur, s.docWidth, s.docHeight);
    const b = buildSelectionMask(newSel, s.docWidth, s.docHeight);
    if (!a || !b) {
      set({ selection: newSel });
      return;
    }
    set({
      selection: buildMaskSelection(
        combineMasks(a, b, mode === "add" ? "union" : "subtract"),
        s.docWidth,
        s.docHeight
      ),
    });
  },
  selectAll() {
    const s = get();
    set({ selection: createFullSelection(s.docWidth, s.docHeight) });
  },
  invertSelection() {
    const s = get();
    if (!s.selection) {
      set({ selection: createFullSelection(s.docWidth, s.docHeight) });
      return;
    }
    const mask = buildSelectionMask(s.selection, s.docWidth, s.docHeight);
    set({
      selection: mask
        ? buildMaskSelection(invertMask(mask), s.docWidth, s.docHeight)
        : null,
    });
  },

  // ============ コピー/切り取り/貼り付け/浮遊（仕様書 4.3） ============
  floatingRect: null,
  copySelection() {
    const s = get();
    const layer = s.layers.find((l) => l.id === s.activeLayerId);
    if (!layer) return;
    const sel = s.selection;
    const rect: Rect = sel
      ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
      : { x: 0, y: 0, w: layer.width, h: layer.height };
    const mask = sel ? buildSelectionMask(sel, layer.width, layer.height) : null;
    const image = copyRect(layer.pixels, layer.width, rect, mask);
    if (image.width <= 0 || image.height <= 0) return;
    setClipboardImage(image);
  },
  cutSelection() {
    const s = get();
    const layer = s.layers.find((l) => l.id === s.activeLayerId);
    if (!layer) return;
    if (!get().confirmHistoryStep(layer.width * layer.height * 4 * 2)) return;
    get().copySelection();
    const sel = s.selection;
    const rect: Rect = sel
      ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
      : { x: 0, y: 0, w: layer.width, h: layer.height };
    const mask = sel ? buildSelectionMask(sel, layer.width, layer.height) : null;
    historyEngine.beginStep("切り取り");
    historyEngine.captureLayerBefore(layer.id);
    clearRectInPlace(layer.pixels, layer.width, rect, mask);
    markDirty();
    historyEngine.commitStep();
    set((st) => ({ revision: st.revision + 1, ...historySync() }));
  },
  pasteSelection() {
    const image = getClipboardImage();
    if (!image) return;
    const s = get();
    if (s.workerJob) return;
    // 浮遊位置: 選択があればその左上、なければ原点
    const x = s.selection ? s.selection.x : 0;
    const y = s.selection ? s.selection.y : 0;
    setFloatingImage({ ...image, x, y });
    set({ floatingRect: { x, y, w: image.width, h: image.height } });
  },
  setFloatingPos(x, y) {
    const fl = getFloatingImage();
    if (!fl) return;
    setFloatingImage({ ...fl, x, y });
    set({ floatingRect: { x, y, w: fl.width, h: fl.height } });
  },
  commitFloating() {
    const fl = getFloatingImage();
    if (!fl) return;
    const s = get();
    const layer = s.layers.find((l) => l.id === s.activeLayerId);
    if (!layer) return;
    if (s.workerJob) return;
    // 履歴上限の事前確認（拒否したら浮遊状態を維持する）
    if (!get().confirmHistoryStep(layer.width * layer.height * 4 * 2)) return;
    setFloatingImage(null);
    set({ floatingRect: null });
    // 選択マスクがあれば選択内のみへ書き込む（書き込み遮断: 仕様書 4.3）
    const mask = s.selection
      ? buildSelectionMask(s.selection, layer.width, layer.height)
      : null;
    historyEngine.beginStep("貼り付け");
    historyEngine.captureLayerBefore(layer.id);
    pasteInto(layer.pixels, layer.width, layer.height, fl, mask);
    markDirty();
    historyEngine.commitStep();
    set((st) => ({ revision: st.revision + 1, ...historySync() }));
  },
  cancelFloating() {
    if (!getFloatingImage()) return;
    setFloatingImage(null);
    set({ floatingRect: null });
  },

  // ============ 色置換（仕様書 4.3） ============
  replace: {
    from: "#000000",
    to: "#ffffff",
    tolerance: DEFAULT_CONFIG.tools.replace.tolerance,
    scope: "layer" as ReplaceScope,
  },
  setReplaceFrom: (hex) => set((s) => ({ replace: { ...s.replace, from: hex } })),
  setReplaceTo: (hex) => set((s) => ({ replace: { ...s.replace, to: hex } })),
  setReplaceTolerance: (n) =>
    set((s) => ({
      replace: {
        ...s.replace,
        tolerance: Math.max(0, Math.min(255, Math.round(n))),
      },
    })),
  setReplaceScope: (sc) => set((s) => ({ replace: { ...s.replace, scope: sc } })),

  // ============ 色調整（仕様書 4.4） ============
  adjust: {
    hue: DEFAULT_CONFIG.tools.adjustment.hue,
    saturation: DEFAULT_CONFIG.tools.adjustment.saturation,
    value: DEFAULT_CONFIG.tools.adjustment.value,
    contrast: DEFAULT_CONFIG.tools.adjustment.contrast,
  },
  adjustScope: "layer",
  adjustAllLayers: false,
  setAdjustAllLayers: (b) => set({ adjustAllLayers: b }),
  setAdjustParam(key, value) {
    const lim = ADJUST_LIMITS[key];
    set((s) => ({
      adjust: {
        ...s.adjust,
        [key]: Math.max(lim.min, Math.min(lim.max, Math.round(value))),
      },
    }));
  },
  setAdjustScope: (sc) => set({ adjustScope: sc }),
  resetAdjust() {
    const d = get().config.tools.adjustment;
    set({
      adjust: {
        hue: d.hue,
        saturation: d.saturation,
        value: d.value,
        contrast: d.contrast,
      },
    });
  },
  applyAdjust() {
    const s = get();
    if (s.workerJob) return; // 実行中は編集をロック（仕様書 2.2）
    if (isIdentityAdjust(s.adjust)) return;
    // 対象: 選択中レイヤー（「全レイヤーに適用」チェック時は全レイヤー: 改訂版仕様書 4.4）
    const targets = s.adjustAllLayers
      ? s.layers
      : s.layers.filter((l) => l.id === s.activeLayerId);
    if (targets.length === 0) return;
    for (const layer of targets) {
      // 履歴上限の事前確認（仕様書 4.6）
      if (!get().confirmHistoryStep(layer.width * layer.height * 4 * 2)) {
        return;
      }
    }

    const totalPixels = targets.reduce((n, l) => n + l.width * l.height, 0);

    if (!needsWorker(totalPixels, s.config.canvas.worker_pixel_threshold)) {
      // 小さめ: メインスレッドで同期実行
      historyEngine.beginStep("色調整");
      for (const layer of targets) {
        historyEngine.captureLayerBefore(layer.id);
        const mask = buildAdjustMask(
          s.adjustScope,
          s.selection,
          layer.width,
          layer.height
        );
        applyAdjustToLayer(layer, s.adjust, mask);
      }
      historyEngine.commitStep();
      const d = s.config.tools.adjustment;
      markDirty(); // 色調整適用 → ビューポート全体を再合成
      set({
        revision: s.revision + 1,
        adjust: {
          hue: d.hue,
          saturation: d.saturation,
          value: d.value,
          contrast: d.contrast,
        },
        ...historySync(),
      });
      return;
    }

    // 大画像: Worker で実行（進捗表示・キャンセル可能・実行中は編集ロック）
    runWorkerMultiLayerStep(
      "色調整",
      targets.map((l) => l.id),
      targets.map((layer) => (onProgress) =>
        runAdjustJob(
          {
            pixels: layer.pixels,
            params: s.adjust,
            mask: buildAdjustMask(
              s.adjustScope,
              s.selection,
              layer.width,
              layer.height
            ),
          },
          onProgress
        )
      ),
      (results) => {
        targets.forEach((layer, i) => layer.pixels.set(results[i]));
      }
    );
    const d = s.config.tools.adjustment;
    set({
      adjust: {
        hue: d.hue,
        saturation: d.saturation,
        value: d.value,
        contrast: d.contrast,
      },
    });
  },

  // ============ ビューポート ============
  view: {
    zoom: 1,
    panX: 64,
    panY: 64,
    showGrid: DEFAULT_CONFIG.ui.show_grid,
  },
  setView(action) {
    set((s) => ({
      view: typeof action === "function" ? action(s.view) : action,
    }));
  },
  viewportSize: { w: 0, h: 0 },
  setViewportSize(action) {
    set((s) => ({
      viewportSize:
        typeof action === "function" ? action(s.viewportSize) : action,
    }));
  },
  setZoom(zoom, anchor) {
    const s = get();
    const v = s.view;
    const next = clamp(zoom, s.config.canvas.zoom_min, s.config.canvas.zoom_max);
    if (next === v.zoom) return;
    const ax = anchor?.x ?? s.viewportSize.w / 2;
    const ay = anchor?.y ?? s.viewportSize.h / 2;
    const docX = (ax - v.panX) / v.zoom;
    const docY = (ay - v.panY) / v.zoom;
    set({ view: { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next } });
  },
  zoomBy(factor, anchor) {
    const s = get();
    const v = s.view;
    const next = clamp(
      v.zoom * factor,
      s.config.canvas.zoom_min,
      s.config.canvas.zoom_max
    );
    if (next === v.zoom) return;
    const ax = anchor?.x ?? s.viewportSize.w / 2;
    const ay = anchor?.y ?? s.viewportSize.h / 2;
    const docX = (ax - v.panX) / v.zoom;
    const docY = (ay - v.panY) / v.zoom;
    set({ view: { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next } });
  },
  resetZoom() {
    const s = get();
    const v = s.view;
    const next = clamp(1, s.config.canvas.zoom_min, s.config.canvas.zoom_max);
    const ax = s.viewportSize.w / 2;
    const ay = s.viewportSize.h / 2;
    const docX = (ax - v.panX) / v.zoom;
    const docY = (ay - v.panY) / v.zoom;
    set({ view: { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next } });
  },
  /** 画面に合わせる: 画像全体が収まる最大ズームで中央表示（仕様書 3） */
  fitZoom() {
    const s = get();
    if (s.viewportSize.w <= 0 || s.viewportSize.h <= 0) return;
    const fit = fitViewState(
      s.viewportSize.w,
      s.viewportSize.h,
      s.docWidth,
      s.docHeight,
      s.config.canvas.zoom_min,
      s.config.canvas.zoom_max
    );
    set({ view: { ...s.view, ...fit } });
  },
  toggleGrid: () => set((s) => ({ view: { ...s.view, showGrid: !s.view.showGrid } })),
}));

// ============ 履歴エンジンの配線（仕様書 4.6） ============

/** レイヤー Canvas を履歴エンジンへ公開するホスト実装（本番側） */
const historyHost: HistoryHost = {
  captureMeta(): StructureSnapshot {
    const s = useEditorStore.getState();
    return {
      width: s.docWidth,
      height: s.docHeight,
      activeLayerId: s.activeLayerId,
      layers: s.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
      })),
    };
  },

  capturePixels(layerId): LayerContent | null {
    const s = useEditorStore.getState();
    const l = s.layers.find((x) => x.id === layerId);
    if (!l) return null;
    // レイヤー本体（Uint32Array）は RGBA バイト列としてそのまま複製できる
    const copy = l.pixels.slice();
    return {
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      width: l.width,
      height: l.height,
      pixels: new Uint8ClampedArray(copy.buffer),
    };
  },

  captureRect(layerId, rect) {
    const s = useEditorStore.getState();
    const l = s.layers.find((x) => x.id === layerId);
    if (!l) return null;
    return rectBytes(l.pixels, l.width, l.height, rect);
  },

  applyRect(layerId, rect, data) {
    const s = useEditorStore.getState();
    const l = s.layers.find((x) => x.id === layerId);
    if (!l) return;
    writeRectBytes(l.pixels, l.width, l.height, rect, data);
  },

  applyDocument(snapshot, contentById) {
    const s = useEditorStore.getState();
    const byId = new Map(s.layers.map((l) => [l.id, l] as const));
    const layers: Layer[] = snapshot.layers.map((meta) => {
      const existing = byId.get(meta.id);
      const content = contentById.get(meta.id);
      if (
        existing &&
        !content &&
        existing.width === snapshot.width &&
        existing.height === snapshot.height
      ) {
        // サイズ一致なら画素配列をそのまま再利用（画素はパッチで復元される）
        return { ...meta, pixels: existing.pixels, width: existing.width, height: existing.height };
      }
      let pixels: Uint32Array;
      if (content) {
        if (content.width === snapshot.width && content.height === snapshot.height) {
          // 履歴のバッファとは独立した配列にする（復元後に履歴を書き換えない）
          pixels = bytesToUint32(content.pixels).slice();
        } else {
          // コンテンツ寸法と目標が異なる場合はスケールして復元
          pixels = scalePixels(
            bytesToUint32(content.pixels),
            content.width,
            content.height,
            snapshot.width,
            snapshot.height
          ).pixels;
        }
      } else if (existing) {
        pixels = scalePixels(
          existing.pixels,
          existing.width,
          existing.height,
          snapshot.width,
          snapshot.height
        ).pixels;
      } else {
        pixels = new Uint32Array(snapshot.width * snapshot.height);
      }
      return { ...meta, pixels, width: snapshot.width, height: snapshot.height };
    });
    const sizeChanged =
      s.docWidth !== snapshot.width || s.docHeight !== snapshot.height;
    markDirty(); // 構造スナップショット復元 → ビューポート全体を再合成
    useEditorStore.setState({
      layers,
      activeLayerId: snapshot.activeLayerId,
      docWidth: snapshot.width,
      docHeight: snapshot.height,
      selection: sizeChanged ? null : s.selection, // サイズが変わった選択は無効
      revision: s.revision + 1,
    });
  },
};

export const historyEngine = new HistoryEngine(historyHost, {
  maxSteps: DEFAULT_CONFIG.history.max_steps,
  maxMemoryMb: DEFAULT_CONFIG.history.max_memory_mb,
});

/** ステップ確定後に呼び出す: canUndo/canRedo・履歴バイト数・メモリ使用量を更新する */
function historySync(): Partial<EditorStoreState> {
  const s = useEditorStore.getState();
  const bytes = historyEngine.usedBytes;
  return {
    canUndo: historyEngine.canUndo,
    canRedo: historyEngine.canRedo,
    historyBytes: bytes,
    memoryUsage: budgetOf(s.config).estimate({
      layerCount: s.layers.length,
      width: s.docWidth,
      height: s.docHeight,
      hasSelection: s.selection !== null,
      historyBytes: bytes,
    }),
  };
}
