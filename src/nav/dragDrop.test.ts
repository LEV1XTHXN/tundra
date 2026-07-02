import { describe, expect, it } from "vitest";
import { canDropOnFolder, parseDragPayload, serializeDragPayload } from "./dragDrop";

describe("drag payload serialize/parse", () => {
  it("round-trips a note payload losslessly, id preserved", () => {
    const payload = { kind: "note" as const, id: "abc-123" };
    expect(parseDragPayload(serializeDragPayload(payload))).toEqual(payload);
  });

  it("round-trips a folder payload losslessly", () => {
    const payload = { kind: "folder" as const, path: "Biology/Plants" };
    expect(parseDragPayload(serializeDragPayload(payload))).toEqual(payload);
  });

  it("rejects malformed or foreign drag data instead of throwing", () => {
    expect(parseDragPayload("not json")).toBeNull();
    expect(parseDragPayload(JSON.stringify({ kind: "note" }))).toBeNull(); // missing id
    expect(parseDragPayload(JSON.stringify({ foo: "bar" }))).toBeNull();
    expect(parseDragPayload("")).toBeNull();
  });
});

describe("canDropOnFolder", () => {
  it("allows dropping a note onto any folder", () => {
    expect(canDropOnFolder({ kind: "note", id: "n1" }, "Biology")).toBe(true);
    expect(canDropOnFolder({ kind: "note", id: "n1" }, "")).toBe(true);
  });

  it("rejects dropping a folder onto itself", () => {
    expect(canDropOnFolder({ kind: "folder", path: "Biology" }, "Biology")).toBe(false);
  });

  it("rejects dropping a folder into its own subtree", () => {
    expect(canDropOnFolder({ kind: "folder", path: "Biology" }, "Biology/Plants")).toBe(false);
    expect(canDropOnFolder({ kind: "folder", path: "Biology" }, "Biology/Plants/Ferns")).toBe(false);
  });

  it("allows dropping a folder onto an unrelated folder or the root", () => {
    expect(canDropOnFolder({ kind: "folder", path: "Biology" }, "Chemistry")).toBe(true);
    expect(canDropOnFolder({ kind: "folder", path: "Biology" }, "")).toBe(true);
  });

  it("does not false-positive on sibling folders with a shared name prefix", () => {
    // "Biology2" starts with "Biology" as a string, but is not "Biology/..".
    expect(canDropOnFolder({ kind: "folder", path: "Biology" }, "Biology2")).toBe(true);
  });
});
