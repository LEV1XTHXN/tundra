import { describe, expect, it } from "vitest";
import type { NoteSummary } from "@/services";
import type { PropertyDef, TableSort } from "@/store/folderViews";
import { orderRows, type TableRow } from "./ordering";

function noteRow(id: string, title: string, extra: Partial<NoteSummary> = {}, pinned = false): TableRow {
  return {
    kind: "note",
    pinned,
    summary: {
      id,
      title,
      path: `notes/${id}.json`,
      modified: extra.modified ?? "2026-01-01T00:00:00Z",
      created: extra.created ?? "2026-01-01T00:00:00Z",
      size: extra.size ?? 100,
      icon: null,
      properties: extra.properties,
    } as NoteSummary,
  };
}

function folderRow(name: string, pinned = false): TableRow {
  return { kind: "folder", name, path: name, pinned };
}

const names = (rows: TableRow[]) => rows.map((r) => (r.kind === "folder" ? `F:${r.name}` : `N:${r.summary.title}`));

describe("orderRows", () => {
  it("puts folders above notes, then sorts by name", () => {
    const rows = [noteRow("n1", "Banana"), folderRow("Zeta"), folderRow("Alpha"), noteRow("n2", "Apple")];
    const sort: TableSort[] = [{ key: "name", dir: "asc" }];
    expect(names(orderRows(rows, sort, {}))).toEqual(["F:Alpha", "F:Zeta", "N:Apple", "N:Banana"]);
  });

  it("floats pinned rows to the very top, above the folder/note tiers", () => {
    const rows = [folderRow("Zeta"), noteRow("n1", "Apple", {}, true), folderRow("Alpha")];
    const sort: TableSort[] = [{ key: "name", dir: "asc" }];
    expect(names(orderRows(rows, sort, {}))).toEqual(["N:Apple", "F:Alpha", "F:Zeta"]);
  });

  it("sorts notes by a select property in the definition's option order (not alphabetical)", () => {
    const def: PropertyDef = {
      id: "status",
      name: "Status",
      type: "select",
      // Deliberately non-alphabetical option order: To do -> Doing -> Done.
      options: [
        { id: "todo", name: "To do", color: "#888" },
        { id: "doing", name: "Doing", color: "#888" },
        { id: "done", name: "Done", color: "#888" },
      ],
    };
    const rows = [
      noteRow("n1", "A", { properties: { status: { type: "select", value: "done" } } }),
      noteRow("n2", "B", { properties: { status: { type: "select", value: "todo" } } }),
      noteRow("n3", "C", { properties: { status: { type: "select", value: "doing" } } }),
    ];
    const sort: TableSort[] = [{ key: { prop: "status" }, dir: "asc" }];
    expect(names(orderRows(rows, sort, { status: def }))).toEqual(["N:B", "N:C", "N:A"]);
  });

  it("sorts numbers descending (regression: was 2 1 3 from a NaN comparator)", () => {
    const rows = [
      noteRow("n1", "One", { properties: { p: { type: "number", value: 1 } } }),
      noteRow("n2", "Two", { properties: { p: { type: "number", value: 2 } } }),
      noteRow("n3", "Three", { properties: { p: { type: "number", value: 3 } } }),
    ];
    const asc: TableSort[] = [{ key: { prop: "p" }, dir: "asc" }];
    const desc: TableSort[] = [{ key: { prop: "p" }, dir: "desc" }];
    expect(names(orderRows(rows, asc, {}))).toEqual(["N:One", "N:Two", "N:Three"]);
    expect(names(orderRows(rows, desc, {}))).toEqual(["N:Three", "N:Two", "N:One"]);
  });

  it("keeps empty property values last even when sorting descending", () => {
    const rows = [
      noteRow("n1", "Filled", { properties: { p: { type: "number", value: 5 } } }),
      noteRow("n2", "Empty"),
    ];
    expect(names(orderRows(rows, [{ key: { prop: "p" }, dir: "asc" }], {}))).toEqual(["N:Filled", "N:Empty"]);
    expect(names(orderRows(rows, [{ key: { prop: "p" }, dir: "desc" }], {}))).toEqual(["N:Filled", "N:Empty"]);
  });

  it("applies multiple sort levels at once (modified asc, then number desc)", () => {
    const rows = [
      noteRow("a", "A", { modified: "2026-01-01T00:00:00Z", properties: { p: { type: "number", value: 1 } } }),
      noteRow("b", "B", { modified: "2026-01-01T00:00:00Z", properties: { p: { type: "number", value: 9 } } }),
      noteRow("c", "C", { modified: "2026-02-01T00:00:00Z", properties: { p: { type: "number", value: 5 } } }),
    ];
    // Primary: modified asc groups {A,B} (Jan) before {C} (Feb).
    // Secondary: number desc orders within the Jan group -> B(9) before A(1).
    const sort: TableSort[] = [
      { key: "modified", dir: "asc" },
      { key: { prop: "p" }, dir: "desc" },
    ];
    expect(names(orderRows(rows, sort, {}))).toEqual(["N:B", "N:A", "N:C"]);
  });
});
