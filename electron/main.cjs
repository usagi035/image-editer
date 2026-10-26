/**
 * Electron メインプロセス（仕様書 5. Electron連携）
 * - config.yaml のローカル読み込み（Web 版は fetch、Electron 版は fs）
 * - 画像のオープン / 上書き保存（ネイティブダイアログ + fs 直接書き込み）
 * - セキュリティ: contextIsolation: true / nodeIntegration: false + preload 経由の IPC のみ
 */
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const isDev = !!process.env.VITE_DEV_SERVER_URL;

/** ウィンドウ背景色の安全網（config.yaml の theme.background と同一） */
const DEFAULT_WINDOW_BACKGROUND = "#1e1e24";

/** 同梱の既定 config.yaml の候補パス（優先順） */
function bundledConfigCandidates() {
  const paths = [
    // インストール版: asar 外でユーザーが編集できる resources/config.yaml
    path.join(process.resourcesPath || "", "config.yaml"),
    // Vite ビルド成果物（public/ からコピー済み）
    path.join(app.getAppPath(), "dist", "config.yaml"),
    // 開発時
    path.join(app.getAppPath(), "public", "config.yaml"),
  ];
  return paths.filter((p) => p && p !== "config.yaml");
}

function findBundledConfig() {
  for (const p of bundledConfigCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* アクセス不可候補はスキップ */
    }
  }
  return null;
}

/**
 * ポータブル版前提（exe 隣の data/）のユーザーデータ置き場。
 * - electron-builder portable exe: `PORTABLE_EXECUTABLE_DIR`（一時展開先ではなく元の exe のフォルダ）
 * - フォルダ版: exe のあるフォルダ（配布物ごと持ち運べば設定も追従）
 * - 開発時 / 書き込み不可（読み取り専用媒体など）: 従来どおり `userData` へフォールバック
 * 書き込み可否は実際に書けるかプローブして判定し、結果はキャッシュする。
 */
let dataDirCache = null;

function resolveDataDir() {
  if (dataDirCache) return dataDirCache;
  const candidates = [];
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    // portable exe: 一時展開先（execPath）は消えるため使わない
    candidates.push(path.join(portableDir, "data"));
  } else if (app.isPackaged) {
    // フォルダ版: exe のあるフォルダ
    candidates.push(path.join(path.dirname(process.execPath), "data"));
  }
  try {
    candidates.push(path.join(app.getPath("userData")));
  } catch (err) {
    console.error("[data] userData の取得失敗:", err);
  }
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, ".write-probe");
      fs.writeFileSync(probe, "");
      fs.rmSync(probe, { force: true });
      dataDirCache = dir;
      return dir;
    } catch (err) {
      console.warn("[data] 書き込み不可のため次の候補へ:", dir, err?.message);
    }
  }
  dataDirCache = candidates[candidates.length - 1] || null;
  return dataDirCache;
}

/**
 * ユーザー設定の場所（ポータブル版前提: `<exe>/data/config.yaml`、
 * 開発時・書き込み不可時は `app.getPath('userData')/config.yaml`）。
 * 存在しない場合は同梱の既定ファイルをコピーして生成する。
 */
function ensureUserConfig() {
  let userPath = null;
  try {
    const dir = resolveDataDir();
    if (!dir) return null;
    userPath = path.join(dir, "config.yaml");
  } catch (err) {
    console.error("[config] data ディレクトリの取得失敗:", err);
    return null;
  }
  try {
    if (!fs.existsSync(userPath)) {
      const bundled = findBundledConfig();
      if (!bundled) return null;
      fs.mkdirSync(path.dirname(userPath), { recursive: true });
      fs.copyFileSync(bundled, userPath);
      console.log("[config] 既定の config.yaml を生成:", userPath);
    }
    return fs.existsSync(userPath) ? userPath : null;
  } catch (err) {
    console.error("[config] config.yaml の生成失敗:", err);
    return fs.existsSync(userPath) ? userPath : null;
  }
}

/** 起動直後のウィンドウ背景色。読み込みは main プロセスで行う（仕様書 2.1）。 */
function windowBackgroundColor() {
  try {
    const p = ensureUserConfig();
    if (p) {
      const yaml = require("js-yaml");
      const doc = yaml.load(fs.readFileSync(p, "utf8"));
      const bg = doc && doc.theme && doc.theme.background;
      if (typeof bg === "string" && /^#[0-9a-fA-F]{6}$/.test(bg)) return bg;
    }
  } catch (err) {
    console.error("[config] 背景色の取得失敗:", err);
  }
  return DEFAULT_WINDOW_BACKGROUND;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  return win;
}

/* ---------------- IPC: config.yaml ---------------- */

ipcMain.handle("config:load", () => {
  const p = ensureUserConfig();
  if (!p) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch (err) {
    console.error("[config] 読み込み失敗:", err);
    return null;
  }
});

ipcMain.handle("config:path", () => ensureUserConfig());

/* ---------------- IPC: ファイル読み込み ---------------- */

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

ipcMain.handle("image:open", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "画像を開く",
    properties: ["openFile"],
    filters: [
      { name: "画像ファイル", extensions: IMAGE_EXTENSIONS },
      { name: "すべてのファイル", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase() || "png";
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/png";
    return {
      path: filePath,
      name: path.basename(filePath),
      dataUrl: `data:${mime};base64,${data.toString("base64")}`,
    };
  } catch (err) {
    console.error("[image] 読み込み失敗:", err);
    return null;
  }
});

/* ---------------- IPC: ファイル保存 ---------------- */

ipcMain.handle("image:save", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const defaultName = payload?.defaultName || "image.png";
  const dataUrl = payload?.dataUrl || "";
  const result = await dialog.showSaveDialog(win, {
    title: "名前を付けて保存",
    defaultPath: defaultName,
    filters: [
      { name: "画像ファイル", extensions: IMAGE_EXTENSIONS },
      { name: "すべてのファイル", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("dataUrl 形式が不正です");
    fs.writeFileSync(result.filePath, Buffer.from(match[1], "base64"));
    return { canceled: false, path: result.filePath };
  } catch (err) {
    console.error("[image] 保存失敗:", err);
    dialog.showErrorBox("保存に失敗しました", String(err?.message || err));
    return { canceled: true };
  }
});

/* ---------------- IPC: 任意ファイルの dataUrl 読み込み ---------------- */

ipcMain.handle("file:read-data-url", (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath) return null;
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch (err) {
    console.error("[file] 読み込み失敗:", err);
    return null;
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
