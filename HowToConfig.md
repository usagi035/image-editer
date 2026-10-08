# HowToConfig.md — 設定ファイル `config.yaml` ドキュメント

Image Editor の全設定は `config.yaml` で一元管理されます。**色・フォント・閾値などのハードコードは禁止**（AI-rule 2.1）であり、変更は必ずこのファイル経由で行います。

- 設定ファイル: [`public/config.yaml`](./public/config.yaml)
- 型定義: [`src/config/configTypes.ts`](./src/config/configTypes.ts)
- 既定値（フォールバック）: [`src/config/defaultConfig.ts`](./src/config/defaultConfig.ts)

> ビルド手順は [HowToBuild.md](./HowToBuild.md)、機能一覧は [README.md](./README.md) を参照。

---

## 1. ファイルの場所と読み込み順

アプリ起動時（または「設定再読み込み」時）に **上から順に** 試し、最初に成功したものを採用します。

| 優先 | 環境 | 場所 | source 表示 |
| :-- | :-- | :-- | :-- |
| 1 | Electron | IPC `config:load` が下記の候補を順に探索<br>① `<appPath>/config.yaml`<br>② `<resourcesPath>/config.yaml` ← **インストール版はここ**<br>③ `<appPath>/public/config.yaml`（開発時） | `electron` |
| 2 | Web | `./config.yaml`（`public/config.yaml`、キャッシュ無効） | `file` |
| 3 | 失敗時 | 組み込み既定値 `DEFAULT_CONFIG` | `default` |

- **インストール版（.exe）**: `resources\config.yaml` が優先されます。このファイルは **asar の外**にあるため、メモ帳で編集できます。
- **開発時（`npm run dev` / `npm run electron`）**: プロジェクトの `public/config.yaml` が使われます。
- source はヘッダーの「設定再読み込み」ボタンのツールチップ `config.yaml (electron)` で確認できます。
- 候補パスの生成: [`electron/main.cjs`](./electron/main.cjs) `configCandidates()`

採用したテキストは **必ず `deepMerge(DEFAULT_CONFIG, doc)` でマージ**されるため、**一部のキーだけ書いたファイルでも残りは既定値で補完**されます（欠けたキーの指定は安全）。

---

## 2. 変更手順と反映

1. `public/config.yaml`（またはインストール版の `resources\config.yaml`）を編集
2. アプリのヘッダー **「設定再読み込み」** をクリック（Web はハードリロードでも可）
3. 以下が同時に反映されます
   - **テーマ（色・フォント・角丸・チェッカー色）** → `applyTheme()` が `:root` の CSS 変数へ設定
   - **ツール初期値**（ペン太さ・色・バケツ・魔術の杖・調整値など） → `EditorContext` の config 同期 effect が再適用
   - **表示設定**（ズーム範囲・グリッド初期状態） → 同上

> 注意: 「設定再読み込み」は **ツールの現在値を config の初期値に戻します**（編集中のツールパラメータは初期化されます）。

---

## 3. YAML の書き方（規約）

```yaml
section:                 # キーは snake_case
  key: "文字列"          # コロンの後は必ず半角スペース1つ
  num: 512               # 数値はクォート不要
  flag: true             # boolean は true / false（小文字）
  list: [1, 2, 4, 8]     # 配列
  color: "#5b8cff"       # # で始まる値はクォート必須（YAML として解釈を避ける）
  note: 備考             # `#` はスペース区切りでのみコメント扱い
