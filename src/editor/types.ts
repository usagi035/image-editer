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

/**
 * 選択状態（仕様書 4.3）
 * - rect: 矩形選択（bbox のみ管理、mask は null）
 * - wand: 魔術の杖（doc サイズの Uint8Array マスク + 着色用 tint キャンバス）
 */
export interface SelectionState {
  kind: "rect" | "wand";
  /** バウンディングボックス（doc 座標） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** doc サイズの選択マスク（1=選択内）。rect では null。 */
  mask: Uint8Array | null;
  /** 選択領域の半透明プレビュー（wand 用、doc サイズ） */
  tint?: HTMLCanvasElement;
}

/** ビューポート座標 → キャンバス座標変換 */
export function viewToDoc(p: ViewPoint, view: ViewState): DocPoint {
  return {
    x: Math.floor((p.x - view.panX) / view.zoom),
    y: Math.floor((p.y - view.panY) / view.zoom),
  };
}
