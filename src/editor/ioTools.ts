import {
  canvasToPixels,
  createBlankLayer,
  cropPixels,
  pixelsToCanvas,
  pixelsToImageData,
  scalePixels,
  type Layer,
} from "./layerUtils";

/**
 * ファイル入出力（仕様書 5. データ入出力仕様）
 * - 読み込み: PNG / JPEG / WebP / GIF（静止画）
 * - 書き出し: PNG / JPEG / WebP + 解像度倍率（1x/2x/4x/8x）
 * - レイヤー本体は Uint32Array。Canvas は「デコード」「スケール」「書き出し」の
 *   一瞬だけ使う一時物で、レイヤーとして保持しない（仕様書 4.5）。
 */

export type ExportFormat = "png" | "jpeg" | "webp";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const EXPORT_EXT: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

/** dataUrl / objectURL / http(s) から画像要素を読み込む。 */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = src;
  });
}

/** 画像要素から単一レイヤーを生成する（自然解像度を使用・Canvas は保持しない）。 */
export function layerFromImage(img: HTMLImageElement): Layer {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas"); // デコード用の一時物（直後に破棄）
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const { pixels } = canvasToPixels(canvas);
  const layer = createBlankLayer(w, h, "画像");
  layer.pixels = pixels;
  return layer;
}

/**
 * 全レイヤーを新しいサイズへスケールする（破壊的・ドキュメントリサイズ用）。
 * 拡大はニアレスト（ピクセルアート保護）、縮小はスムージングを使う。
 */
export function resizeLayers(
  layers: Layer[],
  newWidth: number,
  newHeight: number
): void {
  for (const layer of layers) {
    if (layer.width === newWidth && layer.height === newHeight) continue;
    const scaled = scalePixels(layer.pixels, layer.width, layer.height, newWidth, newHeight);
    layer.pixels = scaled.pixels;
    layer.width = scaled.width;
    layer.height = scaled.height;
  }
}

/** 全レイヤーを指定領域で切り出す（破壊的・クロップ用・Canvas 非経由）。 */
export function cropLayers(
  layers: Layer[],
  x: number,
  y: number,
  width: number,
  height: number
): void {
  for (const layer of layers) {
    const cropped = cropPixels(layer.pixels, layer.width, layer.height, {
      x,
      y,
      w: width,
      h: height,
    });
    layer.pixels = cropped ?? new Uint32Array(width * height);
    layer.width = width;
    layer.height = height;
  }
}

/**
 * 書き出し用キャンバスを合成する。
 * 倍率拡大は imageSmoothing OFF でドットを維持する。
 * JPEG はアルファを持てないため、background（config: export.jpeg_background）で下塗りする。
 */
export function renderExportCanvas(
  layers: Layer[],
  docWidth: number,
  docHeight: number,
  scale: number,
  background?: string
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(docWidth * scale));
  canvas.height = Math.max(1, Math.round(docHeight * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // レイヤーは Uint32Array 保持のため、書き出しの瞬間だけ一時 Canvas へ展開する（再利用）
  let scratch: HTMLCanvasElement | null = null;
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity / 100;
    if (
      scratch &&
      scratch.width === layer.width &&
      scratch.height === layer.height
    ) {
      scratch
        .getContext("2d")!
        .putImageData(pixelsToImageData(layer.pixels, layer.width, layer.height), 0, 0);
    } else {
      scratch = pixelsToCanvas(layer.pixels, layer.width, layer.height);
    }
    ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * config の品質値（0〜100）を Canvas API 用の 0〜1 に変換する。
 * PNG は品質指定が無効なため常に 1。
 */
export function qualityFor(format: ExportFormat, configQuality: number): number {
  if (format === "png") return 1;
  const q = Number.isFinite(configQuality) ? configQuality : 92;
  return Math.min(100, Math.max(0, q)) / 100;
}

export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("書き出しに失敗しました"))),
      EXPORT_MIME[format],
      quality
    );
  });
}

/** ブラウザ環境用: Blob をダウンロードする。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
