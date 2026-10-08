import { ArrowLeftRight } from "lucide-react";
import type { BucketMode } from "../config/configTypes";
import { useConfig } from "../config/ConfigContext";
import { useEditor } from "../editor/EditorContext";
import type { ToolId } from "../editor/types";
import LayersPanel from "./LayersPanel";
import { Hint, SectionTitle, SliderRow, ToggleRow } from "./ui";

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
        return <Hint text="置換元の色をクリックすると専用ダイアログを開きます" />;
      case "rectSelect":
        return <Hint text="ドラッグで矩形選択。選択外への描画は遮断されます" />;
      case "magicWand":
        return <Hint text="クリックした連続同色領域を選択します" />;
      case "crop":
        return <Hint text="ドラッグで切り出し範囲を指定します" />;
      case "resize":
        return <Hint text="幅・高さを指定してドキュメント全体をリサイズします" />;
      case "hsv":
        return <Hint text="スライダーでリアルタイムプレビューを行います" />;
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
