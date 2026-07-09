/**
 * In-editor spellcheck (Phase 3 step 5) — a ProseMirror decoration plugin that
 * underlines misspelled words returned by the Rust `spellcheck` service.
 *
 * Like `findPlugin`, it's attached to BlockNote's live ProseMirror view at
 * runtime by reconfiguring the running state — decoupled from BlockNote's own
 * extension API. All dictionary logic stays in Rust; this only renders spans and
 * asks the service to check text.
 *
 * Performance (the point of this step): checking is **debounced** and scoped to
 * the **changed range** (expanded to whole top-level blocks), never the whole
 * document on every keystroke. Existing decorations outside that range are mapped
 * through edits, not recomputed. The service call is async, so results are pushed
 * back in through transaction meta; a stale result (doc changed mid-check) is
 * dropped and rescheduled.
 *
 * Offsets from the service are UTF-16 code units, which is exactly how ProseMirror
 * addresses positions inside a text node — so a misspelling at `offset` maps to
 * `textNodeStartPos + offset` with no conversion.
 */
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

/** Shape of a misspelling (matches the service's `Misspelling`). */
export interface SpellMisspelling {
  offset: number;
  length: number;
  word: string;
  suggestions: string[];
}

/** A document-position range for a misspelled word, plus its menu payload. */
export interface SpellRange {
  from: number;
  to: number;
  word: string;
  suggestions: string[];
}

/** What the context menu needs to act on a right-clicked squiggle. */
export interface SpellContext extends SpellRange {
  x: number;
  y: number;
}

export interface SpellcheckController {
  /** Force a full-document re-check (after add-to-dictionary / language change). */
  recheckAll: () => void;
  /** Remove the plugin and clear squiggles. */
  detach: () => void;
}

interface SpellState {
  decorations: DecorationSet;
}
interface SpellMeta {
  from: number;
  to: number;
  decos: Decoration[];
}
interface Range {
  from: number;
  to: number;
}

const key = new PluginKey<SpellState>("tundra-spellcheck");
const DEBOUNCE_MS = 400;

// --- pure helpers (unit-tested) -----------------------------------------

/** Map a text node's misspellings (UTF-16 offsets) to document-position ranges. */
export function spellcheckRanges(basePos: number, items: SpellMisspelling[]): SpellRange[] {
  return items.map((m) => ({
    from: basePos + m.offset,
    to: basePos + m.offset + m.length,
    word: m.word,
    suggestions: m.suggestions,
  }));
}

/** Union of two ranges (or `b` when there's no accumulated range yet). */
export function unionRange(a: Range | null, b: Range): Range {
  if (!a) return b;
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
}

/** The changed span between two documents, or `null` if identical. */
export function changedRange(oldDoc: PMNode, newDoc: PMNode): Range | null {
  const start = oldDoc.content.findDiffStart(newDoc.content);
  if (start == null) return null;
  const end = oldDoc.content.findDiffEnd(newDoc.content);
  const endPos = end ? end.b : newDoc.content.size;
  return { from: Math.min(start, endPos), to: Math.max(start, endPos) };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function decorationFor(r: SpellRange): Decoration {
  return Decoration.inline(
    r.from,
    r.to,
    { class: "spellcheck-error" },
    { spellcheck: { word: r.word, suggestions: r.suggestions } },
  );
}

/**
 * Attach the spellcheck plugin to a running view. `check(text)` runs the Rust
 * spellcheck service on a text node's string; `onContext` is called when a
 * squiggle is right-clicked, with the info + screen coords for a menu.
 */
export function attachSpellcheckPlugin(
  view: EditorView,
  check: (text: string) => Promise<SpellMisspelling[]>,
  onContext: (ctx: SpellContext) => void,
): SpellcheckController {
  // Kill the webview's native spellcheck so squiggles aren't drawn twice.
  view.dom.setAttribute("spellcheck", "false");

  let pending: Range | null = null;
  let timer: number | undefined;
  let destroyed = false;

  function schedule() {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(run, DEBOUNCE_MS);
  }

  async function run() {
    timer = undefined;
    if (destroyed || view.isDestroyed || !pending) return;
    const range = pending;
    pending = null;

    const doc = view.state.doc;
    const size = doc.content.size;
    let from = clamp(range.from, 0, size);
    let to = clamp(range.to, from, size);
    // Expand to whole top-level blocks so a word isn't half-checked at an edge.
    try {
      const $from = doc.resolve(from);
      const $to = doc.resolve(to);
      if ($from.depth >= 1) from = $from.before(1);
      if ($to.depth >= 1) to = $to.after(1);
    } catch {
      // Positions at the doc edges may not resolve to a block — use them as-is.
    }

    const nodes: { pos: number; text: string }[] = [];
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isText && node.text) nodes.push({ pos, text: node.text });
    });

    const results = await Promise.all(nodes.map((n) => check(n.text)));
    if (destroyed || view.isDestroyed) return;
    // The document changed while we were checking — our positions are stale;
    // redo this range on the next tick (a newer edit likely queued one anyway).
    if (view.state.doc !== doc) {
      pending = unionRange(pending, { from, to });
      schedule();
      return;
    }

    const decos: Decoration[] = [];
    nodes.forEach((n, i) => {
      for (const r of spellcheckRanges(n.pos, results[i])) decos.push(decorationFor(r));
    });
    const meta: SpellMeta = { from, to, decos };
    view.dispatch(view.state.tr.setMeta(key, meta));
  }

  function recheckAll() {
    pending = { from: 0, to: view.state.doc.content.size };
    schedule();
  }

  const plugin = new Plugin<SpellState>({
    key,
    state: {
      init: (): SpellState => ({ decorations: DecorationSet.empty }),
      apply(tr, value): SpellState {
        // Always keep existing squiggles mapped through the edit …
        let set = value.decorations.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(key) as SpellMeta | undefined;
        if (meta) {
          // … then replace those inside the freshly-checked range.
          const inRange = set.find(meta.from, meta.to);
          set = set.remove(inRange).add(tr.doc, meta.decos);
        }
        return { decorations: set };
      },
    },
    props: {
      decorations(state: EditorState) {
        return key.getState(state)?.decorations ?? DecorationSet.empty;
      },
      handleDOMEvents: {
        contextmenu(v, event) {
          const set = key.getState(v.state)?.decorations;
          if (!set) return false;
          const hit = v.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!hit) return false;
          const deco = set
            .find(hit.pos, hit.pos + 1)
            .find((d) => (d.spec as { spellcheck?: unknown }).spellcheck);
          if (!deco) return false;
          const sc = (deco.spec as { spellcheck: { word: string; suggestions: string[] } }).spellcheck;
          event.preventDefault();
          onContext({ from: deco.from, to: deco.to, word: sc.word, suggestions: sc.suggestions, x: event.clientX, y: event.clientY });
          return true;
        },
      },
    },
    view: () => ({
      update(v, prevState) {
        if (destroyed || v.state.doc === prevState.doc) return;
        const r = changedRange(prevState.doc, v.state.doc);
        if (r) {
          pending = unionRange(pending, r);
          schedule();
        }
      },
    }),
  });

  view.updateState(view.state.reconfigure({ plugins: view.state.plugins.concat(plugin) }));
  recheckAll(); // initial full pass

  return {
    recheckAll,
    detach() {
      destroyed = true;
      if (timer !== undefined) clearTimeout(timer);
      if (view.isDestroyed) return;
      view.updateState(
        view.state.reconfigure({ plugins: view.state.plugins.filter((p) => p !== plugin) }),
      );
    },
  };
}
