import { describe, expect, it } from "vitest";
import { eventToBinding, formatBinding, matchCommand } from "./binding";
import type { CommandId } from "./registry";

/** Build a minimal KeyboardEvent-like object for the fields the matcher reads. */
function key(
  code: string,
  mods: Partial<Record<"ctrl" | "alt" | "shift" | "meta", boolean>> = {},
  target: EventTarget | null = null,
): KeyboardEvent {
  return {
    code,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    metaKey: !!mods.meta,
    target,
  } as KeyboardEvent;
}

/** A fake DOM element for the typing-guard branch. */
function el(tagName: string, isContentEditable = false): EventTarget {
  return { tagName, isContentEditable } as unknown as EventTarget;
}

describe("eventToBinding", () => {
  it("uses the physical key (event.code), so it's layout-independent", () => {
    expect(eventToBinding(key("KeyF", { ctrl: true }))).toBe("Ctrl+F");
    expect(eventToBinding(key("KeyI", { alt: true }))).toBe("Alt+I");
    expect(eventToBinding(key("Digit1", { ctrl: true }))).toBe("Ctrl+1");
    expect(eventToBinding(key("F2"))).toBe("F2");
  });

  it("canonicalizes modifier order to Ctrl+Alt+Shift+Meta regardless of press order", () => {
    expect(eventToBinding(key("KeyK", { shift: true, ctrl: true }))).toBe("Ctrl+Shift+K");
    expect(eventToBinding(key("KeyN", { alt: true, ctrl: true }))).toBe("Ctrl+Alt+N");
  });

  it("returns null for a lone modifier press (recording keeps waiting)", () => {
    expect(eventToBinding(key("ControlLeft", { ctrl: true }))).toBeNull();
    expect(eventToBinding(key("AltRight", { alt: true }))).toBeNull();
  });
});

describe("matchCommand", () => {
  const bindings: Record<CommandId, string> = {
    "search.global": "F2",
    "search.inNote": "Ctrl+F",
    "inspector.toggle": "Alt+I",
    "note.new": "Ctrl+Alt+N",
    "link.create": "Ctrl+Shift+K",
  };

  it("resolves a combo to its command id", () => {
    expect(matchCommand(key("F2"), bindings)).toBe("search.global");
    expect(matchCommand(key("KeyF", { ctrl: true }), bindings)).toBe("search.inNote");
    expect(matchCommand(key("KeyI", { alt: true }), bindings)).toBe("inspector.toggle");
  });

  it("returns null for an unbound combo", () => {
    expect(matchCommand(key("KeyZ", { ctrl: true }), bindings)).toBeNull();
  });

  it("typing guard: a bare-key binding is ignored while a text field is focused", () => {
    const bare: Record<CommandId, string> = { ...bindings, "search.global": "K" };
    expect(matchCommand(key("KeyK", {}, el("INPUT")), bare)).toBeNull();
    // …but fires when focus isn't in an editable target.
    expect(matchCommand(key("KeyK"), bare)).toBe("search.global");
  });

  it("typing guard exempts hard modifiers and function keys even inside inputs", () => {
    expect(matchCommand(key("KeyF", { ctrl: true }, el("INPUT")), bindings)).toBe("search.inNote");
    expect(matchCommand(key("F2", {}, el("TEXTAREA")), bindings)).toBe("search.global");
    // contentEditable (the editor) is treated as a text field for the guard.
    const bare: Record<CommandId, string> = { ...bindings, "search.global": "K" };
    expect(matchCommand(key("KeyK", {}, el("DIV", true)), bare)).toBeNull();
  });
});

describe("formatBinding", () => {
  it("prettifies tokens for display", () => {
    expect(formatBinding("Ctrl+Shift+K")).toBe("Ctrl + Shift + K");
    expect(formatBinding("Alt+I")).toBe("Alt + I");
    expect(formatBinding("Meta+Escape")).toBe("Cmd + Esc");
    expect(formatBinding("")).toBe("—");
  });
});
