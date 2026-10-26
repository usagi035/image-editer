/**
 * Undo / Redo エンジン（改訂版仕様書 4.6）。
 *
 * - 差分(パッチ)方式: 「変更範囲の外接矩形」「変更前ピクセル」「変更後ピクセル」を1操作ごとに保存
 * - ストロークは drawTools の touched Map から 1 ステップ分のパッチを直接構築する
 * - 上限: history.max_steps かつ合計 ≤ history.max_memory_mb（超過時は古い順に破棄）
 * - 1 ステップ単独で上限を超える操作は保存しない（呼び出し側が事前確認する）
 * - ピクセルへは HistoryHost 経由でのみアクセスする（本番=レイヤー Canvas / テスト=配列）
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StructureMeta {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
}

/** ドキュメント構造のスナップショット（メタデータのみ・ピクセルは含まない） */
export interface StructureSnapshot {
  width: number;
  height: number;
  activeLayerId: string;
  layers: StructureMeta[];
}

/** レイヤー 1 枚の完全な内容（構造変更の Undo/Redo で再生成する際に使用） */
export interface LayerContent {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  width: number;
  height: number;
  /** RGBA バイト列（幅×高さ×4） */
  pixels: Uint8ClampedArray;
}

export interface PixelPatch {
  layerId: string;
  rect: Rect;
  /** 変更前ピクセル（RGBA・rect.w×rect.h×4） */
  before: Uint8ClampedArray;
  /** 変更後ピクセル（RGBA・rect.w×rect.h×4） */
  after: Uint8ClampedArray;
}

export interface HistoryStep {
  label: string;
  patches: PixelPatch[];
  /** 操作で消えたレイヤーの「操作前」内容（Undo で再生成） */
  removedLayers: LayerContent[];
  /** 操作で増えたレイヤーの「操作後」内容（Redo で再生成） */
  addedLayers: LayerContent[];
  structureBefore: StructureSnapshot;
  structureAfter: StructureSnapshot;
}

/** 履歴がピクセルへアクセスする抽象（本番=レイヤー Canvas / テスト=配列） */
export interface HistoryHost {
  /** 現在のドキュメント構造（メタデータ）を取得 */
  captureMeta(): StructureSnapshot;
  /** レイヤー全体のピクセルを取得（不在なら null） */
  capturePixels(layerId: string): LayerContent | null;
  /** rect 範囲のピクセルを取得（範囲外・不在なら null） */
  captureRect(layerId: string, rect: Rect): Uint8ClampedArray | null;
  /** rect 範囲へピクセルを書き戻す */
  applyRect(layerId: string, rect: Rect, data: Uint8ClampedArray): void;
  /**
   * layers 配列を snapshot に一致させる。contentById に含まれる id は画素ごと再生成し、
   * それ以外は既存レイヤーを再利用する（サイズ不一致時は縮小/拡大して維持）。
   */
  applyDocument(
    snapshot: StructureSnapshot,
    contentById: Map<string, LayerContent>
  ): void;
}

interface PendingStep {
  label: string;
  captures: Array<{ key: string; layerId: string; rect: Rect; before: Uint8ClampedArray }>;
  structureBefore: StructureSnapshot;
  removed: Map<string, LayerContent>;
  added: Map<string, LayerContent>;
}

const MB = 1024 * 1024;

/**
 * before/after を比較して「実際に変化したピクセルの外接矩形」を返す。
 * 変化が無ければ null（w×h は before/after の行幅）。
 */
function diffRect(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  w: number,
  h: number
): Rect | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (
        before[o] === after[o] &&
        before[o + 1] === after[o + 1] &&
        before[o + 2] === after[o + 2] &&
        before[o + 3] === after[o + 3]
      ) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 縦横 rowW のバイト列から sub 矩形だけを切り出す */
function sliceRect(
  data: Uint8ClampedArray,
  rowW: number,
  sub: Rect
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sub.w * sub.h * 4);
  for (let y = 0; y < sub.h; y++) {
    const src = ((sub.y + y) * rowW + sub.x) * 4;
    out.set(data.subarray(src, src + sub.w * 4), y * sub.w * 4);
  }
  return out;
}

