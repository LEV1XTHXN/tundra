import { Settings } from "lucide-react";
import { useKeybindings } from "@/store/keybindings";
import { formatBinding } from "@/keybindings/binding";

interface SidebarActionsProps {
  onSearch: () => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onNewGroup: () => void;
  onSettings: () => void;
}

/** The sidebar's action buttons: search, new note/folder/group, settings. The
 *  search hint reads the live keybinding so a rebind is reflected immediately. */
export function SidebarActions({
  onSearch,
  onNewNote,
  onNewFolder,
  onNewGroup,
  onSettings,
}: SidebarActionsProps) {
  const searchBinding = useKeybindings((s) => s.bindings["search.global"]);
  return (
    <div className="sidebar-actions">
      <button className="new-note" onClick={onSearch}>
        Search… <span className="muted">{formatBinding(searchBinding)}</span>
      </button>
      <button className="new-note" onClick={onNewNote}>
        + New note
      </button>
      <button className="new-note" onClick={onNewFolder}>
        + New folder
      </button>
      <button className="new-note" onClick={onNewGroup}>
        + New group
      </button>
      <button className="new-note settings-button" onClick={onSettings}>
        <Settings className="h-4 w-4" /> Settings
      </button>
    </div>
  );
}
