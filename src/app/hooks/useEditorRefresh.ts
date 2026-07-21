import { useCallback, useState } from "react";

/**
 * A monotonically-increasing token used as part of the open note's React `key`.
 * Bumping it remounts `NoteEditor` so it reloads from disk — needed when the
 * open note is renamed or re-iconed from the tree, since the editor caches its
 * title locally and would otherwise silently revert an external change.
 */
export function useEditorRefresh(): [token: number, bump: () => void] {
  const [token, setToken] = useState(0);
  const bump = useCallback(() => setToken((t) => t + 1), []);
  return [token, bump];
}
