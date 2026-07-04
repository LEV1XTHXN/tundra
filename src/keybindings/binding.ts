/**
 * Canonical keybinding strings and the matcher shared by every keydown listener
 * in the app. A binding is a `+`-joined string with modifiers in a fixed order
 * followed by the key, e.g. `"Ctrl+Shift+K"`, `"Alt+I"`, `"F2"`.
 *
 * The key portion comes from `KeyboardEvent.code` (physical key), not `.key`, so
 * bindings are layout-independent and don't shift when Alt/Shift change the
 * produced character (Alt+I stays "Alt+I" on every keyboard layout).
 */

import type { CommandId } from "./registry";

/** Physical `event.code` values that are modifier keys themselves — a keydown
 *  for one of these alone is not a binding (recording waits for a real key). */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

/** Map a physical `event.code` to the key token used in a canonical binding. */
function keyToken(code: string): string | null {
  if (MODIFIER_CODES.has(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyF -> F
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit1 -> 1
  if (/^F[0-9]{1,2}$/.test(code)) return code; // F2 -> F2
  const named: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Escape: "Escape",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Slash: "Slash",
    Backslash: "Backslash",
    Comma: "Comma",
    Period: "Period",
    Semicolon: "Semicolon",
    Quote: "Quote",
    BracketLeft: "BracketLeft",
    BracketRight: "BracketRight",
    Minus: "Minus",
    Equal: "Equal",
    Backquote: "Backquote",
  };
  return named[code] ?? code;
}

/**
 * The canonical binding for a keydown event, or `null` if it's only a modifier
 * (so callers can ignore lone Ctrl/Alt/Shift/Meta presses while recording).
 */
export function eventToBinding(e: KeyboardEvent): string | null {
  const token = keyToken(e.code);
  if (token === null) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(token);
  return parts.join("+");
}

/** True if `binding` carries a "hard" modifier (Ctrl/Alt/Meta) — Shift alone
 *  doesn't count, since Shift+letter is ordinary typing. */
function hasHardModifier(binding: string): boolean {
  return /(^|\+)(Ctrl|Alt|Meta)(\+|$)/.test(binding);
}

/** True if `binding`'s key is a function key (F1–F12) — safe to fire even while
 *  a text field is focused. */
function isFunctionKey(binding: string): boolean {
  return /(^|\+)F[0-9]{1,2}$/.test(binding);
}

/** Is the event's target a place the user is actively typing? */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

/**
 * Which command (if any) the pressed combo triggers, given the current merged
 * bindings. Returns the matching `CommandId` or `null`.
 *
 * Typing guard: a binding with no hard modifier and no function key (i.e. a bare
 * key or Shift+key) is ignored while a text field / the editor is focused, so a
 * user who rebinds something to plain "K" can't break typing.
 */
export function matchCommand(
  e: KeyboardEvent,
  bindings: Record<CommandId, string>,
): CommandId | null {
  const pressed = eventToBinding(e);
  if (pressed === null) return null;
  for (const id in bindings) {
    if (bindings[id as CommandId] !== pressed) continue;
    if (isEditableTarget(e.target) && !hasHardModifier(pressed) && !isFunctionKey(pressed)) {
      return null;
    }
    return id as CommandId;
  }
  return null;
}

/** Human-readable label for a binding, for display in the UI (e.g. Settings,
 *  the sidebar hint). Empty string renders as an em dash "unbound". */
export function formatBinding(binding: string): string {
  if (!binding) return "—";
  const pretty: Record<string, string> = {
    Meta: "Cmd",
    Escape: "Esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: "Space",
    Slash: "/",
    Backslash: "\\",
    Comma: ",",
    Period: ".",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
  };
  return binding
    .split("+")
    .map((p) => pretty[p] ?? p)
    .join(" + ");
}
