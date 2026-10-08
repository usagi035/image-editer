/**
 * 動作モード制御（仕様書 2.2）。
 * 閾値は config.yaml の canvas.full_feature_threshold を必ず参照する（ハードコード禁止）。
 */

export type EditorMode = "pixel" | "utility";

export const MODE_LABEL: Record<EditorMode, string> = {
  pixel: "Pixel Art Mode",
  utility: "Utility Mode",
};

/**
 * 画像サイズ <= 閾値 の場合のみ Pixel Art Mode（全ツール利用可）。
 * 超過時は Utility Mode（リサイズ/クロップ/全域HSV/変換のみ、描画ツール無効）。
 */
export function resolveMode(
  width: number,
  height: number,
  threshold: number
): EditorMode {
  return width <= threshold && height <= threshold ? "pixel" : "utility";
}

/** Utility Mode で無効化される描画系ツール群。 */
export const PAINT_ONLY_TOOLS = [
  "pen",
  "eraser",
  "bucket",
  "eyedropper",
  "colorReplace",
  "rectSelect",
  "magicWand",
] as const;

export function isPaintToolAllowed(
  tool: string,
  mode: EditorMode
): boolean {
  if (mode === "pixel") return true;
  return !(PAINT_ONLY_TOOLS as readonly string[]).includes(tool);
}
