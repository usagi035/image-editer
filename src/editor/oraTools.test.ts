import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildStackXml,
  ORA_MIME,
  parseStackXml,
  packOra,
} from "./oraTools";

/**
 * .ora 入出力（仕様書 5.1）の純関数テスト。
 * - buildStackXml / parseStackXml の roundtrip（エスケープ・opacity 0-1 変換・visibility）
 * - packOra の zip 構成（mimetype 先頭・非圧縮 / stack.xml / data/*.png / mergedimage.png）
 * Canvas 必須の encodeOra / decodeOra はブラウザ検証で確認（vitest environment は node）。
 */

const pngStub = (tag: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, tag]);

describe("buildStackXml / parseStackXml", () => {
  it("roundtrip: サイズ・レイヤー順・名前・不透明度・可視性が復元される", () => {
    const xml = buildStackXml(256, 128, "my-project", [
      { name: "上層", src: "data/0.png", opacity: 50, visible: true },
      { name: "下層", src: "data/1.png", opacity: 100, visible: false },
    ]);
    const info = parseStackXml(xml);
    expect(info.width).toBe(256);
    expect(info.height).toBe(128);
    expect(info.layers).toHaveLength(2);
    // ORA 順（先頭 = 最前面）が維持される
    expect(info.layers[0]).toMatchObject({
      name: "上層",
      src: "data/0.png",
      opacity: 50,
      visible: true,
      x: 0,
      y: 0,
    });
    expect(info.layers[1]).toMatchObject({
      name: "下層",
      src: "data/1.png",
      opacity: 100,
      visible: false,
    });
  });

  it("opacity は 0-1（XML）と 0-100（エディタ）を往復する", () => {
    const xml = buildStackXml(64, 64, "p", [
      { name: "L", src: "data/0.png", opacity: 75, visible: true },
    ]);
    expect(xml).toContain('opacity="0.75"');
    expect(parseStackXml(xml).layers[0].opacity).toBe(75);
  });

  it("名前の XML 特殊文字はエスケープされ復元される", () => {
    const tricky = `a&b<c>d"e'f`;
    const xml = buildStackXml(8, 8, tricky, [
      { name: tricky, src: "data/0.png", opacity: 100, visible: true },
    ]);
    expect(xml).toContain("a&amp;b&lt;c&gt;d&quot;e&apos;f");
    const info = parseStackXml(xml);
    expect(info.layers[0].name).toBe(tricky);
  });

  it("src の無い layer はスキップし、レイヤー0件はエラー", () => {
    const xml =
      `<image w="4" h="4"><stack>` +
      `<layer name="_paint" x="0" y="0"/>` +
      `<layer name="L" src="data/0.png"/>` +
      `</stack></image>`;
    expect(parseStackXml(xml).layers).toHaveLength(1);
    expect(() =>
      parseStackXml(`<image w="4" h="4"><stack></stack></image>`)
    ).toThrow(/レイヤーがありません/);
  });

  it("サイズ不正・<image> 欠落はエラー", () => {
    expect(() => parseStackXml(`<stack></stack>`)).toThrow(/<image>/);
    expect(() => parseStackXml(`<image w="0" h="4"><stack><layer src="a.png"/></stack></image>`)).toThrow(
      /サイズが不正/
    );
  });

  it("visibility 省略は visible として扱う", () => {
    const xml = `<image w="4" h="4"><stack><layer name="L" src="data/0.png"/></stack></image>`;
    expect(parseStackXml(xml).layers[0].visible).toBe(true);
  });
});

describe("packOra", () => {
  it("zip 構成: mimetype 先頭・stack.xml・data/0.png・mergedimage.png を含む", async () => {
    const layerPngs = [pngStub(0), pngStub(1)];
    const mergedPng = pngStub(9);
    const stackXml = buildStackXml(16, 16, "p", [
      { name: "上", src: "data/0.png", opacity: 100, visible: true },
      { name: "下", src: "data/1.png", opacity: 100, visible: true },
    ]);
    const bytes = await packOra({ stackXml, layerPngs, mergedPng });

    // 先頭エントリが mimetype（ORA 仕様: 非圧縮で先頭に置く）
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("PK\x03\x04");
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["mimetype", "stack.xml", "mergedimage.png", "data/0.png", "data/1.png"])
    );
    expect(new TextDecoder().decode(files.mimetype)).toBe(ORA_MIME);
    expect(new TextDecoder().decode(files["stack.xml"])).toBe(stackXml);
    expect(Array.from(files["data/0.png"])).toEqual([0x89, 0x50, 0x4e, 0x47, 0]);
    expect(Array.from(files["mergedimage.png"])).toEqual([0x89, 0x50, 0x4e, 0x47, 9]);

    // mimetype が zip 先頭（非圧縮・ORA 読み取り互換）
    // local file header = 30 bytes 固定長 + ファイル名 "mimetype"（8 bytes）→ データは 38 byte 番地
    const decoder = new TextDecoder();
    expect(decoder.decode(bytes.slice(38, 38 + ORA_MIME.length))).toBe(ORA_MIME);
  });
});
