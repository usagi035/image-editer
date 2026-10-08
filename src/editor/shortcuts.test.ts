import { describe, expect, it } from "vitest";
import { isTypingTarget, matchesShortcut, parseShortcut } from "./shortcuts";

/** KeyboardEvent を模したプレーンオブジェクト（node 環境のため DOM 非依存） */
function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as unknown as KeyboardEvent;
}

describe("parseShortcut", () => {
  it("修飾キーと本体を分解する", () => {
    expect(parseShortcut("Ctrl+S")).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
      key: "s",
    });
  });

  it("Plus / Minus / Space は記号へ正規化", () => {
    expect(parseShortcut("Ctrl+Plus").key).toBe("+");
    expect(parseShortcut("Ctrl+Minus").key).toBe("-");
    expect(parseShortcut("Space").key).toBe(" ");
  });

  it("Meta/Cmd は同義として扱う", () => {
    expect(parseShortcut("Cmd+C").meta).toBe(true);
    expect(parseShortcut("Meta+C").meta).toBe(true);
  });
});

describe("matchesShortcut", () => {
  it("Ctrl+S に一致する", () => {
    expect(matchesShortcut(key({ key: "s", ctrlKey: true }), "Ctrl+S")).toBe(true);
    expect(matchesShortcut(key({ key: "s" }), "Ctrl+S")).toBe(false);
    expect(matchesShortcut(key({ key: "s", ctrlKey: true }), "Ctrl+D")).toBe(false);
  });

  it("単体キーは修飾キーなしで一致", () => {
    expect(matchesShortcut(key({ key: "g" }), "G")).toBe(true);
    expect(matchesShortcut(key({ key: "g", ctrlKey: true }), "G")).toBe(false);
  });

  it("Ctrl++ は '+' と '=' の両方に対応", () => {
    expect(matchesShortcut(key({ key: "+", ctrlKey: true }), "Ctrl+Plus")).toBe(true);
    expect(matchesShortcut(key({ key: "=", ctrlKey: true }), "Ctrl+Plus")).toBe(true);
  });

  it("Mac では Ctrl を Cmd でも代用できる", () => {
    expect(matchesShortcut(key({ key: "s", metaKey: true }), "Ctrl+S")).toBe(true);
  });

  it("未定義のショートカットは常に false", () => {
    expect(matchesShortcut(key({ key: "s" }), undefined)).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("入力系要素はショートカット対象外", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);
    expect(
      isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)
    ).toBe(true);
  });

  it("通常要素と null は対象", () => {
    expect(isTypingTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
