/** Electron プリロードが注入する API（未接続時は undefined で Web 版として動作）。 */
export interface ElectronAPI {
  loadConfig: () => Promise<string | null>;
  loadConfigPath: () => Promise<string | null>;
  openImageFile: () => Promise<{ path: string; name: string; dataUrl: string } | null>;
  saveImageFile: (payload: {
    defaultName: string;
    dataUrl: string;
  }) => Promise<{ canceled: boolean; path?: string }>;
  /** .ora プロジェクト保存（path あり=上書き・なし=名前付きダイアログ: 仕様書 5.1） */
  saveOraFile: (payload: {
    defaultName: string;
    path: string | null;
    data: Uint8Array;
  }) => Promise<{ canceled: boolean; path?: string }>;
  readFileDataUrl: (filePath: string) => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
