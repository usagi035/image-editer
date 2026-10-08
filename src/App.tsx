import CanvasViewport from "./components/CanvasViewport";
import HeaderBar from "./components/HeaderBar";
import InspectorPanel from "./components/InspectorPanel";
import NotifyHost from "./components/NotifyHost";
import Toolbox from "./components/Toolbox";
import { EditorProvider } from "./editor/EditorContext";

/**
 * 画面レイアウト（仕様書 3. 4エリア構成）
 * 1. Header / Menu Bar
 * 2. Left Panel (Toolbox)
 * 3. Center Panel (Canvas Viewport)
 * 4. Right Panel (Inspector & Layers)
 * 通知（トースト / エラーダイアログ）は NotifyHost が最前面に描画する。
 */
export default function App() {
  return (
    <EditorProvider>
      <div className="flex h-full flex-col">
        <HeaderBar />
        <div className="flex min-h-0 flex-1">
          <Toolbox />
          <CanvasViewport />
          <InspectorPanel />
        </div>
        <NotifyHost />
      </div>
    </EditorProvider>
  );
}
