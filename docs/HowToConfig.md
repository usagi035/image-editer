# HowToConfig.md — 設定ファイル `config.yaml` ドキュメント（スキーマ v2）

Image Editor の全設定は `config.yaml` で一元管理されます。**色・フォント・閾値などのハードコードは禁止**（AI-rule 2.1 / 改訂版仕様書 9）であり、変更は必ずこのファイル経由で行います。

- 設定ファイル: [`public/config.yaml`](../public/config.yaml)
- 型定義: [`src/config/configTypes.ts`](../src/config/configTypes.ts)
- 既定値（安全網）: [`src/config/defaultConfig.ts`](../src/config/defaultConfig.ts)
- 検証（不正値フォールバック）: [`src/config/validate.ts`](../src/config/validate.ts)

> ビルド手順は [HowToBuild.md](./HowToBuild.md)、機能一覧は [README.md](../README.md)、仕様は local-docs/仕様書 を参照。

---

## 1. ファイルの場所と読み込み順

アプリ起動時（または「設定再読み込み」時）に **上から順に** 試し、最初に成功したものを採用します。

| 優先 | 環境 | 場所 | source 表示 |
| :-- | :-- | :-- | :-- |
| 1 | Electron | IPC `config:load` が **`<exe のあるフォルダ>/data/config.yaml`（ポータブル版前提）** を読み込む。**存在しなければ同梱の既定ファイルをコピーして生成**（既定候補: `resources/config.yaml` → `dist/config.yaml` → `public/config.yaml` の順に探索） | `electron` |
| 2 | Web | `./config.yaml`（`public/config.yaml`、キャッシュ無効） | `file` |
| 3 | 失敗時 | 組み込み既定値 `DEFAULT_CONFIG` | `default` |

- **Electron のユーザー設定**: **ポータブル版（`build:exe` の成果物）は exe の隣の `<exe のあるフォルダ>/data/config.yaml`**。フォルダごと持ち運べば設定も一緒に移動します。**開発時（`npm run dev` / `npm run electron`）と書き込み不可の場所では** 従来どおり `%APPDATA%\image-editer\config.yaml` にフォールバックします。いずれもメモ帳で編集できます（asar の外にあります）。
- **開発時**: 起動時に `userData/config.yaml` が生成されるので、以降はそちらが優先されます。リポジトリの `public/config.yaml` を変える場合は **`userData/config.yaml` と両方**を直すか、`userData` 側を削除して再生成してください。
- source はヘッダー「設定再読み込み」ボタンのツールチップ `config.yaml (electron)` で確認できます。
- 候補パスの生成: [`electron/main.cjs`](../electron/main.cjs) `resolveDataDir()` / `ensureUserConfig()`

### 欠落・不正値の扱い（改訂版仕様書 2.1）

| 状況 | 挙動 |
| :--- | :--- |
| キー欠落 | 既定値で補完（警告なし・部分編集は安全） |
| 型違い・範囲外・色書式エラー | **既定値へフォールバック**し、画面下部に**トースト警告**（例: `canvas.zoom_max: 型が不正です…`） |
| 未知のキー | 無視してトースト警告（タイプミス検出） |
| ファイル無し / YAML 構文エラー | 既定値で起動し、トースト警告。アプリは起動を続行する |
| 上限超過（サイズ / メモリ） | **エラーダイアログ**で拒否（トーストではない） |

検証は [`src/config/validate.ts`](../src/config/validate.ts) が、既定値ツリーを走査して型・範囲・色書式を確認します。

---

## 2. 変更手順と反映

1. 編集（開発: `public/config.yaml` ／ 運用: `<exe のあるフォルダ>/data/config.yaml`。開発時は `userData/config.yaml`）
2. ヘッダーの **「設定再読み込み」** をクリック（Web はハードリロードでも可）
3. 以下が同時に反映される
   - **テーマ**（色・フォント・角丸・チェッカー色） → `applyTheme()` が `:root` の CSS 変数へ
   - **ツール初期値**（ペン太さ・色・バケツ・魔術の杖・調整値） → `EditorContext` の config 同期 effect
   - **表示設定**（ズーム範囲・グリッド初期状態） → 同上

