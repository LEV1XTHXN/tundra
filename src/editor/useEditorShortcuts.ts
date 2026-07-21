import { useEffect } from "react";

import { useKeybindings } from "@/store/keybindings";
import { matchCommand } from "@/keybindings/binding";

interface Params {
  isTemplateMode: boolean;
  onCreateLink: () => void;
  onFind: () => void;
  onUseTemplate: () => void;
}

/**
 * The editor-scoped, rebindable shortcuts. Combos are read from the shared
 * keybinding store (rebindable in Settings); App owns the global ones. Both
 * listeners use the same `matchCommand` matcher and act only on their own command
 * ids. `template.use` is meaningless while editing a template itself, so it's
 * suppressed in template mode.
 */
export function useEditorShortcuts({ isTemplateMode, onCreateLink, onFind, onUseTemplate }: Params): void {
  const bindings = useKeybindings((s) => s.bindings);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const cmd = matchCommand(e, bindings);
      if (cmd === "link.create") {
        e.preventDefault();
        onCreateLink();
      } else if (cmd === "search.inNote") {
        e.preventDefault();
        onFind();
      } else if (cmd === "template.use" && !isTemplateMode) {
        e.preventDefault();
        onUseTemplate();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, isTemplateMode, onCreateLink, onFind, onUseTemplate]);
}
