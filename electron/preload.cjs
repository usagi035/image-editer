/**
 * Electron プリロード。
 * env.d.ts の ElectronAPI と同名の API のみを window へ公開する（contextBridge）。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  loadConfig: () => ipcRenderer.invoke("config:load"),
  loadConfigPath: () => ipcRenderer.invoke("config:path"),
  openImageFile: () => ipcRenderer.invoke("image:open"),
  saveImageFile: (payload) => ipcRenderer.invoke("image:save", payload),
  readFileDataUrl: (filePath) => ipcRenderer.invoke("file:read-data-url", filePath),
});
