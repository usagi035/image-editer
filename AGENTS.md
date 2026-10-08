# AGENTS.md — AI がこのリポジトリで作業するためのルール

対象: Image Editor（Minecraft テクスチャ向けドット絵エディタ）
参照: `AI-Docs/仕様書（改訂版）` / `AI-Docs/AI-rule.md` / `AI-Docs/END-GOAL.md`

---

## 1. 使用技術（仕様書 1章の表のみ・依存の追加禁止）

- **追加可能なライブラリは仕様書 1章の表に列挙されたものだけ**。ユーザーの承認なしに依存を追加しない。
  - React 18 / TypeScript (strict) / Vite / Tailwind CSS / Lucide React / Electron / `js-yaml` / Zustand / `fflate`
  - Vitest は仕様書 7章のテスト要件のために追加が承認済みの **開発専用** 依存。
- `any` を使わない（`tsc --noEmit` がエラー0であること）。
- `nodeIntegration: true` を禁止。renderer から `fs` 等の Node API を直接使わない（`preload` + IPC のみ）。
- Electron 本体: `electron/main.cjs` / `electron/preload.cjs` は `contextIsolation: true` を維持する。

## 2. データの扱い（性能・正確性）

- **ピクセルデータを React state に入れない**（レイヤー本体は React 外のデータ構造で保持する）。
- **画像全体サイズの Canvas を作らない** — 合成は「ビューポート範囲 ∩ ダーティ矩形」のみ。
- **重い画素処理は Worker で実行**し、メインスレッドで全画素ループを回さない（`canvas.worker_pixel_threshold` 以上は必ず Worker 対象）。
- **色のビット操作は `color.ts`（`packRGBA` / `getR,G,B,A`）経由のみ** — 他所で直接のビット演算を書かない。
  - `Uint32Array` はリトルエンディアン環境で ABGR 並びになる。

## 3. 設定駆動

- 色・フォント・閾値・上限・既定値などのハードコードは禁止。全て `public/config.yaml` 経由で参照する。
  - 型: `src/config/configTypes.ts` ／ 既定値: `src/config/defaultConfig.ts` ／ 検証: `src/config/validate.ts`
  - キー追加時は上記2ファイル + `config.yaml` の **3箇所を必ず同時更新**する。
- Electron 版は `userData/config.yaml` が優先（無ければ同梱既定からコピー生成）。

## 4. 依頼・ワークフロー

- **1回の依頼では指定のマイルストーン以外を実装しない**（仕様書 8章のマイルストーンは1つずつ依頼する）。
- 実装後は必ず **`npx tsc --noEmit`（または `npm run build`）と `npm test` を実行して結果を報告**する。
- Git は AI-rule 準拠:
  - 機能単位で `feature/<機能名>` ブランチ → `npm run build` 通過 → commit → `--no-ff` merge → ブランチ削除 → Push
  - コミット規約: `feat:` / `fix:` / `refactor:` / `style:` / `docs:` / `config:`
  - 壊さない開発（差分最小化）、既存動作を壊す変更は禁止
- ドキュメントは用途別に分離: `README.md`（機能概要）/ `HowToBuild.md`（ビルド手順）/ `HowToConfig.md`（設定解説）
- PowerShell では `npm.cmd` / `npx.cmd` を使う（`npm.ps1` は実行ポリシーでブロックされる）。

## 5. 実行コマンド

| コマンド | 内容 |
| :--- | :--- |
| `npm run build` | `tsc --noEmit` + Vite ビルド（CI 相当のゲート） |
| `npm test` | Vitest 実行（`src/**/*.test.ts`） |
| `npm run preview` | ビルド成果物のプレビュー（検証用） |
| `npm run electron` | Electron 版起動（先に `build` が必要） |
| `npm run build:exe` | Windows 用インストーラ生成（`release/`） |

## 6. 現在の準拠状況（既知の未達＝実装済みマイルストーン待ち）

| ルール | 状態 | 対応 |
| :--- | :--- | :--- |
| ピクセルデータを React state に入れない | **未達**（`layers` を `useState` で保持） | マイルストーン4 |
| 画像全体サイズの Canvas を作らない | **未達**（`compositor.ts` が全サイズ合成キャッシュ） | マイルストーン2 |
| 重い画素処理を Worker へ | **未達**（全処理がメインスレッド同期） | マイルストーン6 |
| Undo / Redo | **未実装** | マイルストーン5 |
| `max_pixels`・`MemoryBudget` | 遵守済み | — |
| モード分けの廃止（仕様 2.2） | 遵守済み | — |
| 色変換の `color.ts` 経由 | 遵守済み | — |
| `any` 禁止 / `tsc` エラー0 | 遵守済み | — |
