/**
 * A deliberately small YAML-frontmatter subset — just enough for Obsidian's
 * common `title`/`tags`/plugin-marker keys (e.g. `kanban-plugin: basic`).
 * Not a general YAML parser: unrecognized shapes are kept as their raw string
 * so nothing is lost, they just won't be interpreted as a list.
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
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, rest] = kv;

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

  const tagsRaw = raw.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw
    : typeof tagsRaw === "string" && tagsRaw
      ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  // Obsidian also accepts the singular `tag:` key.
  if (typeof raw.tag === "string" && raw.tag) tags.push(raw.tag);

  const title = typeof raw.title === "string" && raw.title ? raw.title : undefined;

  return { frontmatter: { raw, title, tags: [...new Set(tags)] }, body };
}
