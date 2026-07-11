# Folder groups, folder icons, and the removal of tree pinning

Three related sidebar changes.

## Tree pinning removed

Pinning notes/folders *in the sidebar tree* is gone: the pin action, the pin
indicator, the pin-to-top sort, and the short-lived "Pinned" sidebar section were
all removed. Ordering in the tree is now purely **manual drag order** or a **field
sort** (`FolderSortMenu`) — see `orderChildren` in `src/nav/flatten.ts`.

**Kept:** the editor's *"Pin to Home"* button and the Home dashboard's Pinned
widget — a separate feature. `NoteSummary.pinned` (Rust) still exists and now
*only* drives Home. Folders can no longer be pinned anywhere, so the folder table
view (`FolderTableView`) treats folders as never-pinned.

## Folder icons

Folders now carry an icon (emoji or custom image), like notes. Folders have no
per-note metadata file, so — like a folder's sort order — the icon lives in the
folder-views config (`FolderView.icon` in `src/store/folderViews.ts`,
`.vault/config/folder-views.json`), **not** a note field. No Rust change.

`NoteIcon` gained a `fallback` prop (`"note" | "folder" | "group"`) picking the
default glyph, so the one component renders note, folder, and group icons. Set a
folder icon from its hover "Set icon" action in `NavTree` (`patch(path, { icon })`).

## Folder groups

Named, **collapsible sidebar sections that hold top-level folders** — a purely
presentational overlay (folders stay real directories directly under the notes
root). Stored in vault config, `.vault/config/folder-groups.json`, via the
`useFolderGroups` store (`src/store/folderGroups.ts`) — same class of vault-scoped
config as folder views / tag colors, no note-format or Rust change.

- **Model:** `FolderGroup { id, name, icon?, folders: string[], collapsed? }`.
  `folders` is a *membership set* of top-level folder paths; display order still
  comes from the root folder's own sort. A folder belongs to at most one group
  (first-claimer wins in the layout).
- **Layout:** `flattenWithGroups` (in `flatten.ts`) lays out the whole sidebar:
  each group as a header row with its folders nested at depth 1, then everything
  ungrouped (folders not in any group + root notes) at depth 0. It's the entry
  point NavTree uses; `flattenTree` still flattens subtrees.
- **Create:** "+ New group" in the sidebar actions (App's new-group dialog).
- **Assign / unassign:** drag a top-level folder onto a group header to add it;
  drag it to the "Vault root" target to ungroup it (`NavTree` drag handlers →
  `useFolderGroups.assign`).
- **Header actions:** collapse (persisted in `collapsed`), set icon, inline
  rename, delete (via App's shared `AlertDialog`, `PendingDelete` kind `"group"`;
  deleting a group never deletes folders).
- **Reconciliation:** a grouped top-level folder that's renamed/moved/deleted is
  followed or dropped from its group — App calls `renameFolder` / `dropFolder`
  in its folder rename/move/delete handlers (folder identity is its path, since
  folders have no UUID).

### Gotcha

Group membership keys on the top-level folder path. Renaming a top-level folder
changes that key, so App's `onRenameFolder` calls `useFolderGroups.renameFolder`
to keep it in place; moving a folder under another (making it non-top-level) or
deleting it calls `dropFolder`. If you add another folder-mutation path, reconcile
group membership there too.
