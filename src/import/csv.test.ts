import { describe, expect, it } from "vitest";
import { csvToMarkdownTable, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits plain comma-separated rows", () => {
    expect(parseCsv("Name,Status\nAlpha,Done\nBeta,Todo\n")).toEqual([
      ["Name", "Status"],
      ["Alpha", "Done"],
      ["Beta", "Todo"],
    ]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    expect(parseCsv('Name,Notes\n"Alpha","Has, a comma"\n"Beta","She said ""hi"""\n')).toEqual([
      ["Name", "Notes"],
      ["Alpha", "Has, a comma"],
      ["Beta", 'She said "hi"'],
    ]);
  });

  it("handles a newline embedded in a quoted field", () => {
    expect(parseCsv('Name,Notes\n"Alpha","Line one\nLine two"\n')).toEqual([
      ["Name", "Notes"],
      ["Alpha", "Line one\nLine two"],
    ]);
  });

  it("handles CRLF line endings and a file with no trailing newline", () => {
    expect(parseCsv("Name,Status\r\nAlpha,Done")).toEqual([
      ["Name", "Status"],
      ["Alpha", "Done"],
    ]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("csvToMarkdownTable", () => {
  it("renders a GFM pipe table with a header separator row", () => {
    const table = csvToMarkdownTable([
      ["Name", "Status"],
      ["Alpha", "Done"],
      ["Beta", "Todo"],
    ]);
    expect(table).toBe(["| Name | Status |", "| --- | --- |", "| Alpha | Done |", "| Beta | Todo |"].join("\n"));
  });

  it("escapes pipe characters and flattens embedded newlines so the table stays valid", () => {
    const table = csvToMarkdownTable([
      ["Name", "Notes"],
      ["Alpha", "a | b\nsecond line"],
    ]);
    expect(table).toBe(["| Name | Notes |", "| --- | --- |", "| Alpha | a \\| b second line |"].join("\n"));
  });

  it("pads short rows out to the header width", () => {
    const table = csvToMarkdownTable([
      ["Name", "Status", "Owner"],
      ["Alpha", "Done"],
    ]);
    expect(table).toBe(["| Name | Status | Owner |", "| --- | --- | --- |", "| Alpha | Done |  |"].join("\n"));
  });

  it("returns an empty string for no rows", () => {
    expect(csvToMarkdownTable([])).toBe("");
  });
});
