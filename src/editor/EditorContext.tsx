import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useConfig } from "../config/ConfigContext";
import { checkPixelLimit } from "../config/limits";
import { resolveMode, type EditorMode } from "../config/mode";
import type { BucketMode } from "../config/configTypes";
import { showErrorDialog } from "../components/notify";
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
  type ExportFormat,
} from "./ioTools";
import {
  ADJUST_LIMITS,
  applyAdjustToLayer,
  buildAdjustMask,
  isIdentityAdjust,
  type AdjustParams,
  type AdjustParamKey,
} from "./adjustTools";
import {
  cloneLayer,
  createBlankLayer,
  type Layer,
} from "./layerUtils";
import { isTypingTarget, matchesShortcut } from "./shortcuts";
import { MemoryBudget, type MemoryUsage } from "./memoryBudget";
import type { SelectionState, ToolId, ViewportSize, ViewState } from "./types";

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
  mode: EditorMode;
  /** ドキュメント名（保存時の既定ファイル名に使用） */
  docName: string;
  /** 全レイヤーを含めてリサイズ（仕様書 5 / Utility Mode） */
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
  /** 選択中レイヤー（Utility Mode は全レイヤー）へ破壊的に適用 */
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

const EditorContext = createContext<EditorContextValue | null>(null);

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