```

- インデントは **スペース**（タブ禁止）
- 構文エラーがあると読み込みに失敗し、**既定値（source: `default`）にフォールバック**します。エラーはコンソールに `[config] 読み込み失敗` として出ます

---

## 4. セクション別キー一覧

### 4.1 `app` — アプリ情報

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `app.name` | `Image Editor` | ヘッダー左端に表示されるアプリ名 | `HeaderBar.tsx` |
| `app.version` | `0.1.0` | 予約キー（**現状未参照**。版数は `package.json` が正） | — |

### 4.2 `theme` — 外観（`:root` の CSS 変数へ適用）

| キー | 既定値 | 説明 | CSS 変数 |
| :--- | :--- | :--- | :--- |
| `theme.colors.background` | `#1b1c22` | メイン背景色 | `--color-background` |
| `theme.colors.panel` | `#24262e` | パネル色 | `--color-panel` |
| `theme.colors.panel_alt` | `#2c2f39` | 入力欄など補助パネル | `--color-panel-alt` |
| `theme.colors.border` | `#3a3e4b` | 枠線色 | `--color-border` |
| `theme.colors.accent` | `#5b8cff` | アクセント色 | `--color-accent` |
| `theme.colors.accent_hover` | `#7aa3ff` | アクセント hover | `--color-accent-hover` |
| `theme.colors.text` | `#e7e9f0` | 基本文字色 | `--color-text` |
| `theme.colors.text_muted` | `#99a0b5` | 補助文字色 | `--color-text-muted` |
| `theme.colors.danger` | `#ff5f6d` | 危険操作色（削除など） | `--color-danger` |
| `theme.colors.header` | `#17181e` | ヘッダー色 | `--color-header` |
| `theme.font.family` | `'Segoe UI', ...` | UI フォント（CSS `font-family` 直書き可） | `--font-family-ui` |
| `theme.font.base_size` | `13px` | 基本文字サイズ | `--font-size-base` |
| `theme.font.mono_family` | `'Consolas', ...` | 等幅フォント（数値欄など） | `--font-family-mono` |
| `theme.radius` | `4px` | コントロール角丸 | `--control-radius` |
| `theme.density` | `compact` | 予約キー（`compact` \| `cozy`、**現状未参照**） | — |

適用箇所: [`src/config/ConfigContext.tsx`](./src/config/ConfigContext.tsx) `applyTheme()`

### 4.3 `canvas` — キャンバス・モード判定

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `canvas.full_feature_threshold` | `512` | **モード切替閾値**。幅・高さがいずれもこれ以下なら Pixel Art Mode、超えたら Utility Mode（`resolveMode()`） | `mode.ts` / `HeaderBar.tsx` / `EditorContext.tsx` / `CanvasViewport.tsx` |
| `canvas.max_size` | `5000` | 新規作成・リサイズ・クロップ・読込の上限辺長 | `NewDocumentDialog.tsx` / `InspectorPanel.tsx` / `EditorContext.tsx` |
| `canvas.default_width` / `default_height` | `32` / `32` | 新規ドキュメントの初期寸法（16 の倍数推奨） | `NewDocumentDialog.tsx` / `EditorContext.tsx` |
| `canvas.grid_line_color` | `rgba(255,255,255,0.07)` | グリッド細線 | `viewportRenderer.ts` |
| `canvas.grid_line_color_strong` | `rgba(255,255,255,0.16)` | グリッド太線（`grid_strong_interval` 間隔） | `viewportRenderer.ts` |
| `canvas.selection_color` | `#5b8cff` | 選択範囲のマーチング ants 色 | `CanvasViewport.tsx` |
| `canvas.checkerboard_color_a` / `_b` | `#3a3e4b` / `#2b2e38` | 透過確認用チェッカーボードの2色 | `applyTheme()` → `viewportRenderer.ts` |
| `canvas.checker_cell_size` | `8` | チェッカーのセルサイズ（CSS px） | `viewportRenderer.ts` |
| `canvas.background_color` | `#00000000` | 新規キャンバス／リサイズ・クロップ時の塗り（**RGBA 8桁**） | `EditorContext.tsx` |

### 4.4 `tools` — ツール初期値

> ここに書く値は **起動時と「設定再読み込み」時の初期値**です。