> 注意: 再読み込みは **ツールの現在値を config の初期値に戻します**。

---

## 3. YAML の書き方（規約）

```yaml
section:                 # キーは snake_case
  key: "文字列"          # コロンの後は半角スペース1つ
  num: 512               # 数値はクォート不要
  flag: true             # boolean は true / false（小文字）
  list: [1, 2, 4, 8]     # 配列
  color: "#4f8cff"       # # で始まる値はクォート必須
```

- インデントは **スペース**（タブ禁止）
- タブ混入・インデント崩れは YAML 構文エラー → 既定値で起動 + トースト

---

## 4. セクション別キー一覧

### 4.1 `app` — アプリ情報

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `app.name` | `Image Editor` | ヘッダー左端のアプリ名 | `HeaderBar.tsx` |
| `app.version` | `0.2.0` | ヘッダーの `v0.2.0` 表示とウィンドウタイトル（`document.title`）。**`package.json` の `version` と必ず一致させる**（成果物名 `ImageEditor-Portable-<version>.exe` にも影響） | `HeaderBar.tsx` |
| `app.codename` | `Stardust` | バージョンのコードネーム。ヘッダーの `“Stardust”` 表示とウィンドウタイトルに使用 | `HeaderBar.tsx` |

### 4.2 `theme` — 外観（フラット構造・`:root` の CSS 変数へ）

| キー | 既定値 | CSS 変数 |
| :--- | :--- | :--- |
| `theme.background` | `#1e1e24` | `--color-background` |
| `theme.panel` | `#2a2a33` | `--color-panel` |
| `theme.panel_alt` | `#2c2f39` | `--color-panel-alt` |
| `theme.border` | `#3a3e4b` | `--color-border` |
| `theme.accent` | `#4f8cff` | `--color-accent` |
| `theme.accent_hover` | `#7aa3ff` | `--color-accent-hover` |
| `theme.text` | `#e7e9f0` | `--color-text` |
| `theme.text_muted` | `#99a0b5` | `--color-text-muted` |
| `theme.danger` | `#ff5f6d` | `--color-danger` |
| `theme.header` | `#17181e` | `--color-header` |
| `theme.font` | `Inter, system-ui, sans-serif` | `--font-family-ui` |
| `theme.font_size` | `13px` | `--font-size-base` |
| `theme.font_mono` | `'Consolas', 'Menlo', monospace` | `--font-family-mono` |
| `theme.radius` | `4px` | `--control-radius` |

> Electron 起動直後のウィンドウ背景色も `theme.background` から main プロセスで直接読みます（読めなければ既定値 `#1e1e24`）。

### 4.3 `canvas` — キャンバス・上限・ズーム・グリッド

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `canvas.default_width` / `_height` | `64` | 新規ドキュメントの既定寸法 | `NewDocumentDialog.tsx` / `EditorContext.tsx` |
| `canvas.max_pixels` | `67108864` | **幅×高さの上限（8192×8192）**。超過時はエラーダイアログで拒否 | `limits.ts` → `EditorContext` / `NewDocumentDialog` / `InspectorPanel` |
| `canvas.worker_pixel_threshold` | `1000000` | このピクセル数以上の重い処理は Worker で実行（実装は MS6） | —（MS6 で参照開始） |
| `canvas.grid_min_zoom` | `8` | この倍率以上でグリッド線を表示 | `viewportRenderer.ts` |
| `canvas.grid_strong_interval` | `16` | 太線の間隔（px）。16×16 ブロック境界向け | `viewportRenderer.ts` |
| `canvas.grid_max_lines` | `1024` | グリッド描画の最大画素数（性能ガード） | `viewportRenderer.ts` |
| `canvas.zoom_min` / `_max` | `0.0625` / `64` | ズーム範囲（1/16〜64）。`min ≥ max` は既定へ戻して警告 | `EditorContext.tsx` |
| `canvas.grid_line_color` / `_strong` | `rgba(255,255,255,0.07)` / `0.16` | グリッド細線 / 太線 | `viewportRenderer.ts` |
| `canvas.selection_color` | `#4f8cff` | 選択範囲の点線色 | `CanvasViewport.tsx` |
| `canvas.checkerboard_color_a` / `_b` | `#3a3e4b` / `#2b2e38` | 透過確認用チェッカーの2色 | `applyTheme()` → `viewportRenderer.ts` |
| `canvas.checker_cell_size` | `8` | チェッカーのセル（CSS px） | `viewportRenderer.ts` |
| `canvas.background_color` | `#00000000` | 新規キャンバスの初期色（RGBA 8桁） | `EditorContext.tsx` |