export function EditorProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig();

  const [docWidth, setDocWidth] = useState(config.canvas.default_width);
  const [docHeight, setDocHeight] = useState(config.canvas.default_height);
  const [docName, setDocName] = useState("untitled");
  const [tool, setTool] = useState<ToolId>("pen");
  const [primaryColor, setPrimaryColor] = useState(
    toHexColor(config.tools.pen.default_color)
  );
  const [secondaryColor, setSecondaryColor] = useState(
    toHexColor(config.tools.bucket.dither_secondary)
  );
  const [pen, setPen] = useState<PenOptions>({
    size: config.tools.pen.size,
    pixelPerfect: config.tools.pen.pixel_perfect,
  });
  const [eraserSize, setEraserSizeState] = useState(config.tools.eraser.size);
  const [bucket, setBucket] = useState<BucketOptions>({
    mode: config.tools.bucket.mode,
    tolerance: config.tools.bucket.tolerance,
    jitter: config.tools.bucket.jitter,
  });
  const [view, setView] = useState<ViewState>({
    zoom: 1,
    panX: 64,
    panY: 64,
    showGrid: config.ui.show_grid,
  });
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ w: 0, h: 0 });
  const [revision, setRevision] = useState(0);

  // --- 選択・色置換 ---
  const [selection, setSelectionState] = useState<SelectionState | null>(null);
  const [wand, setWand] = useState({
    tolerance: config.tools.magic_wand.tolerance,
    contiguous: config.tools.magic_wand.contiguous,
  });
  const [replace, setReplace] = useState({
    from: "#000000",
    to: "#ffffff",
    tolerance: config.tools.replace.tolerance,
    scope: "layer" as ReplaceScope,
  });

  // --- 色調整（仕様書 4.4） ---
  const [adjust, setAdjust] = useState<AdjustParams>({
    hue: config.tools.adjustment.hue,
    saturation: config.tools.adjustment.saturation,
    value: config.tools.adjustment.value,
    contrast: config.tools.adjustment.contrast,
  });
  const [adjustScope, setAdjustScope] = useState<ReplaceScope>("layer");

  // --- レイヤー初期状態: 1枚の空レイヤー ---
  const [layers, setLayers] = useState<Layer[]>(() => [
    createBlankLayer(
      config.canvas.default_width,
      config.canvas.default_height,
      "レイヤー 1",
      config.canvas.background_color
    ),
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string>("");

  // --- メモリ予算（仕様書 2.2: 全レイヤー + 選択マスク + 履歴 の合計上限） ---
  const budget = useMemo(
    () => new MemoryBudget(config.memory.budget_mb),
    [config.memory.budget_mb]
  );
  const memoryUsage = useMemo(
    () =>
      budget.estimate({
        layerCount: layers.length,
        width: docWidth,
        height: docHeight,
        hasSelection: selection !== null,
      }),
    [budget, docHeight, docWidth, layers.length, selection]
  );

  const bumpRevision = useCallback(() => setRevision((r) => r + 1), []);

  const setSelection = useCallback((sel: SelectionState | null) => {
    setSelectionState(sel);
  }, []);
  const clearSelection = useCallback(() => setSelectionState(null), []);
  const setWandTolerance = useCallback(
    (n: number) =>
      setWand((w) => ({ ...w, tolerance: Math.max(0, Math.min(255, Math.round(n))) })),
    []
  );
  const setWandContiguous = useCallback(
    (b: boolean) => setWand((w) => ({ ...w, contiguous: b })),
    []
  );
  const setReplaceFrom = useCallback(
    (hex: string) => setReplace((r) => ({ ...r, from: hex })),
    []
  );
  const setReplaceTo = useCallback(
    (hex: string) => setReplace((r) => ({ ...r, to: hex })),
    []
  );
  const setReplaceTolerance = useCallback(
    (n: number) =>
      setReplace((r) => ({
        ...r,
        tolerance: Math.max(0, Math.min(255, Math.round(n))),
      })),
    []
  );
  const setReplaceScope = useCallback(
    (s: ReplaceScope) => setReplace((r) => ({ ...r, scope: s })),
    []
  );

  const mode = resolveMode(
    docWidth,
    docHeight,
    config.canvas.full_feature_threshold
  );

  const defaultAdjust = config.tools.adjustment;
  const setAdjustParam = useCallback(
    (key: AdjustParamKey, value: number) => {
      const lim = ADJUST_LIMITS[key];
      setAdjust((a) => ({
        ...a,
        [key]: Math.max(lim.min, Math.min(lim.max, Math.round(value))),
      }));
    },
    []
  );
  const resetAdjust = useCallback(() => {
    setAdjust({
      hue: defaultAdjust.hue,
      saturation: defaultAdjust.saturation,
      value: defaultAdjust.value,
      contrast: defaultAdjust.contrast,
    });
  }, [defaultAdjust.contrast, defaultAdjust.hue, defaultAdjust.saturation, defaultAdjust.value]);

  const applyAdjust = useCallback(() => {
    if (isIdentityAdjust(adjust)) return;
    const targets =
      mode === "utility"
        ? layers
        : layers.filter((l) => l.id === activeLayerId);
    for (const layer of targets) {
      const mask = buildAdjustMask(
        adjustScope,
        selection,
        layer.canvas.width,
        layer.canvas.height
      );
      applyAdjustToLayer(layer, adjust, mask);
    }
    bumpRevision();
    resetAdjust();
  }, [
    activeLayerId,
    adjust,
    adjustScope,
    bumpRevision,
    layers,
    mode,
    resetAdjust,
    selection,
  ]);

  // activeLayerId の整合保証（削除・リセット後は最上層を選択）
  useEffect(() => {
    if (layers.length === 0) return;
    if (!layers.some((l) => l.id === activeLayerId)) {
      setActiveLayerId(layers[layers.length - 1].id);
    }
  }, [layers, activeLayerId]);

  // config.yaml（再）読み込み時に初期値を同期する
  useEffect(() => {
    setPen({
      size: config.tools.pen.size,
      pixelPerfect: config.tools.pen.pixel_perfect,
    });
    setEraserSizeState(config.tools.eraser.size);
    setBucket({
      mode: config.tools.bucket.mode,
      tolerance: config.tools.bucket.tolerance,
      jitter: config.tools.bucket.jitter,
    });
    setPrimaryColor(toHexColor(config.tools.pen.default_color));
    setSecondaryColor(toHexColor(config.tools.bucket.dither_secondary));
    setWand({
      tolerance: config.tools.magic_wand.tolerance,
      contiguous: config.tools.magic_wand.contiguous,
    });
    setReplace((r) => ({ ...r, tolerance: config.tools.replace.tolerance }));
    setAdjust({
      hue: config.tools.adjustment.hue,
      saturation: config.tools.adjustment.saturation,
      value: config.tools.adjustment.value,
      contrast: config.tools.adjustment.contrast,
    });
    setView((v) => ({
      ...v,
      zoom: clamp(v.zoom, config.canvas.zoom_min, config.canvas.zoom_max),
      showGrid: config.ui.show_grid,
    }));
  }, [config]);

  const setDocumentSize = useCallback(
    (w: number, h: number) => {
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      // 幅×高さの上限チェック（仕様書 2.2: canvas.max_pixels）
      const limitError = checkPixelLimit(nw, nh, config.canvas.max_pixels);
      if (limitError) {
        showErrorDialog(limitError);
        return;
      }
      // 全レイヤーのピクセルをスケール（仕様書 5 リサイズ）
      setLayers((prev) => {
        resizeLayers(prev, nw, nh);
        return [...prev];
      });
      setDocWidth(nw);
      setDocHeight(nh);
      setSelectionState(null);
      bumpRevision();
    },
    [bumpRevision, config.canvas.max_pixels]
  );

  const newDocument = useCallback(
    (w: number, h: number) => {
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      const limitError = checkPixelLimit(nw, nh, config.canvas.max_pixels);
      if (limitError) {
        showErrorDialog(limitError);
        return;
      }
      // 1レイヤーでも予算超過なら拒否（仕様書 2.2）
      const mem = budget.canAllocate(
        { layerCount: 1, width: nw, height: nh, hasSelection: false },
        0
      );
      if (!mem.ok) {
        showErrorDialog(mem.message);
        return;
      }
      setDocWidth(nw);
      setDocHeight(nh);
      setDocName("untitled");
      const layer = createBlankLayer(
        nw,
        nh,
        "レイヤー 1",
        config.canvas.background_color
      );
      setLayers([layer]);
      setActiveLayerId(layer.id);
      setSelectionState(null); // 新規作成時は選択を解除
      bumpRevision();
    },
    [budget, config.canvas.background_color, config.canvas.max_pixels, bumpRevision]
  );

  const loadImage = useCallback(
    async (src: string, name: string) => {
      const img = await loadImageElement(src);
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      // 超える画像は開かない（仕様書 5.2）
      const limitError = checkPixelLimit(nw, nh, config.canvas.max_pixels);
      if (limitError) {
        showErrorDialog(limitError);
        return;
      }
      // 1レイヤーでも予算超過なら拒否（仕様書 2.2）
      const mem = budget.canAllocate(
        { layerCount: 1, width: nw, height: nh, hasSelection: false },
        0
      );
      if (!mem.ok) {
        showErrorDialog(mem.message);
        return;
      }
      const layer = layerFromImage(img);
      setDocWidth(nw);
      setDocHeight(nh);
      setDocName(name.replace(/\.[^.]+$/, "") || "untitled");
      setLayers([layer]);
      setActiveLayerId(layer.id);
      setSelectionState(null);
      bumpRevision();
    },
    [budget, bumpRevision, config.canvas.max_pixels]
  );

  const cropDocument = useCallback(
    (x: number, y: number, w: number, h: number) => {
      const sx = clamp(Math.round(x), 0, docWidth - 1);
      const sy = clamp(Math.round(y), 0, docHeight - 1);
      const sw = clamp(Math.round(w), 1, docWidth - sx);
      const sh = clamp(Math.round(h), 1, docHeight - sy);
      setLayers((prev) => {
        cropLayers(prev, sx, sy, sw, sh);
        return [...prev];
      });
      setDocWidth(sw);
      setDocHeight(sh);
      setSelectionState(null);
      bumpRevision();
    },
    [bumpRevision, docHeight, docWidth]
  );

  const exportImage = useCallback(
    async (format: ExportFormat, scale: number): Promise<string | null> => {
      const canvas = renderExportCanvas(
        layers,
        docWidth,
        docHeight,
        scale,
        format === "jpeg" ? config.export.jpeg_background : undefined
      );
      const quality = qualityFor(
        format,
        format === "jpeg" ? config.export.jpeg_quality : config.export.webp_quality
      );
      const fileName = `${docName || "untitled"}.${EXPORT_EXT[format]}`;
      // Electron: ネイティブ保存ダイアログ（仕様書 5）
      if (window.electronAPI?.saveImageFile) {
        const dataUrl = canvas.toDataURL(
          format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp",
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
    [config.export.jpeg_background, config.export.jpeg_quality, config.export.webp_quality, docHeight, docName, docWidth, layers]
  );

  // --- レイヤー操作（仕様書 4.5） ---

  const addLayer = useCallback(() => {
    if (layers.length >= config.tools.layers.max_layers) return;
    // メモリ予算チェック（仕様書 2.2: 超過は拒否してメッセージを表示）
    const check = budget.canAllocate(
      {
        layerCount: layers.length + 1,
        width: docWidth,
        height: docHeight,
        hasSelection: selection !== null,
      },
      0
    );
    if (!check.ok) {
      showErrorDialog(check.message);
      return;
    }
    const index = layers.findIndex((l) => l.id === activeLayerId);
    const insertAt = index >= 0 ? index + 1 : layers.length;
    const layer = createBlankLayer(
      docWidth,
      docHeight,
      nextLayerName(layers),
      config.canvas.background_color
    );
    const next = [...layers];
    next.splice(insertAt, 0, layer);
    setLayers(next);
    setActiveLayerId(layer.id);
    bumpRevision();
  }, [
    activeLayerId,
    budget,
    bumpRevision,
    config.canvas.background_color,
    config.tools.layers.max_layers,
    docHeight,
    docWidth,
    layers,
    selection,
  ]);

  const duplicateLayer = useCallback(
    (id: string) => {
      const index = layers.findIndex((l) => l.id === id);
      if (index < 0) return;
      // メモリ予算チェック（仕様書 2.2）
      const check = budget.canAllocate(
        {
          layerCount: layers.length + 1,
          width: docWidth,
          height: docHeight,
          hasSelection: selection !== null,
        },
        0
      );
      if (!check.ok) {
        showErrorDialog(check.message);
        return;
      }
      const source = layers[index];
      const copy = cloneLayer(source, `${source.name} のコピー`);
      const next = [...layers];
      next.splice(index + 1, 0, copy);
      setLayers(next);
      setActiveLayerId(copy.id);
      bumpRevision();
    },
    [budget, bumpRevision, docHeight, docWidth, layers, selection]
  );

  const deleteLayer = useCallback(
    (id: string) => {
      setLayers((prev) => {
        if (prev.length <= 1) return prev;
        const index = prev.findIndex((l) => l.id === id);
        if (index < 0) return prev;
        return prev.filter((l) => l.id !== id);
      });
      bumpRevision();
    },
    [bumpRevision]
  );

  const moveLayer = useCallback(
    (id: string, dir: 1 | -1) => {
      setLayers((prev) => {
        const index = prev.findIndex((l) => l.id === id);
        const target = index + dir;
        if (index < 0 || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
      bumpRevision();
    },
    [bumpRevision]
  );

  const setLayerOpacity = useCallback(
    (id: string, opacity: number) => {
      const v = clamp(Math.round(opacity), 0, 100);
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, opacity: v } : l))
      );
      bumpRevision();
    },
    [bumpRevision]
  );

  const toggleLayerVisible = useCallback(
    (id: string) => {
      setLayers((prev) =>
        prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
      );
      bumpRevision();
    },
    [bumpRevision]
  );

  const mergeDown = useCallback(
    (id: string) => {
      const index = layers.findIndex((l) => l.id === id);
      if (index <= 0) return;
      const src = layers[index];
      const dst = layers[index - 1];
      const ctx = dst.canvas.getContext("2d")!;
      ctx.globalAlpha = src.opacity / 100;
      ctx.drawImage(src.canvas, 0, 0);
      ctx.globalAlpha = 1;
      setLayers(layers.filter((l) => l.id !== src.id));
      setActiveLayerId(dst.id);
      bumpRevision();
    },
    [bumpRevision, layers]
  );

  // --- ビューポート操作 ---

  const setZoom = useCallback(
    (zoom: number, anchor?: { x: number; y: number }) => {
      setView((v) => {
        const next = clamp(zoom, config.canvas.zoom_min, config.canvas.zoom_max);
        if (next === v.zoom) return v;
        const ax = anchor?.x ?? viewportSize.w / 2;
        const ay = anchor?.y ?? viewportSize.h / 2;
        const docX = (ax - v.panX) / v.zoom;
        const docY = (ay - v.panY) / v.zoom;
        return { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next };
      });
    },
    [config.canvas.zoom_max, config.canvas.zoom_min, viewportSize.h, viewportSize.w]
  );

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((v) => {
        const next = clamp(v.zoom * factor, config.canvas.zoom_min, config.canvas.zoom_max);
        if (next === v.zoom) return v;
        const ax = anchor?.x ?? viewportSize.w / 2;
        const ay = anchor?.y ?? viewportSize.h / 2;
        const docX = (ax - v.panX) / v.zoom;
        const docY = (ay - v.panY) / v.zoom;
        return { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next };
      });
    },
    [config.canvas.zoom_max, config.canvas.zoom_min, viewportSize.h, viewportSize.w]
  );

  const resetZoom = useCallback(() => {
    setView((v) => {
      const next = clamp(1, config.canvas.zoom_min, config.canvas.zoom_max);
      const ax = viewportSize.w / 2;
      const ay = viewportSize.h / 2;
      const docX = (ax - v.panX) / v.zoom;
      const docY = (ay - v.panY) / v.zoom;
      return { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next };
    });
  }, [config.canvas.zoom_max, config.canvas.zoom_min, viewportSize.h, viewportSize.w]);

  const toggleGrid = useCallback(() => {
    setView((v) => ({ ...v, showGrid: !v.showGrid }));
  }, []);

  const swapColors = useCallback(() => {
    setPrimaryColor(secondaryColor);
    setSecondaryColor(primaryColor);
  }, [primaryColor, secondaryColor]);

  const setPenSize = useCallback(
    (n: number) =>
      setPen((p) => ({
        ...p,
        size: clamp(Math.round(n), 1, config.tools.pen.max_size),
      })),
    [config.tools.pen.max_size]
  );
  const setPenPixelPerfect = useCallback(
    (b: boolean) => setPen((p) => ({ ...p, pixelPerfect: b })),
    []
  );
  const setEraserSize = useCallback(
    (n: number) =>
      setEraserSizeState(clamp(Math.round(n), 1, config.tools.eraser.max_size)),
    [config.tools.eraser.max_size]
  );
  const setBucketMode = useCallback(
    (m: BucketMode) => setBucket((b) => ({ ...b, mode: m })),
    []
  );
  const setBucketTolerance = useCallback(
    (n: number) => setBucket((b) => ({ ...b, tolerance: clamp(Math.round(n), 0, 255) })),
    []
  );
  const setBucketJitter = useCallback(
    (n: number) => setBucket((b) => ({ ...b, jitter: clamp(Math.round(n), 0, 100) })),
    []
  );

  // config.yaml のショートカット（ズーム・グリッド）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        // 選択解除
        setSelectionState((s) => (s ? null : s));
        return;
      }
      if (matchesShortcut(e, config.shortcuts.toggle_grid)) {
        e.preventDefault();
        toggleGrid();
      } else if (matchesShortcut(e, config.shortcuts.zoom_in)) {
        e.preventDefault();
        zoomBy(config.ui.zoom_step);
      } else if (matchesShortcut(e, config.shortcuts.zoom_out)) {
        e.preventDefault();
        zoomBy(1 / config.ui.zoom_step);
      } else if (matchesShortcut(e, config.shortcuts.zoom_reset)) {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config.shortcuts, config.ui.zoom_step, resetZoom, toggleGrid, zoomBy]);

  const value = useMemo<EditorContextValue>(
    () => ({
      docWidth,
      docHeight,
      mode,
      docName,
      setDocumentSize,
      newDocument,
      loadImage,
      cropDocument,
      exportImage,
      tool,
      setTool,
      primaryColor,
      setPrimaryColor,
      secondaryColor,
      setSecondaryColor,
      swapColors,
      pen,
      setPenSize,
      setPenPixelPerfect,
      eraserSize,
      setEraserSize,
      bucket,
      setBucketMode,
      setBucketTolerance,
      setBucketJitter,
      layers,
      activeLayerId,
      setActiveLayerId,
      addLayer,
      duplicateLayer,
      deleteLayer,
      moveLayer,
      setLayerOpacity,
      toggleLayerVisible,
      mergeDown,
      revision,
      bumpRevision,
      selection,
      setSelection,
      clearSelection,
      wand,
      setWandTolerance,
      setWandContiguous,
      replace,
      setReplaceFrom,
      setReplaceTo,
      setReplaceTolerance,
      setReplaceScope,
      adjust,
      adjustScope,
      setAdjustParam,
      setAdjustScope,
      resetAdjust,
      applyAdjust,
      view,
      setView,
      viewportSize,
      setViewportSize,
      setZoom,
      zoomBy,
      resetZoom,
      toggleGrid,
      memoryUsage,
    }),
    [
      docWidth,
      docHeight,
      mode,
      docName,
      setDocumentSize,
      newDocument,
      loadImage,
      cropDocument,
      exportImage,
      tool,
      primaryColor,
      secondaryColor,
      swapColors,
      pen,
      setPenSize,
      setPenPixelPerfect,
      eraserSize,
      setEraserSize,
      bucket,
      setBucketMode,
      setBucketTolerance,
      setBucketJitter,
      layers,
      activeLayerId,
      addLayer,
      duplicateLayer,
      deleteLayer,
      moveLayer,
      setLayerOpacity,
      toggleLayerVisible,
      mergeDown,
      revision,
      bumpRevision,
      selection,
      setSelection,
      clearSelection,
      wand,
      setWandTolerance,
      setWandContiguous,
      replace,
      setReplaceFrom,
      setReplaceTo,
      setReplaceTolerance,
      setReplaceScope,
      adjust,
      adjustScope,
      setAdjustParam,
      setAdjustScope,
      resetAdjust,
      applyAdjust,
      view,
      viewportSize,
      setZoom,
      zoomBy,
      resetZoom,
      toggleGrid,
      memoryUsage,
    ]
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor は EditorProvider 配下でのみ使用できます");
  return ctx;
}
