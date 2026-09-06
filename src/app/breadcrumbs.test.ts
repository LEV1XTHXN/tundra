import { describe, expect, it } from "vitest";

import { noteCrumbs } from "./breadcrumbs";

describe("noteCrumbs", () => {
  it("lists the folders between the notes root and the file", () => {
    expect(noteCrumbs("notes/Personal/Journal/Sunday reset.json")).toEqual(["Personal", "Journal"]);
  });

  it("is empty for a note at the vault root", () => {
    expect(noteCrumbs("notes/Groceries.json")).toEqual([]);
  });

  it("tolerates a path that isn't under notes/", () => {
    expect(noteCrumbs("Personal/Sunday reset.json")).toEqual(["Personal"]);
  });

  it("normalises backslashes", () => {
    expect(noteCrumbs("notes\\Work\\Meetings\\Standup.json")).toEqual(["Work", "Meetings"]);
  });

  it("is empty for a missing path", () => {
    expect(noteCrumbs(undefined)).toEqual([]);
    expect(noteCrumbs(null)).toEqual([]);
    expect(noteCrumbs("")).toEqual([]);
  });
});
