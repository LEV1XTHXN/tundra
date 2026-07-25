/**
 * A deliberately small YAML-frontmatter subset — shared by every adapter that
 * needs one (Obsidian's `title`/`tags`/plugin markers; Anytype's relations,
 * whose names are freeform human labels like "Object type" or "Creation
 * date", not single lowercase words). Not a general YAML parser: unrecognized
 * shapes are kept as their raw string so nothing is lost, they just won't be
 * interpreted as a list. Verified against a REAL Anytype export, which also
 * confirmed a leading YAML comment line (`# yaml-language-server: …`, a
 * schema hint for editor tooling) needs explicit skipping — a bare `#` isn't
 * a key/value line and must never be mistaken for one.
 */
export interface Frontmatter {
  /** Every top-level key, string or string-list, exactly as written (minus
   *  quotes) — lets an adapter check for its own plugin markers. */
  raw: Record<string, string | string[]>;
  title?: string;
  tags: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Strip a leading `---\n…\n---` block (if present) and parse its `key: value`
 *  pairs. Returns the frontmatter (empty if the file has none) and the
 *  remaining body, UNCHANGED, ready for Markdown parsing. */
export function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { frontmatter: { raw: {}, tags: [] }, body: text };

  const body = text.slice(match[0].length);
  const lines = match[1].split(/\r?\n/);
  const raw: Record<string, string | string[]> = {};

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i])) continue; // YAML comment (e.g. a yaml-language-server schema hint)
    // Key up to the first colon — deliberately NOT restricted to single
    // "word" keys: Anytype's relation names are freeform labels with spaces
    // ("Object type", "Creation date"), unlike Obsidian's single-word keys.
    const kv = /^([^:\r\n]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1].trim();
    const rest = kv[2];

    if (rest.trim() === "") {
      // Possible block list on the following indented `- item` lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s*/.test(lines[j])) {
        items.push(unquote(lines[j].replace(/^\s+-\s*/, "")));
        j++;
      }
      if (items.length > 0) {
        raw[key] = items;
        i = j - 1;
        continue;
      }
      raw[key] = "";
      continue;
    }

    const trimmed = rest.trim();
    raw[key] =
      trimmed.startsWith("[") && trimmed.endsWith("]")
        ? trimmed
            .slice(1, -1)
            .split(",")
            .map(unquote)
            .filter(Boolean)
        : unquote(trimmed);
  }

  // Case-insensitive: Obsidian writes lowercase `tags`/`tag`, Anytype's
  // relation is capitalized `Tag` — neither adapter should have to special-
  // case the other's casing convention.
  const tags: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (lower !== "tags" && lower !== "tag") continue;
    if (Array.isArray(value)) tags.push(...value);
    else if (value) tags.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
  }

  const titleKey = Object.keys(raw).find((k) => k.toLowerCase() === "title");
  const titleRaw = titleKey ? raw[titleKey] : undefined;
  const title = typeof titleRaw === "string" && titleRaw ? titleRaw : undefined;

  return { frontmatter: { raw, title, tags: [...new Set(tags)] }, body };
}
