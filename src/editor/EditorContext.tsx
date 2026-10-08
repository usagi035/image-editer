import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useConfig } from "../config/ConfigContext";
import { resolveMode, type EditorMode } from "../config/mode";
import type { BucketMode } from "../config/configTypes";
import { isTypingTarget, matchesShortcut } from "./shortcuts";
import type { ToolId, ViewportSize, ViewState } from "./types";

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
  setDocumentSize: (w: number, h: number) => void;
  /** 新規作成時にレイヤー等をリセットするためのフック（Unit D で拡張） */
  onNewDocument: () => void;
  setOnNewDocument: (fn: () => void) => void;

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

export function EditorProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig();

  const [docWidth, setDocWidth] = useState(config.canvas.default_width);
  const [docHeight, setDocHeight] = useState(config.canvas.default_height);
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
  const newDocRef = useRef<() => void>(() => {});

  const setOnNewDocument = useCallback((fn: () => void) => {
    newDocRef.current = fn;
  }, []);

  const onNewDocument = useCallback(() => newDocRef.current(), []);

  const mode = resolveMode(
    docWidth,
    docHeight,
    config.canvas.full_feature_threshold
  );

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
    setView((v) => ({
      ...v,
      zoom: clamp(v.zoom, config.ui.zoom_min, config.ui.zoom_max),
      showGrid: config.ui.show_grid,
    }));
  }, [config]);

  const setDocumentSize = useCallback((w: number, h: number) => {
    const max = config.canvas.max_size;
    setDocWidth(clamp(Math.round(w), 1, max));
    setDocHeight(clamp(Math.round(h), 1, max));
  }, [config.canvas.max_size]);

  const setZoom = useCallback(
    (zoom: number, anchor?: { x: number; y: number }) => {
      setView((v) => {
        const next = clamp(zoom, config.ui.zoom_min, config.ui.zoom_max);
        if (next === v.zoom) return v;
        const ax = anchor?.x ?? viewportSize.w / 2;
        const ay = anchor?.y ?? viewportSize.h / 2;
        // アンカー下のキャンバス点を維持する
        const docX = (ax - v.panX) / v.zoom;
        const docY = (ay - v.panY) / v.zoom;
        return {
          ...v,
          zoom: next,
          panX: ax - docX * next,
          panY: ay - docY * next,
        };
      });
    },
    [config.ui.zoom_max, config.ui.zoom_min, viewportSize.h, viewportSize.w]
  );

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setView((v) => {
        const next = clamp(v.zoom * factor, config.ui.zoom_min, config.ui.zoom_max);
        if (next === v.zoom) return v;
        const ax = anchor?.x ?? viewportSize.w / 2;
        const ay = anchor?.y ?? viewportSize.h / 2;
        const docX = (ax - v.panX) / v.zoom;
        const docY = (ay - v.panY) / v.zoom;
        return { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next };
      });
    },
    [config.ui.zoom_max, config.ui.zoom_min, viewportSize.h, viewportSize.w]
  );

  const resetZoom = useCallback(() => {
    setView((v) => {
      const next = clamp(1, config.ui.zoom_min, config.ui.zoom_max);
      const ax = viewportSize.w / 2;
      const ay = viewportSize.h / 2;
      const docX = (ax - v.panX) / v.zoom;
      const docY = (ay - v.panY) / v.zoom;
      return { ...v, zoom: next, panX: ax - docX * next, panY: ay - docY * next };
    });
  }, [config.ui.zoom_max, config.ui.zoom_min, viewportSize.h, viewportSize.w]);

  const toggleGrid = useCallback(() => {
    setView((v) => ({ ...v, showGrid: !v.showGrid }));
  }, []);

  const swapColors = useCallback(() => {
    setPrimaryColor(secondaryColor);
    setSecondaryColor(primaryColor);
  }, [primaryColor, secondaryColor]);

  const setPenSize = useCallback(
    (n: number) =>
      setPen((p) => ({ ...p, size: clamp(Math.round(n), 1, config.tools.pen.max_size) })),
    [config.tools.pen.max_size]
  );
  const setPenPixelPerfect = useCallback(
    (b: boolean) => setPen((p) => ({ ...p, pixelPerfect: b })),
    []
  );
  const setEraserSize = useCallback(
    (n: number) =>
      setEraserSizeState(
        clamp(Math.round(n), 1, config.tools.eraser.max_size)
      ),
    [config.tools.eraser.max_size]
  );
  const setBucketMode = useCallback(
    (m: BucketMode) => setBucket((b) => ({ ...b, mode: m })),
    []
  );
  const setBucketTolerance = useCallback(
    (n: number) =>
      setBucket((b) => ({ ...b, tolerance: clamp(Math.round(n), 0, 255) })),
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
      setDocumentSize,
      onNewDocument,
      setOnNewDocument,
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
      view,
      setView,
      viewportSize,
      setViewportSize,
      setZoom,
      zoomBy,
      resetZoom,
      toggleGrid,
    }),
    [
      docWidth,
      docHeight,
      mode,
      setDocumentSize,
      onNewDocument,
      setOnNewDocument,
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
      view,
      viewportSize,
      setZoom,
      zoomBy,
      resetZoom,
      toggleGrid,
    ]
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor は EditorProvider 配下でのみ使用できます");
  return ctx;
}
