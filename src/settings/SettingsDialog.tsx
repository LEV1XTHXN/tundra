/**
 * The settings surface (CLAUDE.md §6.2 `settings`). First section is keybinding
 * rebinding; the left rail is structured so Appearance/Backup/etc. slot in later.
 * Preferences are owned by the keybindings store (persisted via Rust); React
 * only renders and captures the user's chosen combos.
 */
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { COMMANDS, type CommandId } from "@/keybindings/registry";
import { eventToBinding, formatBinding } from "@/keybindings/binding";
import { findConflicts, useKeybindings } from "@/store/keybindings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SECTIONS = [{ id: "keybindings", label: "Keybindings" }] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [section, setSection] = useState<SectionId>("keybindings");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Customize how Tundra works.</DialogDescription>
        </DialogHeader>
        <div className="settings-body">
          <nav className="settings-rail" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`settings-rail-item${section === s.id ? " active" : ""}`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {section === "keybindings" && <KeybindingsSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeybindingsSection() {
  const bindings = useKeybindings((s) => s.bindings);
  const setBinding = useKeybindings((s) => s.setBinding);
  const resetBinding = useKeybindings((s) => s.resetBinding);
  const resetAll = useKeybindings((s) => s.resetAll);
  const [recording, setRecording] = useState<CommandId | null>(null);

  const conflicts = findConflicts(bindings);

  // While recording, capture the next real key combo (ignoring lone modifiers)
  // in the capture phase, so it never leaks to the app's global shortcut
  // dispatcher or types into a field. Escape cancels without binding.
  useEffect(() => {
    if (!recording) return;
    const id = recording;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setRecording(null);
        return;
      }
      const binding = eventToBinding(e);
      if (binding === null) return; // still holding only modifiers — keep waiting
      setBinding(id, binding);
      setRecording(null);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recording, setBinding]);

  return (
    <div className="keybindings">
      <div className="keybindings-list">
        {COMMANDS.map((cmd) => {
          const inConflict = conflicts.has(cmd.id);
          return (
            <div key={cmd.id} className="keybinding-row">
              <div className="keybinding-info">
                <span className="keybinding-label">{cmd.label}</span>
                <span className="keybinding-desc muted">{cmd.description}</span>
                {inConflict && (
                  <span className="keybinding-conflict">
                    Conflicts with another shortcut on the same keys.
                  </span>
                )}
              </div>
              <div className="keybinding-actions">
                <Button
                  variant={recording === cmd.id ? "default" : "outline"}
                  size="sm"
                  className="keybinding-key"
                  onClick={() => setRecording(recording === cmd.id ? null : cmd.id)}
                  aria-label={`Rebind ${cmd.label}`}
                >
                  {recording === cmd.id ? "Press keys…" : formatBinding(bindings[cmd.id])}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => resetBinding(cmd.id)}
                  title="Reset to default"
                  aria-label={`Reset ${cmd.label} to default`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="keybindings-footer">
        <Button variant="ghost" size="sm" onClick={resetAll}>
          Reset all to defaults
        </Button>
      </div>
    </div>
  );
}
