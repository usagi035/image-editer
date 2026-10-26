import { describe, expect, it } from "vitest";
import {
  HistoryEngine,
  type HistoryHost,
  type LayerContent,
  type Rect,
  type StructureSnapshot,
} from "./history";

/**
 * Undo/Redo エンジンの単体テスト（改訂版仕様書 4.6 の AC 対応）。
 * ホストは Canvas を使わない配列ベースの疑似実装（environment: node）。
 */

interface FakeLayer {
  name: string;
  visible: boolean;
  opacity: number;
  data: Uint8ClampedArray;
}

class FakeHost implements HistoryHost {
  width: number;
  height: number;
  activeLayerId = "";
  private layers = new Map<string, FakeLayer>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  addLayer(id: string, fill = 0): void {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    if (fill !== 0) data.fill(fill);
    this.layers.set(id, { name: id, visible: true, opacity: 100, data });
    this.activeLayerId = id;
  }

  layerIds(): string[] {
    return [...this.layers.keys()];
  }

  meta(id: string): FakeLayer {
    const l = this.layers.get(id);
    if (!l) throw new Error(`no layer: ${id}`);
    return l;
  }

  setPixel(id: string, x: number, y: number, rgba: number): void {
    const l = this.meta(id);
    const off = (y * this.width + x) * 4;
    l.data[off] = rgba & 255;
    l.data[off + 1] = (rgba >>> 8) & 255;
    l.data[off + 2] = (rgba >>> 16) & 255;
    l.data[off + 3] = (rgba >>> 24) & 255;
  }

  pixel(id: string, x: number, y: number): number {
    const l = this.meta(id);
    const off = (y * this.width + x) * 4;
    return (
      (l.data[off] |
        (l.data[off + 1] << 8) |
        (l.data[off + 2] << 16) |
        (l.data[off + 3] << 24)) >>>
      0
    );
  }

  pixelsOf(id: string): number[] {
    const l = this.meta(id);
    const out: number[] = [];
    for (let i = 0; i < this.width * this.height; i++) {
      const off = i * 4;
      out.push(
        (l.data[off] | (l.data[off + 1] << 8) | (l.data[off + 2] << 16) | (l.data[off + 3] << 24)) >>> 0
      );
    }
    return out;
  }

  captureMeta(): StructureSnapshot {
    return {
      width: this.width,
      height: this.height,
      activeLayerId: this.activeLayerId,
      layers: [...this.layers.entries()].map(([id, l]) => ({
        id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
      })),
    };
  }

  capturePixels(layerId: string): LayerContent | null {
    const l = this.layers.get(layerId);
    if (!l) return null;
    return {
      id: layerId,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      width: this.width,
      height: this.height,
      pixels: l.data.slice(),
    };
  }

  captureRect(layerId: string, rect: Rect): Uint8ClampedArray | null {
    const l = this.layers.get(layerId);
    if (!l) return null;
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const w = Math.min(this.width, rect.x + rect.w) - x;
    const h = Math.min(this.height, rect.y + rect.h) - y;
    if (w <= 0 || h <= 0) return null;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const src = ((y + row) * this.width + x) * 4;
      out.set(l.data.subarray(src, src + w * 4), row * w * 4);
    }
    return out;
  }

  applyRect(layerId: string, rect: Rect, data: Uint8ClampedArray): void {
    const l = this.layers.get(layerId);
    if (!l) return;
    const w = Math.min(rect.w, this.width - rect.x);
    const h = Math.min(rect.h, this.height - rect.y);
    for (let row = 0; row < h; row++) {
      const dst = ((rect.y + row) * this.width + rect.x) * 4;
      l.data.set(data.subarray(row * rect.w * 4, row * rect.w * 4 + w * 4), dst);
    }
  }

  applyDocument(snapshot: StructureSnapshot, contentById: Map<string, LayerContent>): void {
    const next = new Map<string, FakeLayer>();
    for (const meta of snapshot.layers) {
      const existing = this.layers.get(meta.id);
      const content = contentById.get(meta.id);
      const size = snapshot.width * snapshot.height * 4;
      let data: Uint8ClampedArray;
      if (content && content.width === snapshot.width && content.height === snapshot.height) {
        data = content.pixels.slice();
      } else if (existing && existing.data.length === size) {
        data = existing.data;
      } else {
        data = new Uint8ClampedArray(size);
      }
      next.set(meta.id, { name: meta.name, visible: meta.visible, opacity: meta.opacity, data });
    }
    this.layers = next;
    this.width = snapshot.width;
    this.height = snapshot.height;
    this.activeLayerId = snapshot.activeLayerId;
  }
}

