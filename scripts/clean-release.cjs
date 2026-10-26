#!/usr/bin/env node
/**
 * release/ の整理（ポータブル版前提: 配布物は portable exe のみ）。
 *
 * electron-builder はビルドのついでに中間物を release/ に出します:
 *   - win-unpacked/   … フォルダ版＝全ターゲット共通の中間出力（DLL 羅列の原因）
 *   - .icon-ico/      … アイコン変換キャッシュ
 *   - builder-debug.yml … electron-builder のデバッグログ
 *   - *.nsis.7z / *.blockmap / latest.yml / 旧インストーラ等
 *
 * このスクリプトは **ホワイトリスト方式**で、配布物だけを残して他を削除します:
 *   - KEEP: `ImageEditor-Portable-*.exe`（単一 portable exe）
 *   - KEEP（--keep-folder 指定時のみ）: `win-unpacked/`（フォルダ版）
 *
 * 使い方:
 *   npm run clean:release                # portable exe 以外を削除
 *   npm run build:exe -- --keep-folder   # ビルド後に win-unpacked を残す
 *
 * 今后 zip 等の成果物を追加したときは、下の isKeep() に条件を足すこと。
 */
const fs = require("fs");
const path = require("path");

const releaseDir = path.join(__dirname, "..", "release");
const keepFolder = process.argv.includes("--keep-folder");

/** 配布物として残す条件（ホワイトリスト） */
function isKeep(name) {
  if (/^ImageEditor-Portable-.*\.exe$/i.test(name)) return true; // 単一 portable exe
  if (keepFolder && name === "win-unpacked") return true; // フォルダ版（明示指定時のみ）
  return false;
}

if (!fs.existsSync(releaseDir)) {
  console.log("[clean] release/ が存在しません（何もしない）");
  process.exit(0);
}

let removed = 0;
for (const entry of fs.readdirSync(releaseDir)) {
  if (isKeep(entry)) continue;
  fs.rmSync(path.join(releaseDir, entry), { recursive: true, force: true });
  console.log("[clean] 削除:", entry);
  removed++;
}

const kept = fs.readdirSync(releaseDir);
console.log(
  `[clean] 完了（${removed} 件削除 / 残り: ${kept.join(", ") || "なし"}）`
);
