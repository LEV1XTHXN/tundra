/**
 * Note picker for linking a selected word to a note (Phase 2 step 3). Opened
 * with a selection active (Ctrl/Cmd+Shift+K); choosing a note wraps the
 * selection into an id-backed link whose *display* text stays the selected word
 * (e.g. link the word "orchid" to the note "Orchidea nautilica"). Mirrors the
 * search palette's cmdk pattern; data through `services` only.
 */
import { useEffect, useState } from "react";

import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { notes } from "@/services";
import type { NoteSummary } from "@/services";
import { filterLinkCandidates } from "./linkMenu";

interface NoteLinkPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The note being edited — excluded from candidates (no self-links). */
  currentNoteId: string;
  /** The selected word that will become the link's display text (may be empty). */
  display: string;
  onPick: (note: NoteSummary) => void;
}

export function NoteLinkPicker({ open, onOpenChange, currentNoteId, display, onPick }: NoteLinkPickerProps) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<NoteSummary[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    let cancelled = false;
    notes
      .list()
      .then((l) => {
        if (!cancelled) setList(l);
      })
      .catch(() => {
        if (!cancelled) setList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const candidates = filterLinkCandidates(list, currentNoteId, query);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Link to note"
      description="Choose a note to link the selected text to"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={display ? `Link "${display}" to…` : "Link to note…"}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {candidates.length === 0 ? (
            <CommandEmpty>No notes found.</CommandEmpty>
          ) : (
            <CommandGroup heading="Notes">
              {candidates.map((n) => (
                <CommandItem
                  key={n.id}
                  value={n.id}
                  onSelect={() => {
                    onPick(n);
                    onOpenChange(false);
                  }}
                >
                  {n.title || "Untitled"}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
