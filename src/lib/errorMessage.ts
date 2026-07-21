import type { CoreError } from "@/services";

/**
 * Turn an unknown thrown value into a user-presentable string. Core errors
 * arrive as a typed `{ kind, message? }` DTO (see the `ipc` module); not every
 * variant carries a `message` (e.g. `EmptyBlockId`), so fall back to the kind
 * alone. Anything that isn't a CoreError is stringified as-is.
 */
export function errorMessage(err: unknown): string {
  const e = err as Partial<CoreError>;
  if (e && typeof e === "object" && "kind" in e) {
    const m = "message" in e ? (e as { message?: unknown }).message : undefined;
    return typeof m === "string" ? `${e.kind}: ${m}` : String(e.kind);
  }
  return String(err);
}
