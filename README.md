# Image Editor — Minecraft テクスチャ向けドット絵エディタ

**Version 0.2.0 “Stardust”**（バージョンは `package.json` と `config.yaml` の `app.version` / `app.codename` で管理 — ヘッダーとウィンドウタイトルに表示されます）

Minecraft のテクスチャ制作（16x16〜512x512px のピクセルアート）に特化したドット絵エディタで、**幅×高さ 67,108,864 px（8192x8192）** までの画像編集に対応します。**Web（Vite 静的ビルド）** と **デスクトップ（Electron）** の両方で動作します。

> 📖 **使い方（Web ページ）**: [document/index.html](./document/index.html) — ツール・操作・ショートカットをダークブルー×グラスモーフィズムのページにまとめています。

UI・色・フォント・閾値などの設定はすべて `config.yaml` で一元管理されており、コード内のハードコードは行いません。

## 主な機能

> モード分け（Pixel Art / Utility）は改訂版仕様書 2.2 により**廃止**されました。画像サイズに関わらず全ツールが利用できます。

### ピクセル編集
- **ペン**: 1px 単位描画 + Pixel-Perfect（ジグザグ抑止）切替、太さ 1〜16px
- **消しゴム / スポイト**: アルファ 0 化・クリック位置の RGBA 取得
- **図形ツール**: 直線 / 矩形 / 楕円（ドラッグ中はプレビュー、離しで確定）。矩形・楕円は「枠のみ / 塗り」切替、Shift で 45 度固定 / 正方形 / 正円
- **ミラー描画**: 縦軸 / 横軸 / 両方の対称描画（ペン・消しゴム・直線・矩形・楕円に適用）。選択範囲外への図形書き込みも遮断
- **特殊バケツ 5 モード**: Flood Fill / Global Fill / Noise Fill / Dither Fill / Eraser Fill（許容値 0〜255、ノイズ強度 0〜100%）
- **重い画素処理の Worker 実行**: 対象ピクセル数が `canvas.worker_pixel_threshold`（既定 100 万px）以上のバケツ・色置換・図形・色調整は Web Worker で実行。ヘッダーに進捗表示とキャンセルボタンを表示し、実行中は編集ツールと Undo/Redo をロックする。キャンセルした画像は実行前の状態のまま
- **範囲選択**: 矩形選択・魔術の杖（連続/全域・許容値）。選択演算は通常（置換）/ Shift=加算 / Alt=減算、メニューで全選択・解除・反転。選択境界はマーチングアンツで表示し、選択外へのペイント・塗り潰し・貼り付けを遮断
- **コピー / 切り取り / 貼り付け**: `Ctrl+C` / `Ctrl+X` / `Ctrl+V` で内部クリップボードへ。貼り付けは移動可能な浮遊状態で表示し、`Enter` またはツール切替で現在のレイヤーへ確定（`Esc` は破棄）、ドラッグで移動
- **色置換**: 指定色 A → B を「レイヤー全体 / 選択範囲」から置換（閾値以上は Worker 実行）
- **レイヤー**: 追加・複製・削除・上下移動・統合・不透明度・表示/非表示
- **HSV 調整**: Hue / 彩度 / 明度 / コントラストをスライダー即時プレビュー（大画像は表示中の範囲のみ）→ 適用。「全レイヤーに適用」チェックで選択中レイヤー以外にも一括適用、閾値以上は Worker 実行
- **Undo / Redo**: パッチ方式の履歴。ペン/消しゴムのストローク、図形確定、バケツ、色置換、レイヤー操作（追加・削除・複製・移動・不透明度・表示・統合）、HSV 適用、リサイズ/クロップをそれぞれ 1 ステップで復元

### ナビゲーション
- **移動ツール（ハンド）**: 選択中に左ドラッグで画像を移動（パン）。`Space`+ドラッグ / 中ボタンドラッグでも同じ操作が可能
- **ズーム**: ホイールでカーソル位置基準に拡大縮小（1/16〜64倍）。`Ctrl+0` で画像全体が収まる最大ズームに合わせる