/** ペン相当の編集（drawTools の touched Map 方式を再現して commitStroke する） */
function stroke(
  host: FakeHost,
  engine: HistoryEngine,
  layerId: string,
  edits: Array<[number, number, number]>,
  label = "ストローク"
): void {
  engine.beginStep(label);
  const touched = new Map<number, number>();
  for (const [x, y, color] of edits) {
    const idx = y * host.width + x;
    if (!touched.has(idx)) touched.set(idx, host.pixel(layerId, x, y));
    host.setPixel(layerId, x, y, color);
  }
  const l = host.meta(layerId);
  const pixels = new Uint32Array(l.data.buffer, l.data.byteOffset, l.data.byteLength / 4);
  engine.commitStroke(layerId, touched, host.width, host.height, pixels);
}

function makeDoc(w = 8, h = 8): { host: FakeHost; engine: HistoryEngine } {
  const host = new FakeHost(w, h);
  host.addLayer("a");
  const engine = new HistoryEngine(host, { maxSteps: 100, maxMemoryMb: 512 });
  return { host, engine };
}

const RED = 0xff0000ff;
const BLUE = 0xffff0000;
const GREEN = 0xff00ff00;

describe("HistoryEngine — パッチ方式の基本（仕様書 4.6）", () => {
  it("編集 → Undo で初期状態とピクセル単位で一致し、Redo で再現する", () => {
    const { host, engine } = makeDoc();
    const initial = host.pixelsOf("a");
    stroke(host, engine, "a", [[1, 1, RED], [2, 1, RED]]);
    const after = host.pixelsOf("a");
    expect(host.pixel("a", 1, 1)).toBe(RED);
    expect(engine.canUndo).toBe(true);

    expect(engine.undo()).toBe(true);
    expect(host.pixelsOf("a")).toEqual(initial);
    expect(engine.canRedo).toBe(true);

    expect(engine.redo()).toBe(true);
    expect(host.pixelsOf("a")).toEqual(after);
  });

  it("10 回描画して 10 回 Undo すると初期状態とピクセル単位で一致する（AC）", () => {
    const { host, engine } = makeDoc();
    const initial = host.pixelsOf("a");
    for (let i = 0; i < 10; i++) {
      stroke(host, engine, "a", [[i, 0, RED], [i, 1, BLUE]]);
    }
    for (let i = 0; i < 10; i++) expect(engine.undo()).toBe(true);
    expect(engine.canUndo).toBe(false);
    expect(host.pixelsOf("a")).toEqual(initial);
  });

  it("Undo 後に新しい描画を行うと Redo できない（AC）", () => {
    const { host, engine } = makeDoc();
    stroke(host, engine, "a", [[0, 0, RED]]);
    stroke(host, engine, "a", [[1, 0, BLUE]]);
    engine.undo();
    expect(engine.canRedo).toBe(true);
    stroke(host, engine, "a", [[2, 0, GREEN]]);
    expect(engine.canRedo).toBe(false);
    expect(engine.redo()).toBe(false);
  });

  it("同色のみの描画は実質無変化としてステップにならない", () => {
    const { host, engine } = makeDoc();
    stroke(host, engine, "a", [[0, 0, RED]]);
    stroke(host, engine, "a", [[0, 0, RED]]); // 同色 → ステップ不成立
    expect(engine.undo()).toBe(true); // 1 本目だけ
    expect(engine.canUndo).toBe(false);
  });

  it("パッチは変更範囲の外接矩形に限定される", () => {
    const { host, engine } = makeDoc();
    engine.beginStep("バケツ");
    engine.captureLayerBefore("a");
    host.setPixel("a", 3, 3, RED);
    host.setPixel("a", 4, 3, BLUE);
    const step = engine.commitStep();
    expect(step).not.toBeNull();
    expect(step!.patches).toHaveLength(1);
    expect(step!.patches[0].rect).toEqual({ x: 3, y: 3, w: 2, h: 1 });
  });

  it("実行中ステップを abortStep で破棄すると元の状態に戻る", () => {
    const { host, engine } = makeDoc();
    const initial = host.pixelsOf("a");
    engine.beginStep("テスト");
    engine.captureLayerBefore("a");
    host.setPixel("a", 0, 0, RED);
    engine.abortStep();
    expect(host.pixelsOf("a")).toEqual(initial);
    expect(engine.canUndo).toBe(false);
  });
});

