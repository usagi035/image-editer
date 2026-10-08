# Image Editor — Minecraft テクスチャ向けドット絵エディタ

Minecraft のテクスチャ制作（16x16〜512x512px のピクセルアート）に特化したドット絵エディタと、最大 5000x5000px まで対応する軽量画像ユーティリティを併せ持つ画像編集アプリです。**Web（Vite 静的ビルド）** と **デスクトップ（Electron）** の両方で動作します。

UI・色・フォント・閾値などの設定はすべて `config.yaml` で一元管理されており、コード内のハードコードは行いません。

## 主な機能

### 動作モード（`canvas.full_feature_threshold` で自動切替）

| モード | 条件 | 内容 |
| :--- | :--- | :--- |
| **Pixel Art Mode** | 画像サイズ ≦ 512x512 | 全ツール利用可（ペイント / 選択 / レイヤー / HSV / エクスポート） |
| **Utility Mode** | 画像サイズ > 512x512 | 描画ツール無効、リサイズ・クロップ・全域 HSV 補正・形式変換のみ |

### ピクセル編集（Pixel Art Mode）
- **ペン**: 1px 単位描画 + Pixel-Perfect（ジグザグ抑止）切替、太さ 1〜16px
- **消しゴム / スポイト**: アルファ 0 化・クリック位置の RGBA 取得
- **特殊バケツ 5 モード**: Flood Fill / Global Fill / Noise Fill / Dither Fill / Eraser Fill（許容値 0〜255、ノイズ強度 0〜100%）
- **範囲選択**: 矩形選択・魔術の杖（連続/全域・許容値）。選択外へのペイント・塗り潰しを遮断
- **色置換**: 指定色 A → B を「レイヤー全体 / 選択範囲」から置換
- **レイヤー**: 追加・複製・削除・上下移動・統合・不透明度・表示/非表示
- **HSV 調整**: Hue / 彩度 / 明度 / コントラストをスライダー即時プレビュー → 適用

### ユーティリティ（Utility Mode 含む）
- **リサイズ**: 全レイヤーをスケール（拡大はニアレストでドット維持）
- **クロップ**: ドラッグ範囲で全レイヤーを切り出し
- **読み込み**: PNG / JPEG / WebP / GIF（静止画）— ファイルダイアログ、またはキャンバスへドラッグ＆ドロップ
- **書き出し**: PNG / JPEG / WebP × 1x / 2x / 4x / 8x、品質は config 指定
- **Electron 連携**: `fs` によるネイティブダイアログでの直接読み書き（Ctrl+S）

## 技術スタック

- React 18 + TypeScript + Vite
- Tailwind CSS v4（`@tailwindcss/vite`）
- Electron（デスクトップ版 / `contextIsolation` + `preload` 経由の IPC のみ）
- `js-yaml`（`config.yaml` パース）
- Lucide React（アイコン）

ピクセル処理は `ImageData` / `Uint32Array` のメモリ直接操作で行い、`fillRect` ループは使用しません。レイヤー合成は revision キー付きキャッシュでパン/ズーム時の再合成コストを抑えています。

## セットアップ

```bash
npm install
```

### スクリプト

| コマンド | 説明 |
| :--- | :--- |
| `npm run dev` | Vite 開発サーバー起動 |
| `npm run build` | `tsc --noEmit` + Vite ビルド（`dist/` 出力） |
| `npm run preview` | ビルド成果物をプレビュー |
| `npm run electron` | Electron 版を起動（先に `npm run build` が必要） |

> Windows の PowerShell では `npm.ps1` が実行ポリシーでブロックされる場合があるため、`npm.cmd run build` のように `.cmd` を明示してください。

### Electron 版

```bash
npm run build          # dist/ を生成
npm run electron       # Electron で起動
```

開発時は `VITE_DEV_SERVER_URL=http://localhost:5173` を設定して起動すれば、起動中の `npm run dev` を読み込みます。