### ユーティリティ
- **リサイズ**: 全レイヤーをスケール（拡大はニアレストでドット維持）
- **クロップ**: ドラッグ範囲で全レイヤーを切り出し
- **プロジェクト保存**: OpenRaster（`.ora`）にレイヤー・不透明度・可視性・名前を保持して保存（`Ctrl+S`。Electron 版は上書き / 未保存は名前付きダイアログ、ブラウザ版はダウンロード）
- **読み込み**: `.ora`（プロジェクト） / PNG / JPEG / WebP / GIF（静止画・単一レイヤー化）— ファイルダイアログ、またはキャンバスへドラッグ＆ドロップ
- **書き出し**: PNG / JPEG / WebP × 1x / 2x / 4x / 8x、品質は config 指定
- **Electron 連携**: `fs` によるネイティブダイアログでの直接読み書き（`preload` + IPC 経由）

## 技術スタック

- React 18 + TypeScript + Vite
- Tailwind CSS v4（`@tailwindcss/vite`）
- Electron（デスクトップ版 / `contextIsolation` + `preload` 経由の IPC のみ）
- `js-yaml`（`config.yaml` パース）
- `fflate`（`.ora`（zip）の非同期圧縮 / 展開）
- Lucide React（アイコン）

ピクセル処理は `ImageData` / `Uint32Array` のメモリ直接操作で行い、`fillRect` ループは使用しません。レイヤー合成は**表示中のビューポート範囲のみ**をキャッシュし、変更のあった差分矩形 ∩ ビューポートだけを再合成します（画像全体サイズの合成 Canvas は作らず、8192x8192 でもメモリは画面サイズが上限）。

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

### 配布（ポータブル版）

**ポータブル版が前提**です（インストーラなし）。ビルド手順は [docs/HowToBuild.md](./docs/HowToBuild.md) を参照。

```bash
npm run build:exe
```

| 成果物 | 内容 |
| :--- | :--- |
| `release/ImageEditor-Portable-<version>.exe` | 単一 portable exe（Electron の DLL・locales・resources を全部内包）。ダブルクリックで自己展開して起動 — **これが配布物** |

ビルド後は中間物（`win-unpacked/`・`.icon-ico/`・`builder-debug.yml` 等）を `scripts/clean-release.cjs` が自動削除し、**portable exe だけ**を `release/` に残します。フォルダ版も残したい場合は `npm run build:exe -- --keep-folder`（`release/win-unpacked/` がそのまま残ります。手動整理は `npm run clean:release`）。

portable exe・フォルダ版のどちらもユーザーデータ（`config.yaml` 等）は **exe の隣の `data/` フォルダ** に保存されるため、配布物ごと移動すれば設定も一緒に移動します（書き込み不可の場所・開発時は `%APPDATA%` へフォールバック）。

## 設定（`public/config.yaml`）

アプリは起動時に `config.yaml` を読み込み、React Context（`ConfigContext`）経由で全コンポーネントへ提供します。

- **読み込み順**: Electron（**exe 隣の `data/config.yaml`** — ポータブル版前提。無ければ同梱の既定ファイルをコピー生成／開発時・書き込み不可は `userData/config.yaml`）→ Web（`public/config.yaml`）→ フォールバック既定値
- **再読み込み**: ヘッダーの「設定再読み込み」ボタン（`config.yaml` を修正して即反映）
- **不正値の扱い**: 型違い・範囲外・色書式エラーは既定値へフォールバックし、画面下部にトースト警告（上限超過はエラーダイアログで拒否）
- **主な設定項目**
  - `theme.*` — 色・フォント・角丸（CSS 変数へ適用）
  - `canvas.max_pixels` — 幅×高さの上限（既定 67,108,864 = 8192x8192）
  - `memory.budget_mb` / `history.*` — メモリ予算と Undo/Redo の上限
  - `tools.*` — ペン/バケツ/魔術の杖/色置換/HSV の既定値
  - `export.*` — 書き出し形式・倍率・品質（0〜100）・JPEG 背景色
  - `shortcuts.*` — キーボードショートカット表記

> 色・フォント・閾値などのハードコードは禁止です。変更は必ず `config.yaml` 経由で行ってください。

## キーボードショートカット（既定値）