describe("HistoryEngine — レイヤー構造の履歴（仕様書 4.5/4.6）", () => {
  it("レイヤー追加は 1 ステップで Undo/Redo できる", () => {
    const { host, engine } = makeDoc();
    engine.beginStep("レイヤー追加");
    host.addLayer("b");
    engine.noteAddedLayer("b");
    engine.commitStep();
    expect(host.layerIds()).toEqual(["a", "b"]);

    engine.undo();
    expect(host.layerIds()).toEqual(["a"]);
    engine.redo();
    expect(host.layerIds()).toEqual(["a", "b"]);
  });

  it("レイヤー削除の Undo で画素ごと復元される", () => {
    const { host, engine } = makeDoc();
    stroke(host, engine, "a", [[0, 0, RED], [1, 1, BLUE]]);
    const content = host.pixelsOf("a");

    engine.beginStep("レイヤー削除");
    engine.noteRemovedLayer("a");
    host.applyDocument(
      { width: host.width, height: host.height, activeLayerId: "a", layers: [] },
      new Map()
    );
    engine.commitStep();

    engine.undo();
    expect(host.layerIds()).toEqual(["a"]);
    expect(host.pixelsOf("a")).toEqual(content);
  });

  it("並び替え・不透明度・表示切替はメタデータのみで Undo/Redo できる", () => {
    const { host, engine } = makeDoc();
    host.addLayer("b");
    engine.beginStep("並び替え");
    const meta = host.captureMeta();
    host.applyDocument(
      { ...meta, layers: [...meta.layers].reverse() },
      new Map()
    );
    engine.commitStep();
    expect(host.layerIds()).toEqual(["b", "a"]);

    engine.beginStep("不透明度");
    const m2 = host.captureMeta();
    host.applyDocument({ ...m2, layers: m2.layers.map((l) => (l.id === "b" ? { ...l, opacity: 50 } : l)) }, new Map());
    engine.commitStep();

    engine.undo();
    expect(host.meta("b").opacity).toBe(100);
    engine.undo();
    expect(host.layerIds()).toEqual(["a", "b"]);
  });

  it("下層レイヤーへの統合（mergeDown）は 1 ステップで戻る", () => {
    const { host, engine } = makeDoc();
    host.addLayer("b");
    stroke(host, engine, "b", [[0, 0, RED]]);
    const beforeA = host.pixelsOf("a");

    engine.beginStep("レイヤー統合");
    engine.noteRemovedLayer("b");
    engine.captureLayerBefore("a");
    host.setPixel("a", 0, 0, RED); // drawImage 相当
    host.applyDocument(
      { width: host.width, height: host.height, activeLayerId: "a", layers: [{ id: "a", name: "a", visible: true, opacity: 100 }] },
      new Map()
    );
    engine.commitStep();
    expect(host.layerIds()).toEqual(["a"]);

    engine.undo();
    expect(host.layerIds()).toEqual(["a", "b"]);
    expect(host.pixelsOf("a")).toEqual(beforeA);
    expect(host.pixel("b", 0, 0)).toBe(RED);
  });

  it("ドキュメントサイズ変更（リサイズ相当）は 1 ステップで Undo/Redo できる", () => {
    const host = new FakeHost(8, 8);
    host.addLayer("a");
    const engine = new HistoryEngine(host);
    host.setPixel("a", 0, 0, RED);

    engine.beginStep("リサイズ");
    engine.noteRemovedLayer("a");
    // 16x16 へ拡大（内容を維持したリサイズ相当）
    const big = new Uint8ClampedArray(16 * 16 * 4);
    big.set(host.meta("a").data);
    host.applyDocument(
      { width: 16, height: 16, activeLayerId: "a", layers: [{ id: "a", name: "a", visible: true, opacity: 100 }] },
      new Map([["a", { id: "a", name: "a", visible: true, opacity: 100, width: 16, height: 16, pixels: big }]])
    );
    engine.noteAddedLayer("a");
    engine.commitStep();
    expect(host.width).toBe(16);

    engine.undo();
    expect(host.width).toBe(8);
    expect(host.pixel("a", 0, 0)).toBe(RED);

    engine.redo();
    expect(host.width).toBe(16);
    expect(host.pixel("a", 0, 0)).toBe(RED);
  });
});

