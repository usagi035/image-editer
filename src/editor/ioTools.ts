import { createBlankLayer, type Layer } from "./layerUtils";

/**
 * ファイル入出力（仕様書 5. データ入出力仕様）
 * - 読み込み: PNG / JPEG / WebP / GIF（静止画）
 * - 書き出し: PNG / JPEG / WebP + 解像度倍率（1x/2x/4x/8x）
 * - ピクセル処理は Canvas の drawImage / toBlob 経由（fillRect ループ禁止）
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

/** 画像要素から単一レイヤーを生成する（自然解像度を使用）。 */
export function layerFromImage(img: HTMLImageElement): Layer {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const layer = createBlankLayer(w, h, "画像");
  const ctx = layer.canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
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
    const src = layer.canvas;
    if (src.width === newWidth && src.height === newHeight) continue;
    const next = document.createElement("canvas");
    next.width = newWidth;
    next.height = newHeight;
    const ctx = next.getContext("2d")!;
    const upscaling = newWidth > src.width || newHeight > src.height;
    ctx.imageSmoothingEnabled = !upscaling;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, newWidth, newHeight);
    layer.canvas = next;
  }
}

/** 全レイヤーを指定領域で切り出す（破壊的・クロップ用）。 */
export function cropLayers(
  layers: Layer[],
  x: number,
  y: number,
  width: number,
  height: number
): void {
  for (const layer of layers) {
    const src = layer.canvas;
    const next = document.createElement("canvas");
    next.width = width;
    next.height = height;
    const ctx = next.getContext("2d")!;
    ctx.drawImage(src, x, y, width, height, 0, 0, width, height);
    layer.canvas = next;
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
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height);
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
