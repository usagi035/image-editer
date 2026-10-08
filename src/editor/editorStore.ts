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
import { cloneLayer, createBlankLayer, type Layer } from "./layerUtils";
import { MemoryBudget } from "./memoryBudget";
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

export const useEditorStore = create<EditorStoreState>()((set, get) => ({
  // ============ 設定ミラー ============
  config: DEFAULT_CONFIG,

  syncFromConfig(config) {
    const s = get();
    set({
      config,
      pen: {
        size: config.tools.pen.size,
        pixelPerfect: config.tools.pen.pixel_perfect,
      },
      eraserSize: config.tools.eraser.size,
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
    // 全レイヤーのピクセルをスケール（仕様書 5 リサイズ）
    resizeLayers(s.layers, nw, nh);
    set({
      layers: [...s.layers],
      docWidth: nw,
      docHeight: nh,
      selection: null,
      revision: s.revision + 1,
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
    set({
      docWidth: nw,
      docHeight: nh,
      docName: "untitled",
      layers: [layer],
      activeLayerId: layer.id,
      selection: null, // 新規作成時は選択を解除
      revision: s.revision + 1,
    });
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
    set({
      docWidth: nw,
      docHeight: nh,
      docName: name.replace(/\.[^.]+$/, "") || "untitled",
      layers: [layer],
      activeLayerId: layer.id,
      selection: null,
      revision: s.revision + 1,
    });
  },

  cropDocument(x, y, w, h) {
    const s = get();
    const sx = clamp(Math.round(x), 0, s.docWidth - 1);
    const sy = clamp(Math.round(y), 0, s.docHeight - 1);
    const sw = clamp(Math.round(w), 1, s.docWidth - sx);
    const sh = clamp(Math.round(h), 1, s.docHeight - sy);
    cropLayers(s.layers, sx, sy, sw, sh);
    set({
      layers: [...s.layers],
      docWidth: sw,
      docHeight: sh,
      selection: null,
      revision: s.revision + 1,
    });
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
  setTool: (t) => set({ tool: t }),

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
    set({
      layers: next,
      activeLayerId: layer.id,
      revision: s.revision + 1,
    });
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
    set({
      layers: next,
      activeLayerId: copy.id,
      revision: s.revision + 1,
    });
  },

  deleteLayer(id) {
    const s = get();
    let layers = s.layers;
    if (layers.length > 1) {
      const index = layers.findIndex((l) => l.id === id);
      if (index >= 0) layers = layers.filter((l) => l.id !== id);
    }
    set({ layers, revision: s.revision + 1 });
  },

  moveLayer(id, dir) {
    const s = get();
    const index = s.layers.findIndex((l) => l.id === id);
    const target = index + dir;
    let layers = s.layers;
    if (index >= 0 && target >= 0 && target < layers.length) {
      layers = [...layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
    }
    set({ layers, revision: s.revision + 1 });
  },

  setLayerOpacity(id, opacity) {
    const s = get();
    const v = clamp(Math.round(opacity), 0, 100);
    set({
      layers: s.layers.map((l) => (l.id === id ? { ...l, opacity: v } : l)),
      revision: s.revision + 1,
    });
  },

  toggleLayerVisible(id) {
    const s = get();
    set({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
      revision: s.revision + 1,
    });
  },

  mergeDown(id) {
    const s = get();
    const layers = s.layers;
    const index = layers.findIndex((l) => l.id === id);
    if (index <= 0) return;
    const src = layers[index];
    const dst = layers[index - 1];
    const ctx = dst.canvas.getContext("2d")!;
    ctx.globalAlpha = src.opacity / 100;
    ctx.drawImage(src.canvas, 0, 0);
    ctx.globalAlpha = 1;
    set({
      layers: layers.filter((l) => l.id !== src.id),
      activeLayerId: dst.id,
      revision: s.revision + 1,
    });
  },

  revision: 0,
  bumpRevision: () => set((s) => ({ revision: s.revision + 1 })),

  // メモリ使用量は EditorProvider が状態変化のたびに再計算する
  memoryUsage: new MemoryBudget(DEFAULT_CONFIG.memory.budget_mb).estimate({
    layerCount: 1,
    width: DEFAULT_CONFIG.canvas.default_width,
    height: DEFAULT_CONFIG.canvas.default_height,
    hasSelection: false,
  }),

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
    if (isIdentityAdjust(s.adjust)) return;
    // 対象は現在のレイヤー（改訂版仕様書 4.4: 全レイヤーはチェックで切替 → MS9）
    const targets = s.layers.filter((l) => l.id === s.activeLayerId);
    for (const layer of targets) {
      const mask = buildAdjustMask(
        s.adjustScope,
        s.selection,
        layer.canvas.width,
        layer.canvas.height
      );
      applyAdjustToLayer(layer, s.adjust, mask);
    }
    const d = s.config.tools.adjustment;
    set({
      revision: s.revision + 1,
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
  toggleGrid: () => set((s) => ({ view: { ...s.view, showGrid: !s.view.showGrid } })),
}));
