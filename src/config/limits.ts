/**
 * 画像サイズ上限チェック（改訂版仕様書 2.2 / 5.2）。
 * - 上限は「幅×高さ」の総ピクセル数（canvas.max_pixels）
 * - 超過時はエラーダイアログで拒否する
 */

/** 上限を超える場合はエラーメッセージを返す。以内なら null。 */
export function checkPixelLimit(
  width: number,
  height: number,
  maxPixels: number
): string | null {
  const pixels = Math.round(width) * Math.round(height);
  if (pixels <= maxPixels) return null;
  const edge = Math.floor(Math.sqrt(maxPixels));
  return (
    `画像サイズが上限を超えています（${Math.round(width)}×${Math.round(height)} = ` +
    `${pixels.toLocaleString()} px / 上限 ${maxPixels.toLocaleString()} px ≒ ${edge}×${edge}）。` +
    `\nconfig.yaml の canvas.max_pixels を変更できます。`
  );
}

/** 入力欄の上限表示用に、正方形ならこの辺長まで開けることになる。 */
export function maxEdgeLength(maxPixels: number): number {
  return Math.max(1, Math.floor(Math.sqrt(maxPixels)));
}
