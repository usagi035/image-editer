# HowToBuild.md — ビルド手順（Web 版 / Windows .exe 版）

Image Editor のビルド方法を記載します。**成果物の説明や機能一覧は [README.md](../README.md)** を参照してください。本書は「ビルドする手順」のみを扱います。

対象ブランチ: `App_build`

---

## 1. 前提環境

| 項目 | 版 |
| :--- | :--- |
| Node.js | 18 以上（20 LTS 推奨） |
| npm | Node.js 同梱版 |
| OS | Windows 10/11（.exe ビルドは Windows 上で実行） |

> **Windows PowerShell の注意**: `npm.ps1` が実行ポリシーでブロックされる場合は `npm.cmd` を使います。
> 例: `npm.cmd run build`

---

## 2. セットアップ（初回のみ）

```bash
npm install
```

Electron / electron-builder は `devDependencies` に含まれます。

---

## 3. 開発実行

### 3.1 Web 版（ブラウザ）

```bash
npm run dev
# → http://localhost:5173
```

### 3.2 Electron 版（ウィンドウアプリ）

```bash
npm run build      # dist/ を生成
npm run electron   # Electron で起動
```

開発サーバーを読み込ませる場合は `VITE_DEV_SERVER_URL` を設定して起動します。

```powershell
# PowerShell
$env:VITE_DEV_SERVER_URL = "http://localhost:5173"
npm run dev        # 別ターミナルで Vite 起動後
npm run electron
```

---

## 4. Web 版ビルド（静的ファイル）

```bash
npm run build
```

- `tsc --noEmit`（型チェック）→ `vite build` の順に実行されます。
- 成果物: `dist/`
- `vite.config.ts` の `base: "./"` により、`file://` で開いても Electron 内でも動作します（相対パス解決）。

任意で配布用に確認する場合:

```bash
npm run preview   # http://localhost:4173 で dist/ を配信
```

---

## 5. Windows .exe ビルド（ポータブル版）

> **ポータブル版が前提**: インストーラは作らず、**単一 portable exe** と **フォルダ版** の 2 種類をビルドします。いずれもインストール不要で、ユーザー設定は **exe の隣の `data/` フォルダ** に保存されます（USB メモリからも動作・持ち運いに追従）。

### 5.1 一発ビルド

```bash
npm run build:exe
```

内部で以下が順に実行されます。

1. `npm run build` — 型チェック + Vite バンドル（`dist/`）
2. `electron-builder --win` — portable exe + フォルダ版を生成（`release/`）

### 5.2 成果物

| パス | 内容 |
| :--- | :--- |
| `release/ImageEditor-Portable-0.1.0.exe` | **ポータブル版（単一 exe）** — ダブルクリックで自己展開して起動。exe の隣に `data/` を生成 |
| `release/win-unpacked/Image Editor.exe`（フォルダ一式） | **フォルダ版** — このフォルダごと持ち運べば設定も一緒に移動（`data/` は exe 隣に生成） |

> どちらも設定・ユーザーデータは `<exe のあるフォルダ>/data/config.yaml`。書き込み不可の場所（読み取り専用媒体など）では `%APPDATA%` へフォールバックします。開発時（`npm run electron`）も従来どおり `%APPDATA%` を使います。

> `release/` と `dist/` は `.gitignore` 対象のためリポジトリには含めません。

### 5.3 ビルド設定の置き場所

electron-builder の設定は `package.json` の `"build"` フィールドにあります。

```jsonc
"build": {
  "appId": "com.usagi035.imageediter",
  "productName": "Image Editor",
  "directories": { "output": "release" },      // 出力先
  "files": [                                   // asar に同梱するもの
    "dist/**/*",        // レンダラー（Vite バンドル）
    "electron/**/*",    // main / preload
    "package.json"
  ],
  "extraResources": [                          // resources\ へ展開（asar 外）
    { "from": "public/config.yaml", "to": "config.yaml" }
  ],
  "win": { "target": [{ "target": "portable", ... }, { "target": "dir", ... }] },
  "portable": { "artifactName": "ImageEditor-Portable-${version}.${ext}" }
}
```