| キー | 既定値 | 範囲・説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `tools.pen.size` | `1` | ペン太さ初期値（px） | `EditorContext.tsx` / `InspectorPanel.tsx` |
| `tools.pen.max_size` | `16` | ペン太さスライダー上限 | 同上 |
| `tools.pen.pixel_perfect` | `true` | Pixel-Perfect（ジグザグ抑止）初期状態 | `EditorContext.tsx` |
| `tools.pen.default_color` | `#000000ff` | **初期プライマリ色**（`#RRGGBB` / `#RRGGBBAA`） | `EditorContext.tsx` |
| `tools.eraser.size` | `1` | 消しゴム太さ初期値 | `EditorContext.tsx` / `InspectorPanel.tsx` |
| `tools.eraser.max_size` | `16` | 消しゴム太さ上限 | 同上 |
| `tools.bucket.mode` | `flood` | 初期モード: `flood` \| `global` \| `noise` \| `dither` \| `eraser` | `EditorContext.tsx` |
| `tools.bucket.tolerance` | `16` | 許容値 0〜255 | `EditorContext.tsx` |
| `tools.bucket.jitter` | `30` | ノイズ強度 0〜100（%） | `EditorContext.tsx` |
| `tools.bucket.dither_primary` | `#000000ff` | 予約キー（**現状未参照**。プライマリ色は `pen.default_color`） | — |
| `tools.bucket.dither_secondary` | `#ffffffff` | **初期セカンダリ色**（Dither の副色／右クリック描画色） | `EditorContext.tsx` |
| `tools.bucket.dither_pattern_size` | `2` | ディザ柄のセルサイズ（px） | `CanvasViewport.tsx` |
| `tools.eyedropper.sample_merged` | `true` | 合成結果からスポイトするか | `CanvasViewport.tsx` / `InspectorPanel.tsx` |
| `tools.replace.tolerance` | `16` | 色置換の許容値 0〜255 | `EditorContext.tsx` |
| `tools.magic_wand.tolerance` | `16` | 魔術の杖の許容値 0〜255 | `EditorContext.tsx` |
| `tools.magic_wand.contiguous` | `true` | `false` で全域選択（Global Select 相当） | `EditorContext.tsx` |
| `tools.adjustment.hue` | `0` | Hue 初期値（スライダー範囲は **-180〜180**） | `EditorContext.tsx` |
| `tools.adjustment.saturation` | `0` | 彩度初期値（**-100〜100**） | `EditorContext.tsx` |
| `tools.adjustment.value` | `0` | 明度初期値（**-100〜100**） | `EditorContext.tsx` |
| `tools.adjustment.contrast` | `0` | コントラスト初期値（**-100〜100**） | `EditorContext.tsx` |
| `tools.layers.default_opacity` | `100` | 予約キー（**現状未参照**。新規レイヤーは 100% 固定） | — |
| `tools.layers.max_layers` | `64` | レイヤー上限（超過で追加ボタン無効化） | `EditorContext.tsx` / `LayersPanel.tsx` |

> 調整スライダーの**範囲**（min/max）は `src/editor/adjustTools.ts` の `ADJUST_LIMITS` が定義しています。config は**初期値**のみを担当します。

### 4.5 `ui` — ビューポート・グリッド

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `ui.show_grid` | `true` | 起動時のグリッド表示状態 | `EditorContext.tsx` |
| `ui.grid_min_zoom` | `8` | この倍率未満ではグリッド非表示 | `viewportRenderer.ts` |
| `ui.grid_strong_interval` | `16` | 太線の間隔（px）。16×16 ブロック境界向け | `viewportRenderer.ts` |
| `ui.grid_max_lines` | `1024` | グリッド描画する最大画素数（性能ガード）。超過で非描画 | `viewportRenderer.ts` |
| `ui.zoom_min` | `0.05` | ズーム最小倍率 | `EditorContext.tsx` |
| `ui.zoom_max` | `64` | ズーム最大倍率 | `EditorContext.tsx` |
| `ui.zoom_step` | `1.25` | ホイール／ズームボタンの係数 | `EditorContext.tsx` / `CanvasViewport.tsx` / `HeaderBar.tsx` |
| `ui.show_mode_banner` | `true` | ヘッダー中央のモードバナー（Pixel/Utility）表示 | `HeaderBar.tsx` |

### 4.6 `export` — 書き出し

| キー | 既定値 | 説明 | 参照 |
| :--- | :--- | :--- | :--- |
| `export.default_format` | `png` | `png` \| `jpeg` \| `webp`（Ctrl+S でこの形式・1x が即書き出し） | `HeaderBar.tsx` / `ExportDialog.tsx` |
| `export.scales` | `[1, 2, 4, 8]` | 倍率ボタンの並び | `ExportDialog.tsx` |
| `export.jpeg_quality` | `0.92` | JPEG 品質（0〜1） | `ExportDialog.tsx` |
| `export.webp_quality` | `0.92` | WebP 品質（0〜1） | `ExportDialog.tsx` |

### 4.7 `shortcuts` — キーボードショートカット

| キー | 既定値 | 割当て |
| :--- | :--- | :--- |
| `shortcuts.save` | `Ctrl+S` | 即エクスポート |
| `shortcuts.zoom_in` | `Ctrl+Plus` | ズームイン |
| `shortcuts.zoom_out` | `Ctrl+Minus` | ズームアウト |
| `shortcuts.zoom_reset` | `Ctrl+0` | 100% に戻す |
| `shortcuts.toggle_grid` | `G` | グリッド切替 |
| `shortcuts.pan` | `Space` | Space + ドラッグでパン |

