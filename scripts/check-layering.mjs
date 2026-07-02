// Fails if `@tauri-apps/*` is imported anywhere under src/ except src/services/
// (CLAUDE.md §2: the service layer is the ONLY place allowed to touch Tauri's
// IPC/plugin APIs; React renders, `services` is the sole IPC gateway).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
// Only match actual import/require specifiers (a quote immediately before the
// package name), so a doc-comment mentioning "@tauri-apps/api" in backticks
// doesn't trip a false positive.
const IMPORT_RE = /["']@tauri-apps\//;
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;

    const rel = relative(SRC, full).split("\\").join("/");
    if (rel.startsWith("services/")) continue; // the exempt gateway

    const text = readFileSync(full, "utf8");
    if (IMPORT_RE.test(text)) {
      violations.push(rel);
    }
  }
}

walk(SRC);

if (violations.length > 0) {
  console.error("Layering violation: @tauri-apps/* imported outside src/services/:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("Layering check passed: @tauri-apps/* is only imported under src/services/.");
