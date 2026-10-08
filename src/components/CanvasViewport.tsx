import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "../config/ConfigContext";
import { useEditor } from "../editor/EditorContext";
import { isTypingTarget, matchesShortcut } from "../editor/shortcuts";
import { renderViewport } from "../editor/viewportRenderer";

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
  } = useEditor();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  // --- 描画 ---
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
    });
  }, [size, view, docWidth, docHeight, config]);

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
      }
    },
    [startPan]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = panRef.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      setView((v) => ({ ...v, panX: p.panX + dx, panY: p.panY + dy }));
    },
    [setView]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
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