## 設定（`public/config.yaml`）

アプリは起動時に `config.yaml` を読み込み、React Context（`ConfigContext`）経由で全コンポーネントへ提供します。

- **読み込み順**: Electron（ローカル `config.yaml`）→ Web（`public/config.yaml`）→ フォールバック既定値
- **再読み込み**: ヘッダーの「設定再読み込み」ボタン（`config.yaml` を修正して即反映）
- **主な設定項目**
  - `theme.*` — 色・フォント・角丸（CSS 変数へ適用）
  - `canvas.full_feature_threshold` — モード切替閾値（既定 512）
  - `canvas.max_size` — 最大キャンバスサイズ（既定 5000）
  - `tools.*` — ペン/バケツ/魔術の杖/色置換/HSV の既定値
  - `export.*` — 書き出し形式・倍率・品質
  - `shortcuts.*` — キーボードショートカット表記

> 色・フォント・閾値などのハードコードは禁止です。変更は必ず `config.yaml` 経由で行ってください。

## キーボードショートカット（既定値）

| 操作 | ショートカット |
| :--- | :--- |
| エクスポート（即書き出し） | `Ctrl+S` |
| ズームイン / アウト | `Ctrl++` / `Ctrl+-` |
| ズームリセット（100%） | `Ctrl+0` |
| グリッド表示切替 | `G` |
| パン（ドラッグ） | `Space` + ドラッグ / 中ボタンドラッグ |
| 選択解除 | `Esc` |

## 画面構成

```
┌────────────────────────────────────────────┐
│ Header: 新規 / 開く / 保存 / 設定再読み込み │  モードバナー / ズーム / グリッド
├───┬──────────────────────────────┬─────────┤
│ T │                              │ カラー  │
│ o │      Canvas Viewport        │ ツール  │
│ o │   （ズーム / パン / グリッド）│ オプション│
│ l │                              │ レイヤー│
│ s │                              │         │
└───┴──────────────────────────────┴─────────┘
```

## プロジェクト構成

```
src/
├── components/       # HeaderBar / Toolbox / CanvasViewport / InspectorPanel / 各ダイアログ
├── config/           # ConfigContext / configTypes / defaultConfig / mode（モード判定）
├── editor/           # EditorContext（状態）+ 各ツールエンジン
│   ├── drawTools.ts        # ストローク（Bresenham / Pixel-Perfect）
│   ├── bucketTools.ts      # 特殊バケツ 5 モード + 色置換
│   ├── selectionTools.ts   # 矩形/魔術の杖 + マスク構築
│   ├── adjustTools.ts      # HSV / 明度 / コントラスト
│   ├── ioTools.ts          # 読み込み / リサイズ / クロップ / 書き出し
│   ├── compositor.ts       # レイヤー合成キャッシュ
│   └── viewportRenderer.ts # ビューポート描画パイプライン
└── App.tsx
electron/
├── main.cjs          # メインプロセス（ウィンドウ / IPC / fs）
└── preload.cjs       # contextBridge（electronAPI 公開）
public/
└── config.yaml       # 全設定のソース
```

## 開発ルール

開発は [AI-rule.md](./AI-rule.md) に準拠します。

- **ブランチ**: GitHub Flow（`main` は常に動作可能な安定版、機能は `feature/<機能名>`）
- **コミット**: Conventional Commits（`feat:` / `fix:` / `refactor:` / `style:` / `docs:` / `config:`）
- **Push**: `npm run build` 通過を確認してからリモートへ
- **原則**: 壊さない開発（差分最小化）/ 設定駆動 / `Uint32Array` ピクセル直接操作 / 機能単位の段階的実装

## 参照ドキュメント

- [仕様書.md](./仕様書.md) — システム & 機能スペック
- [AI-rule.md](./AI-rule.md) — AI コーディング & Git ワークフロー
- [END-GOAL.md](./END-GOAL.md) — 最終ビジョン & 完成基準
