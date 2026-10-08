import { ArrowLeftRight } from "lucide-react";
import type { BucketMode } from "../config/configTypes";
import { useConfig } from "../config/ConfigContext";
import { useEditor, type ReplaceScope } from "../editor/EditorContext";
import {
  ADJUST_LIMITS,
  isIdentityAdjust,
  type AdjustParamKey,
} from "../editor/adjustTools";
import { replaceColorInLayer } from "../editor/bucketTools";
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

function RectSelectOptions() {
  const { selection, clearSelection } = useEditor();
  return (
    <div className="flex flex-col gap-2">
      <Hint text="ドラッグで矩形選択（クリックで1px）。選択外への描画・塗りは遮断されます" />
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
    </div>
  );
}

function MagicWandOptions() {
  const { wand, setWandTolerance, setWandContiguous, selection, clearSelection } =
    useEditor();
  return (
    <div className="flex flex-col gap-2">
      <Hint text="クリックした色の領域を選択します（選択外への描画は遮断）" />
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
      {selection && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono-nums text-app-muted" style={{ fontSize: "0.85em" }}>
            {selection.w}×{selection.h} 選択中
          </span>
          <IconButton title="選択解除 (Esc)" onClick={clearSelection}>
            解除
          </IconButton>
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
    bumpRevision,
    primaryColor,
    secondaryColor,
  } = useEditor();
  const active = layers.find((l) => l.id === activeLayerId);
  const needSelection = replace.scope === "selection";
  const canRun = !!active && (!needSelection || !!selection);

  const run = () => {
    if (!active) return;
    const mask = needSelection
      ? buildSelectionMask(selection, active.canvas.width, active.canvas.height)
      : null;
    replaceColorInLayer(
      active,
      hexToUint32(replace.from),
      hexToUint32(replace.to),
      replace.tolerance,
      mask
    );
    bumpRevision();
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
    setAdjustParam,
    setAdjustScope,
    resetAdjust,
    applyAdjust,
    selection,
    mode,
    activeLayerId,
    layers,
  } = useEditor();
  const active = layers.find((l) => l.id === activeLayerId);
  const needSelection = adjustScope === "selection";
  const canApply =
    !!active && !isIdentityAdjust(adjust) && (!needSelection || !!selection);
  const params: { key: AdjustParamKey; label: string; suffix: string }[] = [
    { key: "hue", label: "Hue", suffix: "°" },
    { key: "saturation", label: "彩度", suffix: "" },
    { key: "value", label: "明度", suffix: "" },
    { key: "contrast", label: "コントラスト", suffix: "" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <Hint
        text={
          mode === "utility"
            ? "Utility Mode: 全レイヤーへ適用されます（低解像度プレビュー）"
            : "スライダー移動でリアルタイムプレビュー。適用で選択中レイヤーを書き換えます"
        }
      />
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
          disabled={mode === "utility"}
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
          </div>
        );
      case "eraser":
        return (
          <SliderRow
            label="太さ"
            value={eraserSize}
            min={1}
            max={config.tools.eraser.max_size}
            onChange={setEraserSize}
            suffix="px"
          />
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
      case "colorReplace":
        return <ColorReplaceOptions />;
      case "rectSelect":
        return <RectSelectOptions />;
      case "magicWand":
        return <MagicWandOptions />;
      case "crop":
        return <Hint text="ドラッグで切り出し範囲を指定します" />;
      case "resize":
        return <Hint text="幅・高さを指定してドキュメント全体をリサイズします" />;
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
