/**
 * The single source of truth for the app's keyboard commands. Every rebindable
 * shortcut is declared here once; the keybindings store (`store/keybindings.ts`)
 * overlays user overrides on these defaults, the Settings UI lists them, and the
 * App/editor listeners dispatch by matching a pressed combo against the merged
 * bindings (`binding.ts`).
 *
 * Adding a shortcut = add a `CommandDef` here + handle its id where the action
 * lives. Nothing else in the app hardcodes a key combo.
 */

/** Stable identifier for a command — persisted as the key of the overrides map,
 *  so renaming one silently drops a user's saved binding. Treat as append-only. */
export type CommandId =
  | "search.global"
  | "search.inNote"
  | "inspector.toggle"
  | "link.create"
  | "note.new"
  | "view.quicknotes";

/** Groups commands in the Settings UI; room to grow as more commands land. */
export type CommandCategory = "navigation" | "editing";

export interface CommandDef {
  id: CommandId;
  /** Human label shown in Settings. */
  label: string;
  /** One-line description of what the command does. */
  description: string;
  category: CommandCategory;
  /** The out-of-the-box binding as a canonical string (see `binding.ts`). */
  defaultBinding: string;
}

/**
 * Declaration order is display order in Settings. Defaults reflect the locked
 * decisions: global search on F2 (Ctrl+K freed for BlockNote's in-editor web
 * link), find-in-note on Ctrl+F, inspector on Alt+I (avoids the editor's Ctrl+I
 * italic), note-link keeps its historical Ctrl+Shift+K, and new-note gets
 * Ctrl+Alt+N (Ctrl+N is reserved by the webview for a new window).
 */
export const COMMANDS: readonly CommandDef[] = [
  {
    id: "search.global",
    label: "Search vault",
    description: "Open the global search palette",
    category: "navigation",
    defaultBinding: "F2",
  },
  {
    id: "search.inNote",
    label: "Find in note",
    description: "Search for text within the open note",
    category: "navigation",
    defaultBinding: "Ctrl+F",
  },
  {
    id: "inspector.toggle",
    label: "Toggle info panel",
    description: "Show or hide the info panel (note metadata, or graph stats in the graph view)",
    category: "navigation",
    defaultBinding: "Alt+I",
  },
  {
    id: "note.new",
    label: "New note",
    description: "Create a new note in the current folder",
    category: "navigation",
    defaultBinding: "Ctrl+Alt+N",
  },
  {
    id: "view.quicknotes",
    label: "Open quick notes",
    description: "Switch to the quick notes view",
    category: "navigation",
    defaultBinding: "Ctrl+Q",
  },
  {
    id: "link.create",
    label: "Link to note",
    description: "Turn the selected text into a link to another note",
    category: "editing",
    defaultBinding: "Ctrl+Shift+K",
  },
] as const;

/** The built-in bindings as a `{ [id]: binding }` map — the base the store
 *  overlays user overrides onto. */
export const DEFAULT_BINDINGS: Record<CommandId, string> = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c.defaultBinding]),
) as Record<CommandId, string>;

export const COMMAND_BY_ID: Record<CommandId, CommandDef> = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c]),
) as Record<CommandId, CommandDef>;