function structureEquals(a: StructureSnapshot, b: StructureSnapshot): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.activeLayerId !== b.activeLayerId) return false;
  if (a.layers.length !== b.layers.length) return false;
  for (let i = 0; i < a.layers.length; i++) {
    const x = a.layers[i];
    const y = b.layers[i];
    if (x.id !== y.id || x.name !== y.name || x.visible !== y.visible || x.opacity !== y.opacity) {
      return false;
    }
  }
  return true;
}

function stepBytes(step: HistoryStep): number {
  let total = 0;
  for (const p of step.patches) total += p.before.length + p.after.length;
  for (const c of [...step.removedLayers, ...step.addedLayers]) {
    total += c.pixels.length;
  }
  return total;
}

export class HistoryEngine {
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private pending: PendingStep | null = null;
  private maxSteps: number;
  private maxMemoryBytes: number;

  constructor(
    private host: HistoryHost,
    limits?: { maxSteps?: number; maxMemoryMb?: number }
  ) {
    this.maxSteps = Math.max(1, limits?.maxSteps ?? 100);
    this.maxMemoryBytes = Math.max(0, limits?.maxMemoryMb ?? 512) * MB;
  }

  setLimits(limits: { maxSteps?: number; maxMemoryMb?: number }): void {
    if (limits.maxSteps !== undefined) this.maxSteps = Math.max(1, limits.maxSteps);
    if (limits.maxMemoryMb !== undefined) {
      this.maxMemoryBytes = Math.max(0, limits.maxMemoryMb) * MB;
    }
    this.evict();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get usedBytes(): number {
    let total = 0;
    for (const s of this.undoStack) total += stepBytes(s);
    for (const s of this.redoStack) total += stepBytes(s);
    return total;
  }

  /** 新しいステップを開始する（実行中のステップは破棄） */
  beginStep(label: string): void {
    this.pending = {
      label,
      captures: [],
      structureBefore: this.host.captureMeta(),
      removed: new Map(),
      added: new Map(),
    };
  }

  /** 変更前の rect 範囲を記録（同一範囲は最初の 1 回のみ・矩形はホスト側でクランプ） */
  captureBefore(layerId: string, rect: Rect): void {
    const p = this.pending;
    if (!p) return;
    const before = this.host.captureRect(layerId, rect);
    if (!before) return;
    const key = `${layerId}:${rect.x},${rect.y},${rect.w},${rect.h}`;
    if (p.captures.some((c) => c.key === key)) return;
    p.captures.push({ key, layerId, rect, before });
  }

  /** 変更前のレイヤー全体を記録（バケツ/色調整等の全域操作用） */
  captureLayerBefore(layerId: string): void {
    const content = this.host.capturePixels(layerId);
    if (!content) return;
    this.captureBefore(layerId, { x: 0, y: 0, w: content.width, h: content.height });
  }

  /** 操作で消えるレイヤーの内容を記録（Undo で再生成） */
  noteRemovedLayer(layerId: string): void {
    const p = this.pending;
    if (!p) return;
    const content = this.host.capturePixels(layerId);
    if (content) p.removed.set(layerId, content);
  }

  /** 操作で増えたレイヤーの内容を記録（Redo で再生成） */
  noteAddedLayer(layerId: string): void {
    const p = this.pending;
    if (!p) return;
    const content = this.host.capturePixels(layerId);
    if (content) p.added.set(layerId, content);
  }

  /** 実行中のステップを確定する。変化が無かった場合はステップを成立させない */
  commitStep(): HistoryStep | null {
    const p = this.pending;
    this.pending = null;
    if (!p) return null;
    const structureAfter = this.host.captureMeta();
    const patches: PixelPatch[] = [];
    for (const c of p.captures) {
      const after = this.host.captureRect(c.layerId, c.rect);
      if (!after || after.length !== c.before.length) continue;
      // 実際に変化した範囲だけを残す（変化が無ければステップから除外）
      const sub = diffRect(c.before, after, c.rect.w, c.rect.h);
      if (!sub) continue;
      patches.push({
        layerId: c.layerId,
        rect: { x: c.rect.x + sub.x, y: c.rect.y + sub.y, w: sub.w, h: sub.h },
        before: sliceRect(c.before, c.rect.w, sub),
        after: sliceRect(after, c.rect.w, sub),
      });
    }
    const structureChanged = !structureEquals(p.structureBefore, structureAfter);
    if (
      patches.length === 0 &&
      !structureChanged &&
      p.removed.size === 0 &&
      p.added.size === 0
    ) {
      return null;
    }
    return this.pushStep({
      label: p.label,
      patches,
      removedLayers: [...p.removed.values()],
      addedLayers: [...p.added.values()],
      structureBefore: p.structureBefore,
      structureAfter,
    });
  }

  /**
   * ストローク 1 本を 1 ステップとして確定する。
   * touched: index → 変更前の Uint32 値（drawTools の StrokeSession.touched）
   * pixels: 現在のレイヤー全体（Uint32View・ストローク後の値）
   */
  commitStroke(
    layerId: string,
    touched: Map<number, number>,
    width: number,
    height: number,
    pixels: Uint32Array
  ): HistoryStep | null {
    const p = this.pending;
    this.pending = null;
    if (!p || touched.size === 0) return null;
    // 変化したピクセルだけを外接矩形化する（同色の押印は除外）
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (const [idx, orig] of touched) {
      if (pixels[idx] === orig) continue;
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0) return null; // 実質無変化 → ステップ不成立
    const rect: Rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const before = new Uint8ClampedArray(rect.w * rect.h * 4);
    const after = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const idx = (y + rect.y) * width + (x + rect.x);
        const cur = pixels[idx];
        const orig = touched.get(idx);
        if (orig === undefined || orig === cur) continue; // 非接触画素は両側とも現在値（=変化なし扱い）
        const off = (y * rect.w + x) * 4;
        after[off] = cur & 255;
        after[off + 1] = (cur >>> 8) & 255;
        after[off + 2] = (cur >>> 16) & 255;
        after[off + 3] = (cur >>> 24) & 255;
        before[off] = orig & 255;
        before[off + 1] = (orig >>> 8) & 255;
        before[off + 2] = (orig >>> 16) & 255;
        before[off + 3] = (orig >>> 24) & 255;
      }
    }
    return this.pushStep({
      label: p.label,
      patches: [{ layerId, rect, before, after }],
      removedLayers: [...p.removed.values()],
      addedLayers: [...p.added.values()],
      structureBefore: p.structureBefore,
      structureAfter: this.host.captureMeta(),
    });
  }

  /** 実行中のステップを破棄（変更前の状態へ戻す） */
  abortStep(): void {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    for (const c of p.captures) this.host.applyRect(c.layerId, c.rect, c.before);
  }

  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    for (const pt of step.patches) this.host.applyRect(pt.layerId, pt.rect, pt.before);
    const content = new Map(step.removedLayers.map((c) => [c.id, c] as const));
    this.host.applyDocument(step.structureBefore, content);
    this.redoStack.push(step);
    return true;
  }

  redo(): boolean {
    const step = this.redoStack.pop();
    if (!step) return false;
    const content = new Map(step.addedLayers.map((c) => [c.id, c] as const));
    this.host.applyDocument(step.structureAfter, content);
    for (const pt of step.patches) this.host.applyRect(pt.layerId, pt.rect, pt.after);
    this.undoStack.push(step);
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }

  /** ステップを積む。単独で上限超過の場合は保存せず、以後は古い順に破棄する */
  private pushStep(step: HistoryStep): HistoryStep | null {
    // 新規操作が成立した時点で Redo スタックは破棄される（仕様書 4.6）
    this.redoStack = [];
    if (stepBytes(step) > this.maxMemoryBytes) return null;
    this.undoStack.push(step);
    this.evict();
    return step;
  }

  private evict(): void {
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > this.maxSteps || this.usedBytes > this.maxMemoryBytes)
    ) {
      this.undoStack.shift();
    }
  }
}
