import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { BucketMode, MirrorMode, ShapeFillMode } from "../config/configTypes";
import { useConfig } from "../config/ConfigContext";
import { checkPixelLimit, maxEdgeLength } from "../config/limits";
import { useEditor, type ReplaceScope } from "../editor/EditorContext";
import {
  ADJUST_LIMITS,
  isIdentityAdjust,
  type AdjustParamKey,
} from "../editor/adjustTools";
import { hexToUint32 } from "../editor/colorUtils";
import { buildSelectionMask } from "../editor/selectionTools";
import type { ToolId } from "../editor/types";
import LayersPanel from "./LayersPanel";
import { Hint, IconButton, SectionTitle, SliderRow, ToggleRow } from "./ui";

/* ---------------- カラーセクション ---------------- */

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const handleText = (text: string) => {
    const t = text.startsWith("#") ? text : `#${text}`;
    if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase());
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-app-muted">{label}</span>
      <div
        className="relative h-7 w-7 shrink-0 overflow-hidden rounded"
        style={{ border: "1px solid var(--color-border)" }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute -left-1 -top-1 h-10 w-10 cursor-pointer border-0 bg-transparent p-0"
          aria-label={`${label} 色選択`}
        />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => handleText(e.target.value)}
        spellCheck={false}
        className="w-full rounded px-2 py-1 font-mono-nums"
        style={{
          background: "var(--color-panel-alt)",
          border: "1px solid var(--color-border)",
        }}
        aria-label={`${label} 16進数カラー`}
      />
    </div>
  );
}

function ColorSection() {
  const { primaryColor, setPrimaryColor, secondaryColor, setSecondaryColor, swapColors } =
    useEditor();
  return (
    <section>
      <SectionTitle>カラー</SectionTitle>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <ColorField label="主" value={primaryColor} onChange={setPrimaryColor} />
        <ColorField label="副" value={secondaryColor} onChange={setSecondaryColor} />
        <button
          className="flex items-center justify-center gap-1 rounded py-1"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
          onClick={swapColors}
          title="主色と副色を入れ替え"
        >
          <ArrowLeftRight size={13} />
          入れ替え
        </button>
      </div>
    </section>
  );
}

/* ---------------- 範囲選択オプション（仕様書 4.3） ---------------- */

/** 選択演算メニュー（全選択 / 反転 / 解除） */
function SelectionOpsRow() {
  const { selectAll, invertSelection, clearSelection } = useEditor();
  const btn =
    "flex-1 rounded py-1 text-app-muted hover:text-app-text";
  return (
    <div className="flex gap-1">
      <button
        className={btn}
        style={{ background: "var(--color-panel-alt)", border: "1px solid var(--color-border)" }}
        title="全選択（Ctrl+A）"
        onClick={selectAll}
      >
        全選択
      </button>
      <button
        className={btn}
        style={{ background: "var(--color-panel-alt)", border: "1px solid var(--color-border)" }}
        title="選択反転（Ctrl+Shift+I）"
        onClick={invertSelection}
      >
        反転
      </button>
      <button
        className={btn}
        style={{ background: "var(--color-panel-alt)", border: "1px solid var(--color-border)" }}
        title="選択解除（Esc / Ctrl+D）"
        onClick={clearSelection}
      >
        解除
      </button>
    </div>
  );
}

function RectSelectOptions() {
  const { selection } = useEditor();
  return (
    <div className="flex flex-col gap-2">
      <Hint text="ドラッグで矩形選択（クリックで1px）。Shift=加算 / Alt=減算。選択外への描画・塗りは遮断されます" />
      <SelectionOpsRow />
      {selection && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono-nums text-app-muted" style={{ fontSize: "0.85em" }}>
            {selection.w}×{selection.h} @ ({selection.x},{selection.y})
          </span>
        </div>
      )}
      <Hint text="Ctrl+C/X/V でコピー/切り取り/貼り付け。貼り付けは Enter またはツール切替で確定" />
    </div>
  );
}

