import { describe, expect, it } from "vitest";
import { decideReconciliation } from "./reconcile";

describe("decideReconciliation", () => {
  it("offers recreate when the file was deleted, regardless of dirty state", () => {
    expect(decideReconciliation({ stillExists: false, isDirty: false })).toEqual({ kind: "deleted" });
    expect(decideReconciliation({ stillExists: false, isDirty: true })).toEqual({ kind: "deleted" });
  });

  it("shows the dirty-conflict banner when the file still exists but the editor has unsaved edits", () => {
    expect(decideReconciliation({ stillExists: true, isDirty: true })).toEqual({ kind: "dirty-conflict" });
  });

  it("signals a silent reload when the file still exists and the editor is clean", () => {
    expect(decideReconciliation({ stillExists: true, isDirty: false })).toEqual({ kind: "none" });
  });
});
