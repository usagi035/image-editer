import { hexToUint32 } from "./colorUtils";

/** レイヤー実体。各レイヤーは非表示の HTML5 Canvas を保持（仕様書 4.5）。 */
export interface Layer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  visible: boolean;
  /** 0〜100 (%) */
  opacity: number;
}

let layerSeq = 0;

export function nextLayerId(): string {
  layerSeq += 1;
  return `layer-${layerSeq}`;
}

/** キャンバスサイズの空レイヤーを生成する。fill は "#rrggbb" or "#rrggbbaa"（省略時は全透明）。 */
export function createBlankLayer(
  width: number,
  height: number,
  name: string,
  fill?: string
): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (fill && fill !== "#00000000") {
    const px = hexToUint32(fill);
    const a = (px >>> 24) & 255;
    if (a > 0) {
      const r = px & 255;
      const g = (px >>> 8) & 255;
      const b = (px >>> 16) & 255;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.globalAlpha = a / 255;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }
  return { id: nextLayerId(), name, canvas, visible: true, opacity: 100 };
}

/** 既存レイヤーを複製（ピクセルコピー）。 */
export function cloneLayer(source: Layer, name: string): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = source.canvas.width;
  canvas.height = source.canvas.height;
  canvas.getContext("2d")!.drawImage(source.canvas, 0, 0);
  return {
    id: nextLayerId(),
    name,
    canvas,
    visible: source.visible,
    opacity: source.opacity,
  };
}

/** ピクセルを保持したままサイズ変更する（リサイズ/画像読込時に使用）。 */
export function resizeLayerCanvas(layer: Layer, width: number, height: number): void {
  if (layer.canvas.width === width && layer.canvas.height === height) return;
  const next = document.createElement("canvas");
  next.width = width;
  next.height = height;
  next.getContext("2d")!.drawImage(layer.canvas, 0, 0);
  layer.canvas = next;
}
