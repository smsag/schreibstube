import { neutralizeIntroducedCode } from "./foreign-text";
import { EMPTY_CELL, renderMarkdownTable, type MarkdownTable } from "./text-to-table";

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
  // A line break would end the table row.
  return cellText(value)
    .replace(/\s*\r?\n\s*/g, " ")
    .trim();
}

/**
 * A model's cell as text. The prompt asks for strings; a model that answers
 * with a number or a flag is read as it meant, and one that answers with a
 * list or an object gets it written as JSON rather than as `[object Object]`.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    // Undefined for a function or a symbol, whatever its declared type says.
    const json = JSON.stringify(value) as string | undefined;
    return json ?? "";
  } catch {
    return "";
  }
}

/**
 * The table with code the selection did not hold disarmed in every cell, and
 * which kinds were.
 *
 * The model is told to keep code in a cell as written, which is right for the
 * selection's own and a way in for anyone else's: an inline `$=` span or a
 * Templater tag in a cell runs like one anywhere else in the note. A tag can
 * also be opened in one cell and closed in the next, since Templater reads
 * the note's text and not its table; when the rendered table still holds code
 * the cells did not, every opener in it is disarmed.
 */
export function guardTableCode(
  table: MarkdownTable,
  source: string
): { table: MarkdownTable; kinds: string[] } {
  const kinds = new Set<string>();
  const guard = (cell: string): string => {
    const result = neutralizeIntroducedCode(source, cell);
    for (const kind of result.kinds) kinds.add(kind);
    return result.text;
  };
  const guarded = {
    header: table.header.map(guard),
    rows: table.rows.map((row) => row.map(guard))
  };

  const across = neutralizeIntroducedCode(source, renderMarkdownTable(guarded)).kinds;
  if (across.length === 0) return { table: guarded, kinds: [...kinds] };

  for (const kind of across) kinds.add(kind);
  const strict = (cell: string): string => cell.replace(/<%/g, "&lt;%").replace(/`/g, "&#96;");
  return {
    table: { header: guarded.header.map(strict), rows: guarded.rows.map((row) => row.map(strict)) },
    kinds: [...kinds]
  };
}
