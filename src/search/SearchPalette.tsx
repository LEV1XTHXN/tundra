/**
 * Phase 1 step 9: command-palette full-text search (`cmdk`, via shadcn's
 * Command components). Type a query -> ranked results -> Enter/click opens
 * the note. React renders only — every read goes through the `services`
 * layer; this module never imports `@tauri-apps/api` (checked by
 * `npm run check:layering`).
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
import { search } from "@/services";
import type { SearchHit } from "@/services";

const RESULT_LIMIT = 20;
const DEBOUNCE_MS = 150;

interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectNote: (id: string) => void;
}

export function SearchPalette({ open, onOpenChange, onSelectNote }: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  // Reset on close so reopening never shows a stale query/results.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    // `#tag` mode: a leading `#` searches by tag (matching only the note's tag
    // set) instead of full text. The bare `#` with no tag typed yet shows
    // nothing rather than every note.
    const isTagSearch = trimmed.startsWith("#");
    const tagQuery = trimmed.slice(1).trim();
    if (isTagSearch && !tagQuery) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const request = isTagSearch
        ? search.byTag(tagQuery, RESULT_LIMIT)
        : search.query(trimmed, RESULT_LIMIT);
      void request
        .then((results) => {
          if (!cancelled) setHits(results);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search notes"
      description="Search your notes by title or content"
    >
      {/* shouldFilter=false: results are already ranked server-side by Tantivy
          (title-boosted); cmdk's own client-side fuzzy filter would re-sort
          or hide correctly-ranked hits that don't literally substring-match. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search notes…  (#tag to search by tag)"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {hits.length === 0 ? (
            <CommandEmpty>
              {query.trim() ? "No notes found." : "Type to search…  Start with # to search by tag."}
            </CommandEmpty>
          ) : (
            <CommandGroup heading={query.trim().startsWith("#") ? "Tagged notes" : "Notes"}>
              {hits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={hit.id}
                  onSelect={() => {
                    onSelectNote(hit.id);
                    onOpenChange(false);
                  }}
                >
                  <div className="search-hit">
                    <span className="search-hit-title">{hit.title || "Untitled"}</span>
                    {hit.snippet && <span className="search-hit-snippet">{hit.snippet}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