### 4.4 `memory` / `history` — 予算と履歴（改訂版仕様書 2.2 / 4.6）

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `memory.budget_mb` | `1536` | 全レイヤー + 選択マスク + 履歴の合計上限。超過するレイヤー追加・複製・新規作成・読込は**拒否＋エラーダイアログ** | `memoryBudget.ts`（`MemoryBudget` クラス）→ `EditorContext` / `HeaderBar` |
| `history.max_steps` | `100` | Undo の最大ステップ数（超過分は古い順に破棄） | `history.ts`（`HistoryEngine`）→ `editorStore.ts` |
| `history.max_memory_mb` | `512` | 履歴合計サイズ上限（超過時は古い順に破棄。単独で超過する操作は実行前に確認ダイアログ） | `history.ts`（`HistoryEngine`）→ `editorStore.ts` |

> ヘッダーの「メモリ 1.0 / 1536.0 MB」が使用量と予算（割合 80% 超で赤表示）。

### 4.5 `tools` — ツール初期値

> 起動時と「設定再読み込み」時の初期値です。

| キー | 既定値 | 範囲・説明 |
| :--- | :--- | :--- |
| `tools.pen.size` / `_max_size` | `1` / `16` | ペン太さの初期値 / 上限（px） |
| `tools.pen.pixel_perfect` | `true` | Pixel-Perfect 初期状態 |
| `tools.pen.default_color` | `#000000ff` | 初期プライマリ色（`#RRGGBB` / `#RRGGBBAA`） |
| `tools.eraser.size` / `_max_size` | `1` / `16` | 消しゴム太さ |
| `tools.bucket.mode` | `flood` | `flood` \| `global` \| `noise` \| `dither` \| `eraser` |
| `tools.bucket.tolerance` | `0` | 許容値 0〜255（仕様 4.2: 既定 0） |
| `tools.bucket.jitter` | `20` | ノイズ強度 0〜100（%）（既定 20） |
| `tools.bucket.dither_primary` | `#000000ff` | 予約キー（**現状未参照**。プライマリは `pen.default_color`） |
| `tools.bucket.dither_secondary` | `#ffffffff` | 初期セカンダリ色（Dither 副色） |
| `tools.bucket.dither_pattern_size` | `2` | ディザ柄のセル（px） |
| `tools.eyedropper.sample_merged` | `true` | 合成結果からスポイト |
| `tools.shape.fill_mode` | `outline` | 矩形・楕円の塗りモード初期値。`outline`（枠のみ） \| `fill`（塗り）。UI から切替可能 |
| `tools.shape.mirror` | `none` | ミラー描画の対称軸。`none` \| `vertical`（縦軸） \| `horizontal`（横軸） \| `both`（両方）。ペン・消しゴム・図形に適用 |
| `tools.replace.tolerance` | `16` | 色置換の許容値 0〜255 |
| `tools.magic_wand.tolerance` / `_contiguous` | `16` / `true` | 魔術の杖。`false` で全域選択 |
| `tools.adjustment.hue` | `0` | Hue 初期値（範囲 -180〜180、範囲自体は `adjustTools.ts` の `ADJUST_LIMITS`） |
| `tools.adjustment.saturation` / `_value` / `_contrast` | `0` | -100〜100 |
| `tools.layers.default_opacity` | `100` | 予約キー（**現状未参照**。新規レイヤーは 100% 固定） |
| `tools.layers.max_layers` | `64` | レイヤー枚数上限（予算とは別枠） |

