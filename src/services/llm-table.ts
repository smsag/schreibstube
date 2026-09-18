import { EMPTY_CELL, type MarkdownTable } from "./text-to-table";

/** Room for a table of a few dozen rows; a reply cut off by the limit fails to parse. */
export const TABLE_MAX_TOKENS = 4096;

/** Longer selections would not fit the reply budget above. */
export const TABLE_MAX_INPUT_CHARS = 8000;

export const TABLE_SYSTEM_PROMPT =
  `You convert unstructured text into a table. Rules:\n` +
  `- Choose meaningful columns from the structure of the text\n` +
  `- Use only information from the text; never invent, complete or correct values\n` +
  `- Leave a cell empty if the text has no value for it\n` +
  `- Keep the language of the text, including for column headers\n` +
  `- Keep Markdown formatting inside a cell (links, emphasis, code) as written\n` +
  `- Respond with JSON only: {"header": string[], "rows": string[][]}`;

/**
 * Recover and validate the table from a model reply. Returns null when the
 * reply is not a usable table, so the caller never inserts garbage.
 */
export function parseTableResponse(raw: string): MarkdownTable | null {
  // Models sometimes wrap the JSON in a code fence or a sentence of prose.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  const { header, rows } = (parsed ?? {}) as { header?: unknown; rows?: unknown };
  if (!Array.isArray(header) || header.length < 2 || !Array.isArray(rows)) {
    return null;
  }
  const validRows = rows.filter((row): row is unknown[] => Array.isArray(row));
  if (validRows.length === 0) {
    return null;
  }

  const width = header.length;
  return {
    header: header.map((cell) => toCell(cell) || " "),
    // Pad or trim ragged rows instead of rejecting the whole answer.
    rows: validRows.map((row) =>
      Array.from({ length: width }, (_, i) => toCell(row[i]) || EMPTY_CELL)
    )
  };
}

function toCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  // A line break would end the table row.
  return String(value).replace(/\s*\r?\n\s*/g, " ").trim();
}
