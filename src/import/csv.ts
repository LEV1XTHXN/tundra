/**
 * A small RFC4180-ish CSV parser and a Markdown table synthesizer, just for
 * `notionAdapter.ts`'s database exports (`<Name> <id>.csv`). No dependency —
 * the format is narrow enough (comma-separated, double-quote quoting, `""`
 * escaping) to hand-write correctly, matching this project's existing
 * no-new-packages precedent (see `frontmatter.ts`'s YAML subset).
 */

/** Parse CSV text into rows of raw string cells. Handles quoted fields
 *  (commas/newlines inside quotes, `""` as an escaped quote) and both
 *  `\n`/`\r\n` line endings. Drops a single trailing blank line. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyField = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAnyField = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      sawAnyField = true;
    } else if (c === "\r") {
      // handled by the following \n (or a lone \r, treated the same as \n below)
      if (text[i + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        sawAnyField = false;
      }
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyField = false;
    } else {
      field += c;
      sawAnyField = true;
    }
  }
  if (sawAnyField || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Render parsed CSV rows as a GFM Markdown pipe table — fed straight into
 *  BlockNote's own Markdown parser (never hand-built as block JSON), so a
 *  Notion database table comes out as a real `table` block for free. */
export function csvToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const width = rows[0].length;
  const esc = (s: string | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => esc(r[i]));

  const [header, ...body] = rows;
  const lines = [
    `| ${pad(header).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((r) => `| ${pad(r).join(" | ")} |`),
  ];
  return lines.join("\n");
}