function MagicWandOptions() {
  const { wand, setWandTolerance, setWandContiguous, selection } =
    useEditor();
  return (
    <div className="flex flex-col gap-2">
      <Hint text="クリックした色の領域を選択します（Shift=加算 / Alt=減算・選択外への描画は遮断）" />
      <SliderRow
        label="許容値"
        value={wand.tolerance}
        min={0}
        max={255}
        onChange={setWandTolerance}
      />
      <ToggleRow
        label="連続領域のみ（OFF で全域選択）"
        checked={wand.contiguous}
        onChange={setWandContiguous}
      />
      <SelectionOpsRow />
      {selection && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono-nums text-app-muted" style={{ fontSize: "0.85em" }}>
            {selection.w}×{selection.h} 選択中
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------------- 色置換（仕様書 4.3） ---------------- */

function ColorReplaceOptions() {
  const {
    replace,
    setReplaceFrom,
    setReplaceTo,
    setReplaceTolerance,
    setReplaceScope,
    selection,
    layers,
    activeLayerId,
    primaryColor,
    secondaryColor,
    runColorReplace,
  } = useEditor();
  const active = layers.find((l) => l.id === activeLayerId);
  const needSelection = replace.scope === "selection";
  const canRun = !!active && (!needSelection || !!selection);

  const run = () => {
    if (!active) return;
    // 閾値以上は Worker 実行（進捗表示・キャンセル・編集ロック付き: 仕様書 2.2 / 4.3）
    runColorReplace(
      active.id,
      hexToUint32(replace.from),
      hexToUint32(replace.to),
      replace.tolerance,
      needSelection
        ? buildSelectionMask(selection, active.width, active.height)
        : null
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Hint text="キャンバスをクリックすると置換元 A の色を取得します" />
      <ColorField label="A" value={replace.from} onChange={setReplaceFrom} />
      <ColorField label="B" value={replace.to} onChange={setReplaceTo} />
      <div className="flex gap-1">
        <button
          className="flex-1 rounded py-1"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
          onClick={() => {
            setReplaceFrom(replace.to);
            setReplaceTo(replace.from);
          }}
          title="A と B を入れ替え"
        >
          入れ替え
        </button>
        <button
          className="flex-1 rounded py-1"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
          onClick={() => {
            setReplaceFrom(primaryColor);
            setReplaceTo(secondaryColor);
          }}
          title="A=主色 / B=副色 に設定"
        >
          カラーから設定
        </button>
      </div>
      <SliderRow
        label="許容値"
        value={replace.tolerance}
        min={0}
        max={255}
        onChange={setReplaceTolerance}
      />
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-app-muted">範囲</span>
        <select
          value={replace.scope}
          onChange={(e) => setReplaceScope(e.target.value as ReplaceScope)}
          className="min-w-0 flex-1 rounded px-2 py-1"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
        >
          <option value="layer">レイヤー全体</option>
          <option value="selection" disabled={!selection}>
            選択範囲{selection ? "" : "（未選択）"}
          </option>
        </select>
      </label>
      <button
        className="rounded py-1 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: "var(--color-accent)" }}
        disabled={!canRun}
        onClick={run}
      >
        A → B に置換実行
      </button>
      {needSelection && !selection && (
        <Hint text="選択範囲がありません（魔術の杖/矩形選択で指定してください）" />
      )}
    </div>
  );
}

/* ---------------- 色調整（仕様書 4.4） ---------------- */

function HsvOptions() {
  const {
    adjust,
    adjustScope,
    adjustAllLayers,
    setAdjustParam,
    setAdjustScope,
    setAdjustAllLayers,
    resetAdjust,
    applyAdjust,
    selection,
    activeLayerId,
    layers,
    workerJob,
  } = useEditor();
  const active = layers.find((l) => l.id === activeLayerId);
  const needSelection = adjustScope === "selection";
  const canApply =
    !!active &&
    !isIdentityAdjust(adjust) &&
    (!needSelection || !!selection) &&
    !workerJob;
  const params: { key: AdjustParamKey; label: string; suffix: string }[] = [
    { key: "hue", label: "Hue", suffix: "°" },
    { key: "saturation", label: "彩度", suffix: "" },
    { key: "value", label: "明度", suffix: "" },
    { key: "contrast", label: "コントラスト", suffix: "" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <Hint text="スライダー移動でリアルタイムプレビュー（大画像は表示中の範囲のみ）。適用で書き換えます（閾値以上は裏で実行）" />
      {params.map((p) => (
        <SliderRow
          key={p.key}
          label={p.label}
          value={adjust[p.key]}
          min={ADJUST_LIMITS[p.key].min}
          max={ADJUST_LIMITS[p.key].max}
          onChange={(n) => setAdjustParam(p.key, n)}
          suffix={p.suffix}
        />
      ))}
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-app-muted">範囲</span>
        <select
          value={adjustScope}
          onChange={(e) => setAdjustScope(e.target.value as ReplaceScope)}
          className="min-w-0 flex-1 rounded px-2 py-1 disabled:opacity-40"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
        >
          <option value="layer">選択中レイヤー全体</option>
          <option value="selection" disabled={!selection}>
            選択範囲{selection ? "" : "（未選択）"}
          </option>
        </select>
      </label>
      <ToggleRow
        label="全レイヤーに適用"
        checked={adjustAllLayers}
        onChange={setAdjustAllLayers}
      />
      <div className="flex gap-1">
        <button
          className="flex-1 rounded py-1 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--color-accent)" }}
          disabled={!canApply}
          onClick={applyAdjust}
        >
          適用
        </button>
        <button
          className="flex-1 rounded py-1"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
          onClick={resetAdjust}
          title="パラメータを初期値に戻す"
        >
          リセット
        </button>
      </div>
      {needSelection && !selection && (
        <Hint text="選択範囲がありません（矩形選択/魔術の杖で指定してください）" />
      )}
    </div>
  );
}

/* ---------------- リサイズ / クロップ（仕様書 5） ---------------- */

function ResizeOptions() {
  const { docWidth, docHeight, setDocumentSize } = useEditor();
  const { config } = useConfig();
  const [w, setW] = useState(docWidth);
  const [h, setH] = useState(docHeight);
  const [error, setError] = useState<string | null>(null);
  const maxPixels = config.canvas.max_pixels;
  const max = maxEdgeLength(maxPixels);

  // ドキュメント変更（新規/読み込み/クロップ）に同期
  useEffect(() => {
    setW(docWidth);
    setH(docHeight);
  }, [docWidth, docHeight]);

  const submit = () => {
    const nw = Math.round(Number(w));
    const nh = Math.round(Number(h));
    if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw < 1 || nh < 1) {
      setError("1 以上の数値を入力してください");
      return;
    }
    const limitError = checkPixelLimit(nw, nh, maxPixels);
    if (limitError) {
      setError(limitError.replace(/\n/g, " "));
      return;
    }
    setError(null);
    setDocumentSize(nw, nh);
  };

  return (
    <div className="flex flex-col gap-2">
      <Hint text="全レイヤーのピクセルをスケールします（拡大はニアレスト）" />
      <div className="flex items-center gap-2">
        <span className="w-6 text-app-muted">幅</span>
        <input
          id="rs-w"
          type="number"
          min={1}
          max={max}
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
          className="w-full rounded px-2 py-1 font-mono-nums"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
        />
        <span className="text-app-muted">px</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-6 text-app-muted">高</span>
        <input
          id="rs-h"
          type="number"
          min={1}
          max={max}
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
          className="w-full rounded px-2 py-1 font-mono-nums"
          style={{
            background: "var(--color-panel-alt)",
            border: "1px solid var(--color-border)",
          }}
        />
        <span className="text-app-muted">px</span>
      </div>
      {error && (
        <p style={{ color: "var(--color-danger)", fontSize: "0.85em" }}>{error}</p>
      )}
      <button
        className="rounded py-1 font-semibold text-white"
        style={{ background: "var(--color-accent)" }}
        onClick={submit}
      >
        リサイズ実行
      </button>
    </div>
  );
}

function CropOptions() {
  const { selection, clearSelection, cropDocument, docWidth, docHeight } = useEditor();
  const canCrop =
    !!selection && selection.w > 0 && selection.h > 0 &&
    !(selection.x === 0 && selection.y === 0 && selection.w === docWidth && selection.h === docHeight);
  return (
    <div className="flex flex-col gap-2">
      <Hint text="ドラッグで切り出し範囲を指定します（矩形選択と同一操作）" />
      {selection && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono-nums text-app-muted" style={{ fontSize: "0.85em" }}>
            {selection.w}×{selection.h} @ ({selection.x},{selection.y})
          </span>
          <IconButton title="選択解除 (Esc)" onClick={clearSelection}>
            解除
          </IconButton>
        </div>
      )}
      <button
        className="rounded py-1 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: "var(--color-accent)" }}
        disabled={!canCrop}
        onClick={() =>
          selection && cropDocument(selection.x, selection.y, selection.w, selection.h)
        }
      >
        この範囲で切り抜き
      </button>
      {!selection && <Hint text="範囲をドラッグしてから切り抜きを実行してください" />}
    </div>
  );
}

/* ---------------- 図形 & ミラー（仕様書 4.1） ---------------- */

/** セグメント切替ボタン群（枠のみ/塗り・ミラー軸など） */
function SegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 shrink-0 text-app-muted">{label}</span>
      <div className="flex flex-1 gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            className="flex-1 rounded py-1"
            style={{
              background:
                value === o.id ? "var(--color-accent)" : "var(--color-panel-alt)",
              border: "1px solid var(--color-border)",
              color: value === o.id ? "#fff" : undefined,
            }}
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ミラー描画の切替（ペン・消しゴム・直線・矩形・楕円に共通。仕様書 4.1） */
function MirrorRow() {
  const { shape, setMirrorMode } = useEditor();
  return (
    <SegmentedRow<MirrorMode>
      label="ミラー"
      value={shape.mirror}
      options={[
        { id: "none", label: "なし" },
        { id: "vertical", label: "縦軸" },
        { id: "horizontal", label: "横軸" },
        { id: "both", label: "両方" },
      ]}
      onChange={setMirrorMode}
    />
  );
}

/** 矩形・楕円の塗りモード（枠のみ / 塗り。仕様書 4.1） */
function ShapeFillRow() {
  const { shape, setShapeFillMode } = useEditor();
  return (
    <SegmentedRow<ShapeFillMode>
      label="描画"
      value={shape.fillMode}
      options={[
        { id: "outline", label: "枠のみ" },
        { id: "fill", label: "塗り" },
      ]}
      onChange={setShapeFillMode}
    />
  );
}

function LineOptions() {
  return (
    <div className="flex flex-col gap-2">
      <Hint text="ドラッグで直線を描画します（離しで確定）。Shift=45度固定" />
      <MirrorRow />
    </div>
  );
}

function RectOptions() {
  return (
    <div className="flex flex-col gap-2">
      <Hint text="ドラッグで矩形を描画します（離しで確定）。Shift=正方形" />
      <ShapeFillRow />
      <MirrorRow />
    </div>
  );
}

function EllipseOptions() {
  return (
    <div className="flex flex-col gap-2">
      <Hint text="ドラッグで楕円を描画します（離しで確定）。Shift=正円" />
      <ShapeFillRow />
      <MirrorRow />
    </div>
  );
}

/* ---------------- ツールオプション ---------------- */

function ToolOptionsSection() {
  const { config } = useConfig();
  const {
    tool,
    pen,
    setPenSize,
    setPenPixelPerfect,
    eraserSize,
    setEraserSize,
    bucket,
    setBucketMode,
    setBucketTolerance,
    setBucketJitter,
  } = useEditor();

  const body = (() => {
    switch (tool as ToolId) {
      case "pen":
        return (
          <div className="flex flex-col gap-2">
            <SliderRow
              label="太さ"
              value={pen.size}
              min={1}
              max={config.tools.pen.max_size}
              onChange={setPenSize}
              suffix="px"
            />
            <ToggleRow
              label="Pixel-Perfect（ジグザグ抑止）"
              checked={pen.pixelPerfect}
              onChange={setPenPixelPerfect}
            />
            <MirrorRow />
          </div>
        );
      case "eraser":
        return (
          <div className="flex flex-col gap-2">
            <SliderRow
              label="太さ"
              value={eraserSize}
              min={1}
              max={config.tools.eraser.max_size}
              onChange={setEraserSize}
              suffix="px"
            />
            <MirrorRow />
          </div>
        );
      case "bucket": {
        const modes: { id: BucketMode; label: string }[] = [
          { id: "flood", label: "Flood Fill（通常塗り）" },
          { id: "global", label: "Global Fill（全域置換）" },
          { id: "noise", label: "Noise Fill（ノイズ塗り）" },
          { id: "dither", label: "Dither Fill（ディザ塗り）" },
          { id: "eraser", label: "Eraser Fill（一括消去）" },
        ];
        return (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-app-muted">モード</span>
              <select
                value={bucket.mode}
                onChange={(e) => setBucketMode(e.target.value as BucketMode)}
                className="min-w-0 flex-1 rounded px-2 py-1"
                style={{
                  background: "var(--color-panel-alt)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <SliderRow
              label="許容値"
              value={bucket.tolerance}
              min={0}
              max={255}
              onChange={setBucketTolerance}
            />
            <SliderRow
              label="ノイズ強度"
              value={bucket.jitter}
              min={0}
              max={100}
              onChange={setBucketJitter}
              disabled={bucket.mode !== "noise"}
              suffix="%"
            />
            {bucket.mode === "dither" && (
              <Hint text="主色と副色を交差ドットで塗ります（カラー欄の主/副を使用）" />
            )}
          </div>
        );
      }
      case "eyedropper":
        return (
          <Hint
            text={
              config.tools.eyedropper.sample_merged
                ? "合成結果から RGBA を取得して主色に設定します"
                : "アクティブレイヤーから RGBA を取得します"
            }
          />
        );
      case "line":
        return <LineOptions />;
      case "rect":
        return <RectOptions />;
      case "ellipse":
        return <EllipseOptions />;
      case "colorReplace":
        return <ColorReplaceOptions />;
      case "rectSelect":
        return <RectSelectOptions />;
      case "magicWand":
        return <MagicWandOptions />;
      case "hand":
        return <Hint text="ドラッグで画像を移動します（Space+ドラッグ / 中ボタンドラッグでも移動できます）" />;
      case "crop":
        return <CropOptions />;
      case "resize":
        return <ResizeOptions />;
      case "hsv":
        return <HsvOptions />;
      default:
        return <Hint text="—" />;
    }
  })();

  return (
    <section>
      <SectionTitle>ツールオプション</SectionTitle>
      <div className="flex flex-col gap-2 px-3 py-2">{body}</div>
    </section>
  );
}

/* ---------------- 右パネル本体 ---------------- */

/**
 * 右パネル（インスペクタ）- 仕様書 3. Right Panel
 * カラーパレット / レイヤー管理 / ツールオプション
 */
export default function InspectorPanel() {
  return (
    <aside
      className="flex w-64 shrink-0 flex-col overflow-y-auto"
      style={{
        background: "var(--color-panel)",
        borderLeft: "1px solid var(--color-border)",
      }}
    >
      <ColorSection />
      <ToolOptionsSection />
      <LayersPanel />
    </aside>
  );
}
