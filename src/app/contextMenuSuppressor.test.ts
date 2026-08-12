// @vitest-environment jsdom
/**
 * The suppressor's contract is entirely about *ordering*, so that's what these
 * pin down: it must cancel the native menu everywhere, without the app's own
 * right-click menus ever seeing an already-cancelled event — `useEditorContextMenus`
 * reads `defaultPrevented` to decide whether a nearer handler (the misspelling
 * menu) already claimed the click, and would stop opening the format menu if the
 * suppressor set that flag first.
 */
import { afterEach, describe, expect, it } from "vitest";
import { installContextMenuSuppressor } from "./contextMenuSuppressor";

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = "";
});

/** A right-click on `target`; returns false when the default menu was cancelled. */
function rightClick(target: HTMLElement, shiftKey = false): boolean {
  return target.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, shiftKey }),
  );
}

describe("installContextMenuSuppressor", () => {
  it("cancels the native menu for a right-click anywhere in the document", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    expect(rightClick(el)).toBe(true); // uninstalled: the native menu would open
    uninstall = installContextMenuSuppressor();
    expect(rightClick(el)).toBe(false);
  });

  it("lets an app menu's handler run first, still seeing an uncancelled event", () => {
    const pane = document.createElement("div");
    const inner = document.createElement("span");
    pane.appendChild(inner);
    document.body.appendChild(pane);

    uninstall = installContextMenuSuppressor();

    // Mirrors useEditorContextMenus: a bubble-phase listener on an ancestor that
    // opens the app's own menu only if nothing nearer claimed the click.
    let openedAppMenu = false;
    pane.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      openedAppMenu = true;
    });

    expect(rightClick(inner)).toBe(false);
    expect(openedAppMenu).toBe(true);
  });

  it("does not see an event whose propagation was stopped — such handlers must cancel it themselves", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    uninstall = installContextMenuSuppressor();

    // Radix's ContextMenuTrigger does both (stopPropagation + preventDefault);
    // stopping without cancelling would let the native menu back in.
    el.addEventListener("contextmenu", (event) => event.stopPropagation());
    expect(rightClick(el)).toBe(true);
  });

  // Vitest builds with DEV set, so this covers the dev-build behaviour; in a
  // release build the modifier is ignored and nothing gets through.
  it("lets Shift+right-click through in dev, so Inspect Element stays reachable", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    uninstall = installContextMenuSuppressor();

    expect(rightClick(el)).toBe(false);
    expect(rightClick(el, true)).toBe(true);
  });

  it("stops suppressing once uninstalled", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const off = installContextMenuSuppressor();
    expect(rightClick(el)).toBe(false);
    off();
    expect(rightClick(el)).toBe(true);
  });
});
