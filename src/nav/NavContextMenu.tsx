/**
 * Right-click menus for the nav tree. Everything the tree can do — create, open,
 * rename, set icon, sort, delete — lives here; the rows themselves carry no
 * hover chrome, so they stay as dense as the reference design.
 *
 * The menu is target-aware: right-clicking a folder or group creates *inside* it,
 * right-clicking empty space creates at the vault root.
 */
import { FilePlus, FolderPlus, FolderTree, Pencil, Smile, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { SORT_FIELDS, useFolderSort } from "./folderSort";
import type { NavRow } from "./flatten";

/** The actions a nav-tree menu can dispatch — supplied by `NavTree`, which owns
 *  the rename/icon UI state and receives the mutations as props. */
export interface NavMenuActions {
  onNewNote: (folder: string) => void;
  onNewFolder: (parent: string, label?: string) => void;
  onNewFolderInGroup: (groupId: string, label: string) => void;
  onNewGroup: () => void;
  onOpenNote: (id: string) => void;
  onOpenFolder: (path: string) => void;
  onRename: (row: NavRow) => void;
  onSetIcon: (row: NavRow) => void;
  onDelete: (row: NavRow) => void;
}

/** Menu for the tree's empty space / background — creates at the vault root. */
export function NavRootMenu({ actions }: { actions: NavMenuActions }) {
  const { t } = useTranslation();
  return (
    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
      <ContextMenuItem onSelect={() => actions.onNewNote("")}>
        <FilePlus /> {t("nav.newNote")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.onNewFolder("")}>
        <FolderPlus /> {t("nav.newFolder")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={actions.onNewGroup}>
        <FolderTree /> {t("nav.newGroup")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Menu for a single row, branching on what was right-clicked. */
export function NavRowMenu({ row, actions }: { row: NavRow; actions: NavMenuActions }) {
  const { t } = useTranslation();
  if (row.kind === "folder") return <FolderMenu row={row} actions={actions} />;

  if (row.kind === "group") {
    return (
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={() => actions.onNewFolderInGroup(row.id, row.name)}>
          <FolderPlus /> {t("nav.newFolderInGroup")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.onSetIcon(row)}>
          <Smile /> {t("nav.setIcon")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onRename(row)}>
          <Pencil /> {t("nav.rename")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(row)}>
          <Trash2 /> {t("nav.deleteGroup")}
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  return (
    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
      <ContextMenuItem onSelect={() => actions.onOpenNote(row.id)}>{t("nav.open")}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.onSetIcon(row)}>
        <Smile /> {t("nav.setIcon")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.onRename(row)}>
        <Pencil /> {t("nav.rename")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(row)}>
        <Trash2 /> {t("nav.delete")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Split out because the sort submenu needs a hook, which the branching
 *  `NavRowMenu` can't call conditionally. */
function FolderMenu({
  row,
  actions,
}: {
  row: Extract<NavRow, { kind: "folder" }>;
  actions: NavMenuActions;
}) {
  const { t } = useTranslation();
  const { current, choose } = useFolderSort(row.path);
  return (
    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
      <ContextMenuItem onSelect={() => actions.onOpenFolder(row.path)}>{t("nav.openFolderTable")}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.onNewNote(row.path)}>
        <FilePlus /> {t("nav.newNoteHere")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.onNewFolder(row.path, row.name)}>
        <FolderPlus /> {t("nav.newFolderHere")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.onSetIcon(row)}>
        <Smile /> {t("nav.setIcon")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.onRename(row)}>
        <Pencil /> {t("nav.rename")}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{t("nav.sortBy")}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {SORT_FIELDS.map(({ field, labelKey }) => {
            const active = current.by === field;
            return (
              <ContextMenuItem
                key={field}
                // Keep the menu open so the direction can be flipped by picking
                // the active field again, exactly like the old sort popover.
                onSelect={(e) => {
                  e.preventDefault();
                  choose(field);
                }}
              >
                <span className="nav-sort-check">{active ? "✓" : ""}</span>
                {t(labelKey)}
                {active && field !== "manual" && (
                  <span className="nav-sort-dir">{current.dir === "asc" ? "↑" : "↓"}</span>
                )}
              </ContextMenuItem>
            );
          })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(row)}>
        <Trash2 /> {t("nav.delete")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