describe("HistoryEngine — 上限管理（仕様書 4.6）", () => {
  it("max_steps を超えると古いステップから破棄される", () => {
    const host = new FakeHost(8, 8);
    host.addLayer("a");
    const engine = new HistoryEngine(host, { maxSteps: 3 });
    for (let i = 0; i < 5; i++) stroke(host, engine, "a", [[i, 0, RED]]);
    let undos = 0;
    while (engine.undo()) undos++;
    expect(undos).toBe(3);
  });

  it("履歴が max_memory_mb を超えても古いステップから破棄され、アプリは落ちない（AC）", () => {
    const host = new FakeHost(8, 8);
    host.addLayer("a");
    // 1 ステップ = 1px 編集で before+after = 8B → 0.00004MB(≈42B) で最大 5 ステップ保持
    const engine = new HistoryEngine(host, { maxSteps: 100, maxMemoryMb: 0.00004 });
    for (let i = 0; i < 6; i++) stroke(host, engine, "a", [[i % 8, (i / 8) | 0, RED + i]]);
    expect(engine.usedBytes).toBeLessThanOrEqual(0.00004 * 1024 * 1024);
    expect(engine.canUndo).toBe(true);
    let undos = 0;
    while (engine.undo()) undos++;
    expect(undos).toBeLessThan(6); // 古い方から破棄されている
    expect(engine.canUndo).toBe(false);
  });

  it("1 ステップ単独で上限を超える操作は保存されない", () => {
    const host = new FakeHost(32, 32); // 全域パッチ = 32*32*4*2 = 8192B
    host.addLayer("a");
    const engine = new HistoryEngine(host, { maxMemoryMb: 0.005 }); // ≈5242B
    engine.beginStep("全域操作");
    engine.captureLayerBefore("a");
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) host.setPixel("a", x, y, RED);
    expect(engine.commitStep()).toBeNull();
    expect(engine.canUndo).toBe(false);
    // 確認を受けて実行した巨大操作は保存されなくても、新規操作として Redo は破棄される
    stroke(host, engine, "a", [[1, 1, BLUE]]); // 小さなステップを成立させる
    engine.undo(); // redo を立てる
    expect(engine.canRedo).toBe(true);
    engine.beginStep("全域操作(上限超過)");
    engine.captureLayerBefore("a");
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) host.setPixel("a", x, y, GREEN);
    expect(engine.commitStep()).toBeNull(); // 単独で上限超過 → 保存されない
    expect(engine.canUndo).toBe(false);
    expect(engine.canRedo).toBe(false); // 新規操作で Redo スタックは破棄
  });

  it("clear() で履歴が消える", () => {
    const { host, engine } = makeDoc();
    stroke(host, engine, "a", [[0, 0, RED]]);
    engine.clear();
    expect(engine.canUndo).toBe(false);
    expect(engine.canRedo).toBe(false);
    expect(engine.usedBytes).toBe(0);
  });
});

describe("HistoryEngine — 4096x4096 の動作確認（仕様書 8: MS5 完了条件）", () => {
  it("4096x4096 へのストロークは変更範囲のみの小さなパッチで Undo/Redo できる", () => {
    const host = new FakeHost(4096, 4096);
    host.addLayer("a");
    const engine = new HistoryEngine(host, { maxSteps: 100, maxMemoryMb: 512 });
    stroke(host, engine, "a", [[100, 100, RED], [101, 100, RED], [102, 100, RED]]);
    expect(host.pixel("a", 100, 100)).toBe(RED);
    // パッチは 3px の外接矩形のみ（レイヤー全体 64MB は保存しない）
    expect(engine.usedBytes).toBeLessThan(1024);
    engine.undo();
    expect(host.pixel("a", 100, 100)).toBe(0);
    engine.redo();
    expect(host.pixel("a", 100, 100)).toBe(RED);
  });

  it("4096x4096 への全域操作でも実変更範囲のみをパッチとして保存する", () => {
    const host = new FakeHost(4096, 4096);
    host.addLayer("a");
    const engine = new HistoryEngine(host, { maxMemoryMb: 512 });
    engine.beginStep("バケツ");
    engine.captureLayerBefore("a"); // 変更前の全体を一時保持（64MB）
    host.setPixel("a", 2048, 2048, RED); // 実変化は 1px のみ
    const step = engine.commitStep();
    expect(step).not.toBeNull();
    // 保存されるのは変化した 1px のみ（メモリ上限内で大画像操作も安全）
    expect(engine.usedBytes).toBeLessThan(1024);
    expect(step!.patches[0].rect).toEqual({ x: 2048, y: 2048, w: 1, h: 1 });
    engine.undo();
    expect(host.pixel("a", 2048, 2048)).toBe(0);
    expect(engine.canRedo).toBe(true); // ステップは Redo 側へ移動（消去ではない）
  });
});
