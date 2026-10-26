import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "../config/ConfigContext";
import { useEditor } from "../editor/EditorContext";
import {
  getAdjustPreview,
  isIdentityAdjust,
  type AdjustPreviewCache,
} from "../editor/adjustTools";
import {
  getComposite,
  sampleMergedPixel,
} from "../editor/compositor";
import { hexToUint32, uint32ToHex } from "../editor/colorUtils";
import {
  beginStroke,
  continueStroke,
  endStroke,
  segmentBounds,
  type StrokeSession,
} from "../editor/drawTools";
import { isTypingTarget, matchesShortcut } from "../editor/shortcuts";
import { getFloatingCanvas } from "../editor/clipboardTools";
import {
  buildSelectionMask,
  createRectSelection,
  createWandSelection,
} from "../editor/selectionTools";
import {
  constrainShapeEnd,
  mirrorShapes,
  type ShapeKind,
} from "../editor/shapeTools";
import {
  renderViewport,
  type ShapePreviewOverlay,
  type ViewportRenderParams,
} from "../editor/viewportRenderer";
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
    runBucket,
    workerJob,
    primaryColor,
    secondaryColor,
    setPrimaryColor,
    activeLayerId,
    bumpRevision,
    selection,
    wand,
    setReplaceFrom,
    adjust,
    adjustScope,
    loadImage,
    historyBegin,
    commitStrokeHistory,
    applySelectionOperation,
    floatingRect,
    setFloatingPos,
    shape,
    runShape,
  } = useEditor();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeRef = useRef<import("../editor/compositor").CompositeCache | null>(null);
  const adjustPreviewRef = useRef<AdjustPreviewCache | null>(null);
  const strokeRef = useRef<StrokeSession | null>(null);
  /** ストローク対象レイヤー（commitStrokeHistory へ渡す） */
  const strokeLayerIdRef = useRef<string>("");
  const selectRef = useRef<DocPoint | null>(null);
  /** 矩形選択ドラッグ中の演算モード（Shift=加算 / Alt=減算 / 通常） */
  const selectModeRef = useRef<"replace" | "add" | "subtract">("replace");
  /** 浮遊レイヤーのドラッグ移動中かどうか */
  const floatingDragRef = useRef<{
    x: number;
    y: number;
    fx: number;
    fy: number;
  } | null>(null);
  /** 図形ツールのドラッグセッション（仕様書 4.1: ドラッグ中プレビュー → 離しで確定） */
  const shapeRef = useRef<{
    kind: ShapeKind;
    start: DocPoint;
    end: DocPoint;
  } | null>(null);
  const [shapePreview, setShapePreview] = useState<ShapePreviewOverlay | null>(null);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  /** マーチングアンツの位相（選択中のみ進行） */
  const [antsTick, setAntsTick] = useState(0);

  // --- ドラッグ＆ドロップ読み込み（仕様書 5） ---
  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropActive(false);
      const file = e.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      try {
        await loadImage(URL.createObjectURL(file), file.name);
      } catch (err) {
        console.error(err);
      }
    },
    [loadImage]
  );

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

  // --- 描画（rAF でまとめ、ビューポート範囲 ∩ ダーティ矩形のみ合成: 仕様書 7 / 2.2） ---
  const drawParamsRef = useRef<Omit<ViewportRenderParams, "ctx"> | null>(null);
  const rafRef = useRef<number | null>(null);

  // マーチングアンツ: 選択がある間は破線の位相を進める（仕様書 4.3）
  const hasSelection = selection !== null;
  useEffect(() => {
    if (!hasSelection) return;
    const id = window.setInterval(() => setAntsTick((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [hasSelection]);

  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    // 色調整ツールでパラメータが変化している時はリアルタイムプレビュー（仕様書 4.4）
    const previewing = tool === "hsv" && !isIdentityAdjust(adjust);
    drawParamsRef.current = {
      cssWidth: size.w,
      cssHeight: size.h,
      dpr: window.devicePixelRatio,
      docWidth,
      docHeight,
      view,
      config,
      selection,
      antsOffset: antsTick % 8,
      shapePreview,
      composite: (docCtx) => {
        if (previewing) {
          adjustPreviewRef.current = getAdjustPreview(adjustPreviewRef.current, {
            layers,
            activeLayerId,
            params: adjust,
            scope: adjustScope,
            selection,
            width: docWidth,
            height: docHeight,
            revision,
          });
          docCtx.drawImage(adjustPreviewRef.current.canvas, 0, 0, docWidth, docHeight);
        } else {
          // ビューポート範囲のみ合成（画像全体サイズの Canvas は作らない。仕様書 2.2）
          const cache = getComposite(compositeRef.current, {
            layers,
            revision,
            view,
            cssWidth: size.w,
            cssHeight: size.h,
            dpr: window.devicePixelRatio,
            docWidth,
            docHeight,
          });
          compositeRef.current = cache;
          if (cache.region.w > 0 && cache.region.h > 0) {
            // キャンバスは画面デバイス解像度 → デバイス座標で等倍描画（ズーム変更分は合成側で再計算済み）
            docCtx.setTransform(1, 0, 0, 1, 0, 0);
            docCtx.drawImage(cache.canvas, cache.region.x, cache.region.y);
          }
        }
        // 貼り付け浮遊レイヤーを最前面に描画（仕様書 4.3）
        const fl = floatingRect ? getFloatingCanvas() : null;
        if (fl && floatingRect) {
          const dpr = window.devicePixelRatio;
          docCtx.setTransform(
            dpr * view.zoom,
            0,
            0,
            dpr * view.zoom,
            view.panX * dpr,
            view.panY * dpr
          );
          docCtx.drawImage(fl, floatingRect.x, floatingRect.y);
        }
      },
    };
    // 同一フレーム内の複数の状態変化は 1 回の描画にまとめる
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = drawParamsRef.current;
      const ctx = canvasRef.current?.getContext("2d");
      if (!p || !ctx) return;
      renderViewport({ ...p, ctx });
    });
  }, [
    size,
    view,
    docWidth,
    docHeight,
    config,
    layers,
    revision,
    selection,
    antsTick,
    floatingRect,
    shapePreview,
    tool,
    adjust,
    adjustScope,
    activeLayerId,
  ]);

  // アンマウント時の予約済み rAF 解放
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

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
      const start = docPointFromEvent(e);
      const session = beginStroke(
        layer,
        {
          color: hexToUint32(primaryColor),
          size: erase ? eraserSize : pen.size,
          erase,
          pixelPerfect: pen.pixelPerfect,
          // 選択領域外へのペイントを遮断（仕様書 4.3）
          mask: buildSelectionMask(selection, docWidth, docHeight),
          // ミラー描画（仕様書 4.1: 縦軸/横軸/両方）
          mirror: shape.mirror,
        },
        start
      );
      if (!session) return false;
      strokeRef.current = session;
      strokeLayerIdRef.current = layer.id;
      historyBegin(erase ? "消しゴム" : "描画"); // 1 ストローク = 1 ステップ（仕様書 4.6）
      // 1 点ぶんの押印範囲のみダーティ登録（ストローク全体 bbox ではない）
      bumpRevision(segmentBounds(start, start, session.size));
      return true;
    },
    [
      activeLayerId,
      bumpRevision,
      docHeight,
      docPointFromEvent,
      docWidth,
      eraserSize,
      historyBegin,
      layers,
      pen.pixelPerfect,
      pen.size,
      primaryColor,
      selection,
      shape.mirror,
      tool,
    ]
  );

  /** 図形ドラッグ中のプレビュー更新（Shift 拘束 + ミラー展開。仕様書 4.1） */
  const updateShapePreview = useCallback(
    (shift: boolean) => {
      const sh = shapeRef.current;
      if (!sh) {
        setShapePreview(null);
        return;
      }
      const end = constrainShapeEnd(sh.kind, sh.start, sh.end, shift);
      setShapePreview({
        shapes: mirrorShapes(
          { kind: sh.kind, start: sh.start, end, fill: shape.fillMode },
          docWidth,
          docHeight,
          shape.mirror
        ),
        color: primaryColor,
      });
    },
    [docHeight, docWidth, primaryColor, shape.fillMode, shape.mirror]
  );

  /** スポイト: クリック箇所の RGBA を取得して主色に設定 */
  const sampleColor = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = docPointFromEvent(e);
      if (p.x < 0 || p.y < 0 || p.x >= docWidth || p.y >= docHeight) return;
      let px: number;
      if (config.tools.eyedropper.sample_merged) {
        // 合成色は 1px だけ取得（画像全体の合成 Canvas は作らない。仕様書 2.2）
        px = sampleMergedPixel(layers, p.x, p.y);
      } else {
        const layer = layers.find((l) => l.id === activeLayerId);
        if (!layer) return;
        if (p.x >= layer.width || p.y >= layer.height) return;
        px = layer.pixels[p.y * layer.width + p.x];
      }
      setPrimaryColor(uint32ToHex(px));
    },
    [
      activeLayerId,
      config.tools.eyedropper,
      docHeight,
      docPointFromEvent,
      docWidth,
      layers,
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
      // Worker 実行中は編集操作をロック（パンは可。仕様書 2.2）
      if (workerJob) return;

      // 貼り付け浮遊レイヤー: ドラッグで移動（クリックのみでは確定しない。仕様書 4.3）
      if (floatingRect) {
        e.currentTarget.setPointerCapture(e.pointerId);
        floatingDragRef.current = {
          x: e.clientX,
          y: e.clientY,
          fx: floatingRect.x,
          fy: floatingRect.y,
        };
        e.preventDefault();
        return;
      }

      if (tool === "pen" || tool === "eraser") {
        e.currentTarget.setPointerCapture(e.pointerId);
        startStroke(e);
      } else if (tool === "eyedropper") {
        sampleColor(e);
      } else if (tool === "bucket") {
        // 特殊バケツ（閾値以上は Worker 実行・進捗表示とキャンセル付き: 仕様書 2.2 / 4.2）
        const layer = layers.find((l) => l.id === activeLayerId);
        const p = docPointFromEvent(e);
        if (!layer) return;
        if (p.x < 0 || p.x >= docWidth || p.y < 0 || p.y >= docHeight) return;
        runBucket(
          layer.id,
          bucket.mode,
          {
            color: hexToUint32(primaryColor),
            color2: hexToUint32(secondaryColor),
            tolerance: bucket.tolerance,
            jitter: bucket.jitter,
            ditherCell: config.tools.bucket.dither_pattern_size,
          },
          p,
          buildSelectionMask(selection, docWidth, docHeight)
        );
      } else if (tool === "line" || tool === "rect" || tool === "ellipse") {
        // 図形ツール: ドラッグ中プレビュー → 離した時点で確定（仕様書 4.1）
        const p = docPointFromEvent(e);
        shapeRef.current = { kind: tool, start: p, end: p };
        e.currentTarget.setPointerCapture(e.pointerId);
        updateShapePreview(e.shiftKey);
      } else if (tool === "rectSelect" || tool === "crop") {
        // 矩形選択 / クロップ範囲指定: ドラッグで範囲指定（クリックは1px選択）
        // Shift=加算 / Alt=減算（仕様書 4.3: 選択演算）
        selectModeRef.current = e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";
        e.currentTarget.setPointerCapture(e.pointerId);
        selectRef.current = docPointFromEvent(e);
        applySelectionOperation(
          createRectSelection(
            selectRef.current.x,
            selectRef.current.y,
            selectRef.current.x,
            selectRef.current.y,
            docWidth,
            docHeight
          ),
          selectModeRef.current
        );
      } else if (tool === "magicWand") {
        // 魔術の杖: クリック点の同色領域を選択（レイヤー本体の Uint32Array を直接参照）
        const layer = layers.find((l) => l.id === activeLayerId);
        const p = docPointFromEvent(e);
        if (!layer) return;
        applySelectionOperation(
          createWandSelection(
            layer.pixels,
            docWidth,
            docHeight,
            p.x,
            p.y,
            wand.tolerance,
            wand.contiguous
          ),
          e.shiftKey ? "add" : e.altKey ? "subtract" : "replace"
        );
      } else if (tool === "colorReplace") {
        // 色置換: クリックした色を「置換元」として設定
        const layer = layers.find((l) => l.id === activeLayerId);
        const p = docPointFromEvent(e);
        if (!layer) return;
        if (p.x < 0 || p.x >= docWidth || p.y < 0 || p.y >= docHeight) return;
        if (p.x >= layer.width || p.y >= layer.height) return;
        setReplaceFrom(uint32ToHex(layer.pixels[p.y * layer.width + p.x]));
      }
      // crop / resize / hsv 等は各機能単位で実装
    },
    [
      activeLayerId,
      applySelectionOperation,
      bucket,
      config.tools.bucket.dither_pattern_size,
      docHeight,
      docPointFromEvent,
      docWidth,
      floatingRect,
      layers,
      primaryColor,
      runBucket,
      secondaryColor,
      selection,
      setReplaceFrom,
      startPan,
      startStroke,
      sampleColor,
      tool,
      updateShapePreview,
      wand,
      workerJob,
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
      // 浮遊レイヤーのドラッグ移動（ズーム倍率に合わせてドキュメント座標へ変換）
      const fd = floatingDragRef.current;
      if (fd) {
        const dx = Math.round((e.clientX - fd.x) / view.zoom);
        const dy = Math.round((e.clientY - fd.y) / view.zoom);
        setFloatingPos(fd.fx + dx, fd.fy + dy);
        return;
      }
      // 矩形選択のドラッグ追従（演算モードを維持: 加算/減算も逐次合成して正しい結果になる）
      const anchor = selectRef.current;
      if (anchor) {
        const cur = docPointFromEvent(e);
        applySelectionOperation(
          createRectSelection(anchor.x, anchor.y, cur.x, cur.y, docWidth, docHeight),
          selectModeRef.current
        );
        return;
      }
      // 図形ツールのドラッグ追従（プレビュー更新のみ・レイヤー本体は未書き込み）
      const sh = shapeRef.current;
      if (sh) {
        sh.end = docPointFromEvent(e);
        updateShapePreview(e.shiftKey);
        return;
      }
      const session = strokeRef.current;
      if (session && session.prev) {
        const target = docPointFromEvent(e);
        // この移動分で押印される線分の外接矩形だけをダーティ登録（仕様書 7 性能）
        const seg = segmentBounds(session.prev, target, session.size);
        continueStroke(session, target);
        bumpRevision(seg);
      }
    },
    [
      applySelectionOperation,
      bumpRevision,
      docHeight,
      docPointFromEvent,
      docWidth,
      setFloatingPos,
      setView,
      updateShapePreview,
      view.zoom,
    ]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panRef.current) {
        panRef.current = null;
        setPanning(false);
      }
      selectRef.current = null;
      floatingDragRef.current = null;
      // 図形の確定（離し時点の Shift 状態を反映。選択マスクは書き込みを遮断: 仕様書 4.1 / 4.3）
      const sh = shapeRef.current;
      if (sh) {
        shapeRef.current = null;
        setShapePreview(null);
        const end = constrainShapeEnd(sh.kind, sh.start, sh.end, e.shiftKey);
        const layer = layers.find((l) => l.id === activeLayerId);
        if (layer) {
          runShape(
            layer.id,
            { kind: sh.kind, start: sh.start, end, fill: shape.fillMode },
            hexToUint32(primaryColor),
            buildSelectionMask(selection, docWidth, docHeight)
          );
        }
      }
      const session = strokeRef.current;
      if (session) {
        // 1 ストロークを 1 ステップとして確定（endStroke は touched を消去するため先に記録）
        commitStrokeHistory(
          strokeLayerIdRef.current,
          session.touched,
          session.width,
          session.height,
          session.pixels
        );
        endStroke(session);
        strokeRef.current = null;
      }
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [
      activeLayerId,
      commitStrokeHistory,
      docHeight,
      docWidth,
      layers,
      primaryColor,
      runShape,
      selection,
      shape.fillMode,
    ]
  );

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
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <canvas ref={canvasRef} className="absolute left-0 top-0" />
      {dropActive && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{
            border: `2px dashed ${config.theme.accent}`,
            background: "rgba(0,0,0,0.35)",
          }}
        >
          <span className="font-semibold">画像をドロップして読み込み</span>
        </div>
      )}
    </div>
  );
}
