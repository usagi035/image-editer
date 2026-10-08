/** ツール識別子（仕様書 3. 左パネル / 4. 機能別詳細） */
export type ToolId =
  | "pen" // ペン
  | "eraser" // 消しゴム
  | "bucket" // 特殊バケツ
  | "eyedropper" // スポイト
  | "colorReplace" // 色置換
  | "rectSelect" // 矩形選択
  | "magicWand" // 魔術の杖
  | "crop" // トリミング
  | "resize" // リサイズ
  | "hsv"; // HSV/明度/コントラスト調整

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
}

export interface ViewportSize {
  w: number;
  h: number;
}

/** ビューポート座標(CSS px) */
export interface ViewPoint {
  x: number;
  y: number;
}

/** キャンバス座標(整数ピクセル) */
export interface DocPoint {
  x: number;
  y: number;
}

/** ビューポート座標 → キャンバス座標変換 */
export function viewToDoc(p: ViewPoint, view: ViewState): DocPoint {
  return {
    x: Math.floor((p.x - view.panX) / view.zoom),
    y: Math.floor((p.y - view.panY) / view.zoom),
  };
}
