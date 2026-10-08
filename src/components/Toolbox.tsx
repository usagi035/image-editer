import type { LucideIcon } from "lucide-react";
import {
  Contrast,
  Crop,
  Eraser,
  PaintBucket,
  Pencil,
  Pipette,
  Replace,
  Scaling,
  SquareDashed,
  Wand,
} from "lucide-react";
import { useEditor } from "../editor/EditorContext";
import type { ToolId } from "../editor/types";

interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  group: 1 | 2 | 3;
}

const TOOLS: ToolDef[] = [
  // 1: 基本描画ツール
  { id: "pen", icon: Pencil, label: "ペン", group: 1 },
  { id: "eraser", icon: Eraser, label: "消しゴム", group: 1 },
  { id: "bucket", icon: PaintBucket, label: "バケツ", group: 1 },
  { id: "eyedropper", icon: Pipette, label: "スポイト", group: 1 },
  // 2: 範囲選択・色置換・切り抜き
  { id: "colorReplace", icon: Replace, label: "色置換", group: 2 },
  { id: "rectSelect", icon: SquareDashed, label: "矩形選択", group: 2 },
  { id: "magicWand", icon: Wand, label: "魔術の杖", group: 2 },
  { id: "crop", icon: Crop, label: "トリミング", group: 2 },
  // 3: ユーティリティ（リサイズ・色調整）
  { id: "resize", icon: Scaling, label: "リサイズ", group: 3 },
  { id: "hsv", icon: Contrast, label: "色調整", group: 3 },
];

function ToolButton({
  def,
  active,
  onSelect,
}: {
  def: ToolDef;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded"
      style={{
        background: active ? "var(--color-accent)" : "transparent",
        color: active ? "#ffffff" : "var(--color-text)",
        border: active
          ? "1px solid var(--color-accent-hover)"
          : "1px solid transparent",
        cursor: "pointer",
      }}
      title={def.label}
      onClick={onSelect}
    >
      <Icon size={17} />
      <span style={{ fontSize: "0.7em", lineHeight: 1 }}>{def.label}</span>
    </button>
  );
}

/**
 * 左パネル（ツールボックス）- 仕様書 3. Left Panel
 * モード分けは廃止（改訂版仕様書 2.2）: 全サイズで全ツールを利用できる。
 */
export default function Toolbox() {
  const { tool, setTool } = useEditor();

  const groups: ToolDef["group"][] = [1, 2, 3];

  return (
    <aside
      className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto py-2"
      style={{
        background: "var(--color-panel)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      {groups.map((g) => (
        <div key={g} className="contents">
          <div className="flex flex-col items-center gap-0.5">
            {TOOLS.filter((t) => t.group === g).map((def) => (
              <ToolButton
                key={def.id}
                def={def}
                active={tool === def.id}
                onSelect={() => setTool(def.id)}
              />
            ))}
          </div>
          {g < 3 && (
            <div
              className="my-1 h-px w-9"
              style={{ background: "var(--color-border)" }}
            />
          )}
        </div>
      ))}
    </aside>
  );
}