### 4.6 `ui` — ビューポート表示

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `ui.show_grid` | `true` | 起動時のグリッド表示状態 | `EditorContext.tsx` |
| `ui.zoom_step` | `1.25` | ホイール / ズームボタンの係数 | `EditorContext` / `CanvasViewport` / `HeaderBar` |

### 4.7 `export` — 書き出し

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `export.default_format` | `png` | `png` \| `jpeg` \| `webp`（書き出しダイアログの既定形式） | `HeaderBar.tsx` / `ExportDialog.tsx` |
| `export.scales` | `[1, 2, 4, 8]` | 倍率ボタン | `ExportDialog.tsx` |
| `export.jpeg_quality` | `92` | **0〜100**（Canvas API 用に `/100` して渡す） | `ioTools.qualityFor` |
| `export.jpeg_background` | `#ffffff` | **JPEG の透過部分を塗る背景色** | `ioTools.renderExportCanvas` |
| `export.webp_quality` | `92` | 0〜100 | `ioTools.qualityFor` |

### 4.8 `shortcuts` — キーボードショートカット

| キー | 既定値 | 割当て |
| :--- | :--- | :--- |
| `shortcuts.save` | `Ctrl+S` | `.ora` プロジェクト保存（上書き / 未保存は名前付き） |
| `shortcuts.undo` | `Ctrl+Z` | 元に戻す（ヘッダーの「元に戻す」ボタンと連動） |
| `shortcuts.redo` / `redo_alternative` | `Ctrl+Y` / `Ctrl+Shift+Z` | やり直す（どちらでも可） |
| `shortcuts.zoom_in` / `_out` | `Ctrl+Plus` / `Ctrl+Minus` | ズームイン / アウト（カーソル位置基準） |
| `shortcuts.fit` | `Ctrl+0` | 画面に合わせる（画像全体が収まる最大ズーム・中央寄せ。画像を開いた初期ズームもこれ） |
| `shortcuts.zoom_reset` | `Ctrl+1` | 100% 表示 |
| `shortcuts.toggle_grid` | `G` | グリッド切替 |
| `shortcuts.pan` | `Space` | Space + ドラッグでパン |

- 記法・照合: [`src/editor/shortcuts.ts`](../src/editor/shortcuts.ts)（`+` 区切り、`Plus`/`Minus`/`Space`/`Esc` の特殊名、Mac は Cmd 互換）
- 未登録: 選択解除の `Esc` は `EditorContext` 内で固定処理

---

## 5. 色の表記ルール

| 用途 | 形式 | 例 |
| :--- | :--- | :--- |
| テーマ色・キャンバス色 | `#RRGGBB` / `rgba(...)` | `#4f8cff` / `rgba(255,255,255,0.07)` |
| ツール色（`pen.default_color`, `dither_*`） | `#RRGGBB` / `#RRGGBBAA` | `#000000ff`（不正値は `#000000` にフォールバック） |
| `canvas.background_color` / `export.jpeg_background` | `#RRGGBBAA` / `#RRGGBB` | `#00000000`（完全透明） |

検証時の色チェック: `#hex(3/6/8)` または `rgb()/rgba()` 以外は不正扱いで既定値に戻し警告。

---

## 6. キーを新規追加する場合

