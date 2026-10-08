# HowToBuild.md — ビルド手順（Web 版 / Windows .exe 版）

Image Editor のビルド方法を記載します。**成果物の説明や機能一覧は [README.md](./README.md)** を参照してください。本書は「ビルドする手順」のみを扱います。

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

## 5. Windows .exe ビルド（本手順）

### 5.1 一発ビルド

```bash
npm run build:exe
```

内部で以下が順に実行されます。

1. `npm run build` — 型チェック + Vite バンドル（`dist/`）
2. `electron-builder --win` — NSIS インストーラ生成（`release/`）

### 5.2 成果物

| パス | 内容 |
| :--- | :--- |
| `release/ImageEditor-Setup-0.1.0.exe` | **インストーラ**（ユーザー配布用） |
| `release/win-unpacked/Image Editor.exe` | **ポータブル版**（インストール不要・その場で起動） |
| `release/latest.yml` / `*.blockmap` | electron-updater 用（自動更新を使う場合） |

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
  "win": { "target": [{ "target": "nsis", "arch": ["x64"] }] },
  "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true, ... }
}
```

- **`files`**: アプリ内部（`app.asar`）に入るファイル。追加したいファイルがあればここへ。
- **`extraResources`**: インストール先の `resources\config.yaml` に出すもの。**ユーザーがメモ帳で編集できるよう asar の外に置きます**。
- ターゲットを追加する場合は `win.target` に `"portable"` / `"zip"` 等を追記します。

### 5.4 .exe 内の構成（検証結果）

```
release/win-unpacked/
├── Image Editor.exe          ← 起動本体
├── resources/
│   ├── app.asar              ← アプリ本体
│   │   ├── dist/index.html
│   │   ├── dist/assets/*
│   │   ├── electron/main.cjs
│   │   ├── electron/preload.cjs
│   │   └── package.json
│   └── config.yaml           ← extraResources から展開（編集可）
└── *.dll / locales など      ← Electron ランタイム
```

アプリの設定読み込み順: `resources\config.yaml`（`config:load` IPC）→ `dist/config.yaml`（fetch）→ 既定値。
つまり **インストール版では `resources\config.yaml` が優先**されます。

---

## 6. ビルド後の動作確認

### 6.1 起動確認

```powershell
# ポータブル版を起動（背景で起動して確認）
$exe = ".\release\win-unpacked\Image Editor.exe"
Start-Process -FilePath (Resolve-Path $exe)
Start-Sleep -Seconds 12
Get-Process -Name "Image Editor" | Select-Object Id, MainWindowTitle
```

- `MainWindowTitle` に `Image Editor` が出ればウィンドウ生成・ロード成功です。
- 終了: `Get-Process -Name "Image Editor" | Stop-Process -Force`

### 6.2 インストーラ確認

`release\ImageEditor-Setup-0.1.0.exe` を実行 → インストール先で `Image Editor.exe` を起動し、
ヘッダーの「設定再読み込み」で `source` が `electron` になっていればローカル `config.yaml` を読めています。

### 6.3 asar 内容の確認（中身を検証したいとき）

```bash
npx asar list release/win-unpacked/resources/app.asar
```

---

## 7. バージョンを上げて再ビルドする

1. `package.json` の `"version"` を更新（SemVer: `v<MAJOR>.<MINOR>.<PATCH>`、AI-rule 2.2）
2. `npm run build:exe`
3. 成果物名が `ImageEditor-Setup-<新版>.exe` になることを確認

---

## 8. トラブルシューティング

| 症状 | 対処 |
| :--- | :--- |
| `npm.ps1` が実行できない | `npm.cmd run ...` に変更 |
| `default Electron icon is used` | アイコン未設定の警告。`build.win.icon`（`.ico`）を追加すると解消。動作に影響なし |
| `author is missed in the package.json` | 警告のみ。`package.json` に `author` を追記すると解消 |
| .exe 起動後に白い画面 | `npm run build` を先に実行し `dist/` を最新化してから再ビルド |
| 設定が反映されない | インストール版は `resources\config.yaml` を編集 → ヘッダー「設定再読み込み」 |
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
| `npm run build:exe` | **Web ビルド + NSIS インストーラ** | `release/` |
