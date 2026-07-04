/**
 * Browser-style "find in note": a ProseMirror plugin that highlights every
 * occurrence of a query in the current note and tracks which one is active.
 *
 * It's attached to BlockNote's live ProseMirror view at runtime by reconfiguring
 * the running state (`view.updateState(state.reconfigure(...))`) — a standard
 * ProseMirror move that keeps this decoupled from BlockNote's own extension API.
 * The search string and active index are pushed in through transaction meta;
 * navigation (`focusMatch`) also moves the editor selection and scrolls, so the
 * current match is visible even if decorations don't paint in a given webview.
 */
import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export interface Match {
  from: number;
  to: number;
}

interface FindState {
  query: string;
  activeIndex: number;
  matches: Match[];
  decorations: DecorationSet;
}

interface FindMeta {
  query: string;
  activeIndex: number;
}

export const findPluginKey = new PluginKey<FindState>("tundra-find");

/** All case-insensitive occurrences of `query` in the doc's text. Matches are
 *  found within a single text node (matches spanning mark boundaries are not
 *  merged) — fine for note find and keeps the walk simple and fast. */
function findMatches(doc: PMNode, query: string): Match[] {
  const matches: Match[] = [];
  if (!query) return matches;
  const needle = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = node.text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      matches.push({ from: pos + i, to: pos + i + needle.length });
      i = hay.indexOf(needle, i + needle.length);
    }
  });
  return matches;
}

function buildDecorations(doc: PMNode, matches: Match[], activeIndex: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, idx) =>
    Decoration.inline(m.from, m.to, {
      class: idx === activeIndex ? "find-match find-match-active" : "find-match",
    }),
  );
  return DecorationSet.create(doc, decos);
}

/** Clamp an index into `[0, len)`, or `0` when there are no matches. */
function clampIndex(index: number, len: number): number {
  if (len === 0) return 0;
  return ((index % len) + len) % len;
}

function createFindPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findPluginKey,
    state: {
      init: (): FindState => ({
        query: "",
        activeIndex: 0,
        matches: [],
        decorations: DecorationSet.empty,
      }),
      apply(tr, value, _oldState, newState): FindState {
        const meta = tr.getMeta(findPluginKey) as FindMeta | undefined;
        if (meta) {
          const matches = findMatches(newState.doc, meta.query);
          const activeIndex = clampIndex(meta.activeIndex, matches.length);
          return {
            query: meta.query,
            activeIndex,
            matches,
            decorations: buildDecorations(newState.doc, matches, activeIndex),
          };
        }
        if (tr.docChanged && value.query) {
          // The document changed under an active search — recompute positions.
          const matches = findMatches(newState.doc, value.query);
          const activeIndex = clampIndex(value.activeIndex, matches.length);
          return {
            ...value,
            activeIndex,
            matches,
            decorations: buildDecorations(newState.doc, matches, activeIndex),
          };
        }
        if (tr.docChanged) {
          return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) };
        }
        return value;
      },
    },
    props: {
      decorations(state: EditorState) {
        return findPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Attach the find plugin to a running BlockNote/ProseMirror view (idempotent).
 * Returns a detach function that removes it and clears highlights.
 */
export function attachFindPlugin(view: EditorView): () => void {
  if (findPluginKey.get(view.state)) return () => {};
  const plugin = createFindPlugin();
  view.updateState(view.state.reconfigure({ plugins: view.state.plugins.concat(plugin) }));
  return () => {
    if (view.isDestroyed) return;
    view.updateState(
      view.state.reconfigure({
        plugins: view.state.plugins.filter((p) => p !== plugin),
      }),
    );
  };
}

/** Push a new query / active index into the plugin (recomputes highlights). */
export function setSearch(view: EditorView, query: string, activeIndex: number): void {
  const meta: FindMeta = { query, activeIndex };
  view.dispatch(view.state.tr.setMeta(findPluginKey, meta));
}

/** The current find state (matches + active index) for a view. */
export function getFindState(view: EditorView): { matches: Match[]; activeIndex: number } {
  const s = findPluginKey.getState(view.state);
  return { matches: s?.matches ?? [], activeIndex: s?.activeIndex ?? 0 };
}

/**
 * Make match `index` the active one: update the highlight, move the editor
 * selection onto it, and scroll it into view. No-op when there are no matches.
 */
export function focusMatch(view: EditorView, index: number): void {
  const { matches } = getFindState(view);
  if (matches.length === 0) return;
  const active = clampIndex(index, matches.length);
  const m = matches[active];
  const tr = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, m.from, m.to))
    .setMeta(findPluginKey, { query: findPluginKey.getState(view.state)?.query ?? "", activeIndex: active })
    .scrollIntoView();
  view.dispatch(tr);
}

/** Clear the search (remove all highlights) without detaching the plugin. */
export function clearSearch(view: EditorView): void {
  setSearch(view, "", 0);
}
