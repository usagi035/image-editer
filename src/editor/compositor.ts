import type { Layer } from "./layerUtils";

/**
 * レイヤー合成キャッシュ（仕様書 4.5 合成）。
 * 下層レイヤーから順にアルファブレンドして1枚の合成キャンバスを作る。
 * パン/ズーム時はキャッシュを blit するため、5000x5000px でも再合成コストを払わない。
 */
export interface CompositeCache {
  canvas: HTMLCanvasElement;
  key: string;
}

/**
 * revision（ピクセル変更/レイヤー操作のたびに +1）とドキュメントサイズをキーに
 * 合成結果を返す。不要なら cache をそのまま返す。
 */
export function getComposite(
  cache: CompositeCache | null,
  layers: Layer[],
  width: number,
  height: number,
  revision: number
): CompositeCache {
  const key = `${revision}:${width}:${height}`;
  if (
    cache &&
    cache.key === key &&
    cache.canvas.width === width &&
    cache.canvas.height === height
  ) {
    return cache;
  }

  let canvas = cache?.canvas;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  // 下層 → 上層の順にアルファブレンド
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(layer.canvas, 0, 0);
  }
  ctx.globalAlpha = 1;
  return { canvas, key };
}

/** 合成結果を Uint32Array として取得（ピクセル処理用）。 */
export function compositeToUint32(
  layers: Layer[],
  width: number,
  height: number
): Uint32Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(layer.canvas, 0, 0);
  }
  const data = ctx.getImageData(0, 0, width, height);
  return new Uint32Array(data.data.buffer);
}
