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
- **Layout & ordering:** `flattenWithGroups` (in `flatten.ts`) lays out the whole
  sidebar. Groups, ungrouped top-level folders, and root notes share **one manual
  order** — the root folder view's `manualOrder`, which now also carries
  `group:<id>` keys — so the user can arrange all three freely. Each group renders
  as a header with its folders nested at depth 1; ungrouped items at depth 0. In a
  *field* sort (name/date/size) groups render first (stored order) then the sorted
  ungrouped items, since a group has no field to sort by. `flattenTree` still
  flattens subtrees.
- **Create:** "+ New group" in the sidebar actions (App's new-group dialog).
- **Reorder (drag):** groups are draggable like folders/notes. Drag a group (or a
  top-level folder/root note) onto another top-level row's top/bottom edge to
  reorder them in the unified order; this switches the root to manual sort and
  writes the new order (including `group:` keys) to `folderViews[""].manualOrder`.
  `NavTree`'s `rootOrderedKeys` builds the full key set from `tree` + `groups` (not
  the flattened rows, which omit collapsed-away folders) so a reorder never drops a
  hidden key. A group only reorders among top-level units — it can't be dropped
  into a folder (`canDropOnFolder` returns false for a group payload).
- **Assign / unassign:** drag a top-level folder onto the *middle* of a group
  header to add it (the edges reorder instead); drag it to the "Vault" root target
  to ungroup it (`NavTree` drag handlers → `useFolderGroups.assign`).
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