- **`files`**: アプリ内部（`app.asar`）に入るファイル。追加したいファイルがあればここへ。
- **`extraResources`**: 配布物の `resources\config.yaml` に出すもの（`data/config.yaml` の生成元）。**ユーザーがメモ帳で編集できるよう asar の外に置きます**。
- ターゲット: `portable`（単一 exe）と `dir`（`win-unpacked/` フォルダ版）。`nsis` インストーラは使用しません。

### 5.4 .exe 内の構成（検証結果）

```
release/win-unpacked/
├── Image Editor.exe          ← 起動本体（フォルダ版の配布物）
├── data/                     ← 起動時に生成（ユーザー設定 data/config.yaml）
├── resources/
│   ├── app.asar              ← アプリ本体
│   │   ├── dist/index.html
│   │   ├── dist/assets/*
│   │   ├── electron/main.cjs
│   │   ├── electron/preload.cjs
│   │   └── package.json
│   └── config.yaml           ← extraResources から展開（data/config.yaml の生成元）
├── *.dll / locales など      ← Electron ランタイム
```

アプリの設定読み込み順: `data\config.yaml`（`config:load` IPC。無ければ `resources\config.yaml` からコピー生成）→ `dist/config.yaml`（fetch）→ 既定値。
つまり **配布版では exe 隣の `data\config.yaml` が優先**されます。

---

## 6. ビルド後の動作確認

### 6.1 起動確認

```powershell
# ポータブル版（フォルダ版）を起動（背景で起動して確認）
$exe = ".\release\win-unpacked\Image Editor.exe"
Start-Process -FilePath (Resolve-Path $exe)
Start-Sleep -Seconds 12
Get-Process -Name "Image Editor" | Select-Object Id, MainWindowTitle
Test-Path ".\release\win-unpacked\data\config.yaml"   # ポータブルデータ置き場の生成確認
```

- `MainWindowTitle` に `Image Editor` が出ればウィンドウ生成・ロード成功です。
- `data\config.yaml` が作られていればポータブル前提のデータ置き場が有効です。
- 終了: `Get-Process -Name "Image Editor" | Stop-Process -Force`

### 6.2 ポータブル exe の確認

`release\ImageEditor-Portable-0.1.0.exe` を実行 → 自己展開して起動し、**exe の隣の `data\config.yaml`** が生成されることを確認します。
ヘッダーの「設定再読み込み」で `source` が `electron` になっていればローカル `config.yaml` を読めています。

### 6.3 asar 内容の確認（中身を検証したいとき）

```bash
npx asar list release/win-unpacked/resources/app.asar
```

---

## 7. バージョンを上げて再ビルドする

1. `package.json` の `"version"` を更新（SemVer: `v<MAJOR>.<MINOR>.<PATCH>`、AI-rule 2.2）
2. `npm run build:exe`
3. 成果物名が `ImageEditor-Portable-<新版>.exe` になることを確認

---

## 8. トラブルシューティング

| 症状 | 対処 |
| :--- | :--- |
| `npm.ps1` が実行できない | `npm.cmd run ...` に変更 |
| `default Electron icon is used` | アイコン未設定の警告。`build.win.icon`（`.ico`）を追加すると解消。動作に影響なし |
| `author is missed in the package.json` | 警告のみ。`package.json` に `author` を追記すると解消 |
| .exe 起動後に白い画面 | `npm run build` を先に実行し `dist/` を最新化してから再ビルド |
| 設定が反映されない | 配布版は exe 隣の `data\config.yaml` を編集 → ヘッダー「設定再読み込み」（`resources\config.yaml` は `data\config.yaml` が無いときの生成元） |
| 依存関係エラー | `Remove-Item -Recurse node_modules` → `npm install` |
| Electron の通信エラー | プロキシ/ファイアウォールで Electron 配布 URL へのアクセスを許可 |

---

## 9. 関連スクリプト一覧

| スクリプト | 内容 | 出力 |
| :--- | :--- | :--- |
| `npm run dev` | Vite 開発サーバー | — |
| `npm run build` | 型チェック + Vite ビルド | `dist/` |
| `npm run preview` | ビルド成果物のプレビュー | — |
| `npm run electron` | Electron 起動（`dist/` 必要） | — |
| `npm run build:exe` | **Web ビルド + ポータブル版（portable exe + フォルダ版）** | `release/` |
