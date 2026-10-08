import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "../config/ConfigContext";
import { isPaintToolAllowed } from "../config/mode";
import { useEditor } from "../editor/EditorContext";
import { getComposite } from "../editor/compositor";
import { applyBucketToLayer } from "../editor/bucketTools";
import { hexToUint32, uint32ToHex } from "../editor/colorUtils";
import {
  beginStroke,
  continueStroke,
  endStroke,
  type StrokeSession,
} from "../editor/drawTools";
import { isTypingTarget, matchesShortcut } from "../editor/shortcuts";
import { renderViewport } from "../editor/viewportRenderer";
import { viewToDoc, type DocPoint } from "../editor/types";

/**
 * キャンバス表示エリア（仕様書 3. Center Panel）
 * - マウスホイール: ズームイン/アウト（カーソル位置基準）
 * - Space+ドラッグ / 中ボタンドラッグ: パン
 * - グリッド線オーバーレイ
 */
export default function CanvasViewport() {
  const { config } = useConfig();
  const {
    docWidth,
    docHeight,
    view,
    setView,
    zoomBy,
    setViewportSize,
    layers,
    revision,
    tool,
    pen,
    eraserSize,
    bucket,
    primaryColor,
    secondaryColor,
    setPrimaryColor,
    mode,
    activeLayerId,
    bumpRevision,
  } = useEditor();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeRef = useRef<import("../editor/compositor").CompositeCache | null>(null);
  const strokeRef = useRef<StrokeSession | null>(null);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  // --- サイズ追従（ResizeObserver） ---
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio;
      const w = el.clientWidth;
      const h = el.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      setSize({ w, h });
      setViewportSize({ w, h });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewportSize]);

  // --- 描画（レイヤー合成は revision ベースでキャッシュ） ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderViewport({
      ctx,
      cssWidth: size.w,
      cssHeight: size.h,
      dpr: window.devicePixelRatio,
      docWidth,
      docHeight,
      view,
      config,
      composite: (docCtx) => {
        compositeRef.current = getComposite(
          compositeRef.current,
          layers,
          docWidth,
          docHeight,
          revision
        );
        docCtx.drawImage(compositeRef.current.canvas, 0, 0);
      },
    });
  }, [size, view, docWidth, docHeight, config, layers, revision]);

  // --- ホイールズーム（preventDefault のため非 passive で購読） ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor =
        e.deltaY < 0 ? config.ui.zoom_step : 1 / config.ui.zoom_step;
      zoomBy(factor, anchor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [config.ui.zoom_step, zoomBy]);

  // --- Space ボタン監視（パンモード） ---
  useEffect(() => {
    const panSpec = config.shortcuts.pan;
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (matchesShortcut(e, panSpec)) {
        spaceRef.current = true;
        setSpaceHeld(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (matchesShortcut(e, panSpec)) {
        spaceRef.current = false;
        setSpaceHeld(false);
        panRef.current = null;
        setPanning(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [config.shortcuts.pan]);

  /** イベント → キャンバス座標 */
  const docPointFromEvent = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): DocPoint => {
      const rect = e.currentTarget.getBoundingClientRect();
      return viewToDoc(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        view
      );
    },
    [view]
  );

  /** ペン / 消しゴム: ストローク開始 */
  const startStroke = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): boolean => {
      const layer = layers.find((l) => l.id === activeLayerId);
      if (!layer) return false;
      const erase = tool === "eraser";
      const session = beginStroke(
        layer,
        {
          color: hexToUint32(primaryColor),
          size: erase ? eraserSize : pen.size,
          erase,
          pixelPerfect: pen.pixelPerfect,
        },
        docPointFromEvent(e)
      );
      if (!session) return false;
      strokeRef.current = session;
      bumpRevision();
      return true;
    },
    [
      activeLayerId,
      bumpRevision,
      docPointFromEvent,
      eraserSize,
      layers,
      pen.pixelPerfect,
      pen.size,
      primaryColor,
      tool,
    ]
  );

  /** スポイト: クリック箇所の RGBA を取得して主色に設定 */
  const sampleColor = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = docPointFromEvent(e);
      const { sample_merged } = config.tools.eyedropper;
      let canvas: HTMLCanvasElement;
      if (sample_merged) {
        const cache = getComposite(
          compositeRef.current,
          layers,
          docWidth,
          docHeight,
          revision
        );
        compositeRef.current = cache;
        canvas = cache.canvas;
      } else {
        const layer = layers.find((l) => l.id === activeLayerId);
        if (!layer) return;
        canvas = layer.canvas;
      }
      if (p.x < 0 || p.x >= canvas.width || p.y < 0 || p.y >= canvas.height)
        return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const d = ctx.getImageData(p.x, p.y, 1, 1).data;
      const hex = uint32ToHex(
        ((d[3] << 24) | (d[2] << 16) | (d[1] << 8) | d[0]) >>> 0
      );
      setPrimaryColor(hex);
    },
    [
      activeLayerId,
      config.tools.eyedropper,
      compositeRef,
      docHeight,
      docPointFromEvent,
      docWidth,
      layers,
      revision,
      setPrimaryColor,
    ]
  );

  const startPan = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      panRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: view.panX,
        panY: view.panY,
      };
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [view.panX, view.panY]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 中ボタン、または Space+左ドラッグでパン
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        startPan(e);
        return;
      }
      if (e.button !== 0) return;
      // Utility Mode では描画系ツールを受け付けない（仕様書 2.2）
      if (!isPaintToolAllowed(tool, mode)) return;

      if (tool === "pen" || tool === "eraser") {
        e.currentTarget.setPointerCapture(e.pointerId);
        startStroke(e);
      } else if (tool === "eyedropper") {
        sampleColor(e);
      } else if (tool === "bucket") {
        // 特殊バケツ（Uint32Array メモリ直接操作）
        const layer = layers.find((l) => l.id === activeLayerId);
        const p = docPointFromEvent(e);
        if (!layer) return;
        if (p.x < 0 || p.x >= docWidth || p.y < 0 || p.y >= docHeight) return;
        applyBucketToLayer(
          layer,
          bucket.mode,
          {
            color: hexToUint32(primaryColor),
            color2: hexToUint32(secondaryColor),
            tolerance: bucket.tolerance,
            jitter: bucket.jitter,
            ditherCell: config.tools.bucket.dither_pattern_size,
          },
          p
        );
        bumpRevision();
      }
      // colorReplace / 選択 / crop 等は各機能単位で実装
    },
    [
      activeLayerId,
      bucket,
      bumpRevision,
      config.tools.bucket.dither_pattern_size,
      docHeight,
      docPointFromEvent,
      docWidth,
      layers,
      mode,
      primaryColor,
      secondaryColor,
      startPan,
      startStroke,
      sampleColor,
      tool,
    ]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = panRef.current;
      if (p) {
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        setView((v) => ({ ...v, panX: p.panX + dx, panY: p.panY + dy }));
        return;
      }
      const session = strokeRef.current;
      if (session) {
        continueStroke(session, docPointFromEvent(e));
        bumpRevision();
      }
    },
    [bumpRevision, docPointFromEvent, setView]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
    }
    const session = strokeRef.current;
    if (session) {
      endStroke(session);
      strokeRef.current = null;
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const cursor = panning ? "grabbing" : spaceHeld ? "grab" : "crosshair";

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 flex-1 overflow-hidden"
      style={{ touchAction: "none", cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="absolute left-0 top-0" />
    </div>
  );
}