| 操作 | ショートカット |
| :--- | :--- |
| 保存（`.ora` 上書き / 未保存は名前付き） | `Ctrl+S` |
| 元に戻す | `Ctrl+Z` |
| やり直す | `Ctrl+Y` / `Ctrl+Shift+Z` |
| ズームイン / アウト | `Ctrl++` / `Ctrl+-` |
| 画面に合わせる（画像全体を収める最大ズーム） | `Ctrl+0` |
| ズームリセット（100% 表示） | `Ctrl+1` |
| グリッド表示切替 | `G` |
| パン（ドラッグ） | ツールの「移動」を選択 / `Space` + ドラッグ / 中ボタンドラッグ |
| コピー / 切り取り / 貼り付け | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| 全選択 / 選択解除 | `Ctrl+A` / `Ctrl+D` |
| 選択反転 | `Ctrl+Shift+I` |
| 貼り付けの確定 / 破棄・選択解除 | `Enter` / `Esc` |

## 画面構成

```
┌────────────────────────────────────────────┐
│ Header: 新規/開く/保存/書き出し/元に戻す/やり直す/設定再読み込み │  寸法 / メモリ使用量 / ズーム / グリッド
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
├── config/           # ConfigContext / configTypes / defaultConfig / validate / limits
├── editor/           # editorStore（Zustand 状態）/ EditorContext（型・Provider）+ 各ツールエンジン
│   ├── drawTools.ts        # ストローク（Bresenham / Pixel-Perfect / ミラー押印）
│   ├── shapeTools.ts       # 図形ラスタライザ（直線/矩形/楕円・Shift拘束・ミラー）
│   ├── bucketTools.ts      # 特殊バケツ 5 モード + 色置換
│   ├── pixelWorker.ts      # ピクセル処理 Worker（バケツ/色置換/図形・進捗通知）
│   ├── workerHost.ts       # Worker 実行基盤（閾値判定 / Transferable 転送 / キャンセル）
│   ├── selectionTools.ts   # 矩形/魔術の杖 + 選択演算 + マスク構築
│   ├── clipboardTools.ts   # 内部クリップボード + 貼り付け浮遊レイヤー
│   ├── adjustTools.ts      # HSV / 明度 / コントラスト
│   ├── ioTools.ts          # 読み込み / リサイズ / クロップ / 書き出し
│   ├── oraTools.ts         # OpenRaster(.ora) 入出力（fflate zip / stack.xml / レイヤーPNG）
│   ├── memoryBudget.ts     # メモリ予算（MemoryBudget）
│   ├── history.ts          # Undo/Redo（パッチ方式の履歴エンジン）
│   ├── compositor.ts       # レイヤー合成（表示範囲のみ・Uint32Array から直接）
│   └── viewportRenderer.ts # ビューポート描画パイプライン
└── App.tsx
electron/
├── main.cjs          # メインプロセス（ウィンドウ / IPC / fs）
└── preload.cjs       # contextBridge（electronAPI 公開）
public/
└── config.yaml       # 全設定のソース（Electron は exe 隣の data/config.yaml が優先）
```

## 開発ルール

開発は [AI-rule.md](./local-docs/AI-rule.md) に準拠します。

- **ブランチ**: GitHub Flow（`main` は常に動作可能な安定版、機能は `feature/<機能名>`）
- **コミット**: Conventional Commits（`feat:` / `fix:` / `refactor:` / `style:` / `docs:` / `config:`）
- **Push**: `npm run build` 通過を確認してからリモートへ
- **原則**: 壊さない開発（差分最小化）/ 設定駆動 / `Uint32Array` ピクセル直接操作 / 機能単位の段階的実装

## 参照ドキュメント

> `docs/` はグローバル（git 追跡）のドキュメント、`local-docs/` はローカル専用（`.gitignore` 対象・リポジトリには含まれません）。

- [仕様書.md](./local-docs/仕様書.md) — システム & 機能スペック
- [AI-rule.md](./local-docs/AI-rule.md) — AI コーディング & Git ワークフロー
- [END-GOAL.md](./local-docs/END-GOAL.md) — 最終ビジョン & 完成基準