- 記法・照合: [`src/editor/shortcuts.ts`](./src/editor/shortcuts.ts)
  - `+` 区切り。修飾キーは `ctrl` / `meta`(=`cmd`) / `alt` / `shift`（大文字小文字は不問）
  - 特殊名: `Plus` → `+`、`Minus` → `-`、`Space` → 空白、`Esc` → `Escape`
  - Mac では `Ctrl` は `Cmd` としても扱う
  - 修飾キーなしの単押しだと、入力欄にフォーカス中は発火しません（`isTypingTarget`）
- **未登録キー**: 選択解除の `Esc` は `EditorContext.tsx` 内で固定処理（config 化されていません）

---

## 5. 色の表記ルール

| 用途 | 形式 | 例 | 備考 |
| :--- | :--- | :--- | :--- |
| テーマ色・キャンバス色 | `#RRGGBB` または CSS 関数 | `#5b8cff` / `rgba(255,255,255,0.07)` | CSS 変数・`strokeStyle` 等にそのまま渡る |
| ツール色（`pen.default_color`, `bucket.dither_*`） | `#RRGGBB` または `#RRGGBBAA` | `#000000ff` | `toHexColor()` で `#RRGGBB` に正規化。3桁も可。**不正値は `#000000` にフォールバック** |
| `canvas.background_color` | `#RRGGBBAA` | `#00000000`（完全透明） | レイヤー塗りに使用 |

---

## 6. 読み込み失敗時の挙動

| 状況 | 結果 |
| :--- | :--- |
| ファイル無し / HTTP エラー / YAML 構文エラー | 既定値 `DEFAULT_CONFIG` を使用、`source: default`、コンソールに warn |
| キーが一部欠落 | `deepMerge` で欠け分は既定値 |
| 値の型が違う（例: 数値欄に文字列） | 型定義上はエラーにならず、想定外の値がそのまま伝わるため注意 |

---

## 7. キーを新規追加する場合

ハードコード禁止の原則に従い、**必ず次の3箇所**を揃えてください。

1. [`src/config/configTypes.ts`](./src/config/configTypes.ts) — 型へ追加
2. [`src/config/defaultConfig.ts`](./src/config/defaultConfig.ts) — 既定値を追加（**省略すると型エラー**）
3. 参照側で `config.<section>.<key>` を読む（色・閾値のハードコード禁止）

その後 `npm run build`（型チェック込み）を通過させてからコミットします。

---

## 8. よくある変更例

### モード切替閾値を 1024px に変える

```yaml
canvas:
  full_feature_threshold: 1024   # 1024x1024 まで Pixel Art Mode
```

### テーマをダークグリーン系に

```yaml
theme:
  colors:
    background: "#141a16"
    panel: "#1d251f"
    accent: "#4cc38a"
    accent_hover: "#6fd6a3"
```

### 新規ドキュメントの既定を 16×16（Minecraft アイテム向け）に

```yaml
canvas:
  default_width: 16
  default_height: 16
```

### ズーム上限を引き上げ＋グリッドを見やすく

```yaml
ui:
  zoom_max: 128
  grid_min_zoom: 4
  grid_line_color: "rgba(0,255,180,0.18)"
```

### エクスポートを WebP・倍率 2/4 のみに

```yaml
export:
  default_format: "webp"
  scales: [2, 4]
  webp_quality: 0.85
```

### 初期ペンを赤・太さ4に

```yaml
tools:
  pen:
    size: 4
    default_color: "#e5484dff"
```

### 設定ファイルの場所をアプリと分ける（Electron）

インストール先の `resources\config.yaml` を編集 → ヘッダー「設定再読み込み」。
開発時は `public/config.yaml` を編集（Git 管理されるので `config:` プレフィックスでコミット）。

---

## 9. 関連ファイル一覧

| ファイル | 役割 |
| :--- | :--- |
| `public/config.yaml` | **設定本体**（Web / 開発時の読み込み元） |
| `src/config/configTypes.ts` | 設定の型定義（キーの正） |
| `src/config/defaultConfig.ts` | 既定値と `deepMerge` 実装 |
| `src/config/ConfigContext.tsx` | 読み込み・再読み込み・テーマ適用（`applyTheme`） |
| `src/config/mode.ts` | `full_feature_threshold` によるモード判定 |
| `electron/main.cjs` | Electron 版の探索パス（`configCandidates`）と IPC |
| `electron/preload.cjs` | `loadConfig` / `loadConfigPath` の公開 |
| `src/components/HeaderBar.tsx` | 「設定再読み込み」ボタン（source 表示） |
