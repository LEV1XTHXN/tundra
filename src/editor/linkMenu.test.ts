import { describe, expect, it } from "vitest";

import { filterLinkCandidates } from "./linkMenu";
import { NOTE_LINK_TYPE } from "./NoteLink";
import type { NoteSummary } from "@/services";

function summary(id: string, title: string): NoteSummary {
  return {
    id,
    title,
    path: `notes/${id}.json`,
    modified: "2026-07-01T00:00:00Z",
    created: "2026-07-01T00:00:00Z",
    size: 100,
    icon: null,
  };
}

const notes: NoteSummary[] = [
  summary("a", "Photosynthesis"),
  summary("b", "Cell Biology"),
  summary("c", "Photography"),
];

describe("filterLinkCandidates", () => {
  it("filters by title, case-insensitively", () => {
    const hits = filterLinkCandidates(notes, "current", "photo");
    expect(hits.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("excludes the current note (no self-links)", () => {
    const hits = filterLinkCandidates(notes, "a", "photo");
    expect(hits.map((n) => n.id)).toEqual(["c"]);
  });

  it("returns all (minus self) for an empty query", () => {
    expect(filterLinkCandidates(notes, "b", "").map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("respects the limit", () => {
    expect(filterLinkCandidates(notes, "x", "", 2)).toHaveLength(2);
  });
});

describe("note-link contract", () => {
  it("uses the exact inline type the Rust `links` parser expects", () => {
    // Must equal `tundra_core::LINK_INLINE_TYPE`. If this changes, the Rust
    // parser (crates/tundra-core/src/links.rs) must change in lockstep.
    expect(NOTE_LINK_TYPE).toBe("noteLink");
  });
});