1. [`src/config/configTypes.ts`](../src/config/configTypes.ts) — 型へ追加
2. [`src/config/defaultConfig.ts`](../src/config/defaultConfig.ts) — 既定値を追加（**省略すると型エラー**）
3. [`public/config.yaml`](../public/config.yaml) — 実ファイルへ追記（README 同期）
4. 参照側で `config.<section>.<key>` を読む（ハードコード禁止）

範囲チェックが必要な数値は [`src/config/validate.ts`](../src/config/validate.ts) の `normalize()` に case を追加します。追加後は `npm run build`（型チェック込み）を通過させてからコミット。

---

## 7. よくある変更例

### 開ける画像の上限を変える（仕様 2.2）

```yaml
canvas:
  max_pixels: 16777216        # 4096x4096 まで
```

### メモリ予算を増やす（レイヤーを沢山使う場合）

```yaml
memory:
  budget_mb: 3072
```

### 新規ドキュメントの既定を 16×16 に

```yaml
canvas:
  default_width: 16
  default_height: 16
```

### JPEG の透過背景と品質

```yaml
export:
  jpeg_quality: 85
  jpeg_background: "#1e1e24"
```

### テーマ変更

```yaml
theme:
  background: "#141a16"
  accent: "#4cc38a"
  font: "'Noto Sans JP', system-ui, sans-serif"
```

---

## 8. 関連ファイル一覧

| ファイル | 役割 |
| :--- | :--- |
| `public/config.yaml` | 設定本体（開発 / Web の読み込み元・同梱既定） |
| `src/config/configTypes.ts` | 型定義（キーの正） |
| `src/config/defaultConfig.ts` | 既定値と `deepMerge` |
| `src/config/validate.ts` | 不正値の検証と警告収集（欠落=補完 / 不正=既定値） |
| `src/config/ConfigContext.tsx` | 読み込み・再読み込み・テーマ適用・警告トースト |
| `src/config/limits.ts` | `max_pixels` の上限チェックとエラーメッセージ |
| `src/editor/memoryBudget.ts` | `MemoryBudget`（予算判定）と使用量整形 |
| `src/components/notify.ts` / `NotifyHost.tsx` | トースト / エラーダイアログの描画 |
| `electron/main.cjs` | `data/config.yaml` の生成・読込（ポータブル解決 + `userData` フォールバック）・背景色取得 |
| `src/components/HeaderBar.tsx` | 「設定再読み込み」（source 表示）とメモリ使用量表示 |

---

## 9. 改訂版仕様への移行状況

