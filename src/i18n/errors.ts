/**
 * Localizes a `CoreError` (thrown as-is by the `services` layer whenever Rust
 * returns a typed error — see `unwrap`/`typedError` in `src/services`) by its
 * `kind` discriminant, never by the raw Rust message string: the message on
 * `Io`/`Serde`/etc. is an internal debugging detail (a Rust `Display` string),
 * not something to show a user or translate. `SchemaTooNew` is the one kind
 * whose payload IS user-relevant (found/supported version numbers), so it's
 * interpolated into its translation instead of discarded.
 *
 * Anything that isn't a recognized `CoreError` (a plain JS `Error`, a string,
 * a network hiccup) falls back to `errors.generic`, still localized chrome
 * around an un-translatable detail.
 */
import type { TFunction } from "i18next";
import type { CoreError } from "@/services/bindings";

const KNOWN_KINDS = new Set<CoreError["kind"]>([
  "Vault",
  "NotFound",
  "SchemaTooNew",
  "Io",
  "Serde",
  "EmptyBlockId",
  "DuplicateBlockId",
]);

function isCoreError(error: unknown): error is CoreError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    KNOWN_KINDS.has((error as { kind: unknown }).kind as CoreError["kind"])
  );
}

/** Translate any caught error into a user-facing message. */
export function localizeError(error: unknown, t: TFunction): string {
  if (isCoreError(error)) {
    switch (error.kind) {
      case "Vault":
        return t("errors.vault");
      case "NotFound":
        return t("errors.notFound");
      case "SchemaTooNew":
        return t("errors.schemaTooNew", { found: error.message.found, supported: error.message.supported });
      case "Io":
        return t("errors.io");
      case "Serde":
        return t("errors.serde");
      case "EmptyBlockId":
        return t("errors.emptyBlockId");
      case "DuplicateBlockId":
        return t("errors.duplicateBlockId");
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return t("errors.generic", { message });
}
