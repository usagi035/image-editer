import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useConfig } from "../config/ConfigContext";
import { useEditor } from "../editor/EditorContext";
import { IconButton, SectionTitle, SliderRow } from "./ui";

/**
 * レイヤー管理パネル（仕様書 4.5）
 * 一覧・追加・複製・削除・順序変更・不透明度・可視切替・統合
 */
export default function LayersPanel() {
  const { config } = useConfig();
  const {
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
  } = useEditor();

  const active = layers.find((l) => l.id === activeLayerId);
  const activeIndex = layers.findIndex((l) => l.id === activeLayerId);
  const atMax = layers.length >= config.tools.layers.max_layers;
  const isTop = activeIndex === layers.length - 1;
  const isBottom = activeIndex <= 0;

  // 表示は上層が先頭（画像編集ソフト標準）
  const display = [...layers].reverse();

  return (
    <section className="flex min-h-0 flex-col">
      <SectionTitle>レイヤー</SectionTitle>

      {/* 操作ツールバー */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <IconButton title="レイヤーを追加" onClick={addLayer} disabled={atMax}>
          <Plus size={13} />
        </IconButton>
        <IconButton
          title="選択レイヤーを複製"
          onClick={() => duplicateLayer(activeLayerId)}
          disabled={!active}
        >
          <Copy size={13} />
        </IconButton>
        <IconButton
          title="選択レイヤーを削除"
          onClick={() => deleteLayer(activeLayerId)}
          disabled={layers.length <= 1}
          danger
        >
          <Trash2 size={13} />
        </IconButton>
        <IconButton
          title="上へ移動"
          onClick={() => moveLayer(activeLayerId, 1)}
          disabled={!active || isTop}
        >
          <ChevronUp size={13} />
        </IconButton>
        <IconButton
          title="下へ移動"
          onClick={() => moveLayer(activeLayerId, -1)}
          disabled={!active || isBottom}
        >
          <ChevronDown size={13} />
        </IconButton>
        <IconButton
          title="下のレイヤーと統合"
          onClick={() => mergeDown(activeLayerId)}
          disabled={isBottom || !active}
        >
          統合↓
        </IconButton>
      </div>

      {/* レイヤー一覧 */}
      <div
        className="mx-2 mb-2 max-h-48 min-h-16 overflow-y-auto rounded"
        style={{ border: "1px solid var(--color-border)" }}
        data-revision={revision}
      >
        {display.map((layer) => {
          const isActive = layer.id === activeLayerId;
          return (
            <div
              key={layer.id}
              className="flex items-center gap-1 px-1"
              style={{
                background: isActive ? "var(--color-panel-alt)" : "transparent",
                borderBottom: "1px solid var(--color-border)",
                opacity: layer.visible ? 1 : 0.5,
              }}
            >
              <button
                className="rounded p-1"
                title={layer.visible ? "非表示にする" : "表示する"}
                onClick={() => toggleLayerVisible(layer.id)}
              >
                {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button
                className="min-w-0 flex-1 truncate py-1.5 text-left"
                title={layer.name}
                style={{
                  borderLeft: isActive
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
                  paddingLeft: 6,
                }}
                onClick={() => setActiveLayerId(layer.id)}
              >
                {layer.name}
              </button>
              <span className="shrink-0 text-app-muted" style={{ fontSize: "0.75em" }}>
                {layer.opacity}%
              </span>
            </div>
          );
        })}
      </div>

      {/* 不透明度 */}
      <div className="px-2 pb-3">
        <SliderRow
          label="不透明度"
          value={active?.opacity ?? 100}
          min={0}
          max={100}
          onChange={(n) => setLayerOpacity(activeLayerId, n)}
          disabled={!active}
          suffix="%"
        />
        {atMax && (
          <p className="mt-1 text-app-muted" style={{ fontSize: "0.75em" }}>
            最大レイヤー数（{config.tools.layers.max_layers}）に達しています
          </p>
        )}
      </div>
    </section>
  );
}
