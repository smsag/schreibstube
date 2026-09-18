export interface MarkdownTable {
  header: string[];
  rows: string[][];
}

/** Column headers the parser has to invent (a key/value list has no header row). */
export interface TableLabels {
  name: string;
  value: string;
}

export const DEFAULT_TABLE_LABELS: TableLabels = { name: "Name", value: "Value" };

/** Placeholder for a cell the source text left empty. */
export const EMPTY_CELL = "–";

const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;
// A short label before the first colon; "://" rules out URLs.
const KEY_VALUE = /^([^:]{1,40}):(?!\/\/)(.*)$/;
const RGB_PATTERN = /rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi;
const HEX_PATTERN = /#[0-9a-f]{6}\b/gi;
// What may sit between colour values without carrying information of its own.
const COLOR_FILLER = /\b(?:or|and|oder|und)\b|[,;/]/gi;

/**
 * Convert a multi-line selection into a table without any guessing: the text
 * must be delimited (tab, semicolon, comma) or a "key: value" list. Returns
 * null when neither shape fits, so the caller can offer the LLM fallback.
 */
export function textToTable(
  text: string,
  labels: TableLabels = DEFAULT_TABLE_LABELS
): MarkdownTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(LIST_MARKER, ""))
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return null;
  }

  // Commas also occur inside "key: value" lines (e.g. RGB(84,190,247)), so
  // the key/value shape is tried before splitting on commas.
  return (
    parseDelimited(lines, "\t") ??
    parseDelimited(lines, ";") ??
    parseKeyValue(lines, labels) ??
    parseDelimited(lines, ",")
  );
}

/** Every line splits into the same number (>1) of cells; the first line is the header. */
function parseDelimited(lines: string[], delimiter: string): MarkdownTable | null {
  const [header, ...rows] = lines.map((line) => splitCells(line, delimiter));
  if (!header || header.length < 2 || !rows.every((row) => row.length === header.length)) {
    return null;
  }
  return { header, rows };
}

/** Split on the delimiter, but not inside double quotes or parentheses. */
function splitCells(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === "(") {
      depth++;
    } else if (!quoted && char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (!quoted && depth === 0 && char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);

  return cells.map((cell) =>
    cell
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim()
  );
}

function parseKeyValue(lines: string[], labels: TableLabels): MarkdownTable | null {
  const pairs: [string, string][] = [];
  for (const line of lines) {
    const [, rawKey, rawValue] = line.match(KEY_VALUE) ?? [];
    const key = rawKey?.trim();
    if (!key) {
      return null;
    }
    pairs.push([key, (rawValue ?? "").trim()]);
  }

  const colors = pairs.map(([, value]) => parseColors(value));
  if (colors.every((c) => c !== null) && colors.some((c) => c && (c.rgb.length || c.hex.length))) {
    return {
      header: [labels.name, "RGB", "Hex"],
      rows: pairs.map(([key], i) => {
        const { rgb, hex } = colors[i]!;
        return [key, rgb.join(", ") || EMPTY_CELL, hex.join(", ") || EMPTY_CELL];
      })
    };
  }

  return {
    header: [labels.name, labels.value],
    rows: pairs.map(([key, value]) => [key, value || EMPTY_CELL])
  };
}

/**
 * Read a value that holds nothing but colours. Returns null when anything
 * else is left over, so splitting into RGB/Hex columns never drops text.
 */
function parseColors(value: string): { rgb: string[]; hex: string[] } | null {
  const rgb = [...value.matchAll(RGB_PATTERN)].map(([, r, g, b]) => `RGB(${r}, ${g}, ${b})`);
  // Code spans keep Obsidian from reading "#FDA851" as a tag.
  const hex = [...value.matchAll(HEX_PATTERN)].map(([h]) => `\`${h.toUpperCase()}\``);

  const rest = value
    .replace(RGB_PATTERN, "")
    .replace(HEX_PATTERN, "")
    .replace(COLOR_FILLER, "")
    .trim();
  return rest ? null : { rgb, hex };
}

export function renderMarkdownTable({ header, rows }: MarkdownTable): string {
  const escape = (cell: string) => cell.replace(/\|/g, "\\|");
  const line = (cells: string[]) => `| ${cells.map(escape).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

/**
 * A table only renders when it is separated from surrounding text by blank
 * lines. Add them where the neighbouring line (null at the document edge)
 * is not already empty.
 */
export function padForInsertion(
  markdown: string,
  lineBefore: string | null,
  lineAfter: string | null
): string {
  const before = lineBefore?.trim() ? "\n" : "";
  const after = lineAfter?.trim() ? "\n" : "";
  return before + markdown + after;
}