| 項目 | 状態 |
| :--- | :--- |
| `userData/config.yaml` + 既定コピー生成 | 実装済み（本ブランチ） |
| 検証（不正値フォールバック）+ トースト | 実装済み（本ブランチ） |
| `max_pixels` 上限チェック + エラーダイアログ | 実装済み（本ブランチ） |
| `MemoryBudget` クラス + 予算拒否 + ヘッダー表示 | 実装済み（本ブランチ） |
| `export.jpeg_background` / 品質 0〜100 | 実装済み（本ブランチ） |
| モード分けの廃止（`full_feature_threshold` / `show_mode_banner` 削除） | 実装済み（`feature/mode-removal`） |
| Worker（`worker_pixel_threshold`） | MS6 |
| 履歴（`history.*`） | 実装済み（Undo/Redo: `history.ts` + ヘッダーボタン + `Ctrl+Z`/`Ctrl+Y`） |
| Zustand / Vitest | `feature/state-zustand` |
| ビューポート範囲のみの合成 + 画面に合わせる（MS2） | 実装済み（`feature/viewport-region`）: `compositor.ts` が表示中ドキュメント範囲∩ダーティ矩形のみ合成。`shortcuts.fit` = `Ctrl+0` / `zoom_reset` = `Ctrl+1` |
| レイヤー実体を `Uint32Array` に（MS4） | 実装済み（`feature/layer-uint32`）: `Layer` は非表示 Canvas を持たず `pixels: Uint32Array` を保持。描画・バケツ・色置換・HSV・履歴パッチはすべて直接ピクセル操作 |
| 重い画素処理を Worker へ（MS6） | 実装済み（`feature/worker-bucket`）: `canvas.worker_pixel_threshold`（既定 100 万px）以上のバケツは Web Worker（`pixelWorker.ts`）で実行。ヘッダーに進捗`<progress>`とキャンセルボタンを表示、実行中はツールと Undo/Redo をロック。キャンセル時は結果を破棄して実行前の状態のまま。小画像は従来どおりメインスレッド同期実行 |
| 選択 & 色置換（MS7） | 実装済み（`feature/selection-replace`）: 選択演算（通常/Shift加算/Alt減算・全選択/解除/反転）・マーチングアンツ・選択外への書き込み遮断・コピー/切り取り/貼り付け（浮遊→Enter/ツール切替で確定・Escで破棄）・色置換の範囲（選択/レイヤー全体）。閾値以上の色置換は Worker 実行。ショートカット `copy`/`cut`/`paste`/`select_all`/`deselect`/`invert_selection` を追加 |
| 図形 & ミラー（MS8） | 実装済み（`feature/shapes-mirror`）: 直線/矩形/楕円ツール（ドラッグ中プレビュー・離しで確定、矩形・楕円は `tools.shape.fill_mode` で枠のみ/塗り、Shift=45度/正方形/正円）+ ミラー描画（`tools.shape.mirror`: 縦軸/横軸/両方をペン・消しゴム・図形に適用）。選択マスクで書き込み遮断。塗り図形は `worker_pixel_threshold` 以上で Worker 実行（進捗・キャンセル・編集ロックはバケツと共通） |
| 色調整の Worker 化（MS9） | 実装済み（`feature/ms9-adjust-worker`）: HSV/コントラスト確定は `worker_pixel_threshold` 以上で Web Worker 実行（`adjust` ジョブ・複数レイヤーは並列・進捗は加重平均・キャンセル時は実行前のまま）。リアルタイムプレビューは**表示中ビューポート範囲のみ**をデバイス解像度で合成（大画像でもプレビューのメモリは画面サイズ上限）。「全レイヤーに適用」チェックで選択中レイヤー以外にも一括適用 |
| .ora 入出力（MS10） | 実装済み（`feature/ms10-ora`）: プロジェクト形式 = OpenRaster（`oraTools.ts` + `fflate`）。`Ctrl+S` は `.ora` 保存（Electron: `docPath` あれば上書き・無ければ名前付きダイアログ / ブラウザ: ダウンロード）、画像書き出しは「書き出し」ボタン（ExportDialog）に分離。読込は「開く」/ D&D / ファイル選択で `.ora` を判別してレイヤー構造（名前・不透明度・可視性）を復元（`loadOra`）。zip 構成: `mimetype`（先頭・非圧縮）/ `stack.xml`（自前パーサ）/ `data/*.png`（最前面=0.png）/ `mergedimage.png`。4096x4096 の保存/読込を実機確認 |
| ポータブル版前提 | 実装済み（`feature/portable-app`）: `build:exe` は NSIS インストーラを廃止し **portable exe + フォルダ版（`dir` ターゲット）** の 2 成果物を生成。ユーザー設定は **exe 隣の `data/config.yaml`**（portable は `PORTABLE_EXECUTABLE_DIR` / フォルダ版は exe のあるフォルダ）。書き込み不可・開発時は `userData/config.yaml` へフォールバック。`data/` ごと移動すれば設定も持ち運び可能 |
| 移動ツール（仕様 3） | 実装済み（`feature/hand-tool`）: ツールボックスに「移動」（ハンド）を追加し、左ドラッグでビューポートをパン。Space+ドラッグ / 中ボタンドラッグも従来どおり利用可。ズーム中に見切れた画像はドラッグで移動でき、`Ctrl+0` で全体表示に合わせ直せる |
