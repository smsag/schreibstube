/**
 * Reads a glossary note into the concept-oriented model TBX-Basic defines.
 *
 * A glossary is authored as an ordinary Markdown note so it renders and edits
 * inside Obsidian, but its semantics are the standard's, not an invention:
 * one concept groups several terms, and each term carries an administrative
 * status (preferred, admitted, deprecated, superseded). A forbidden term with
 * no replacement is therefore not a special case, it is a deprecated term in a
 * concept that has no preferred term.
 *
 * Parsing is deliberately tolerant. A malformed row is skipped and reported,
 * never fatal, because a half-written glossary should still check the terms it
 * already defines.
 */

import { fencedLines } from "./markdown-fence";

export type TermStatus = "preferred" | "admitted" | "deprecated" | "superseded";
export type MatchMode = "word" | "exact" | "prefix";
export type Severity = "suggestion" | "warning" | "error";

export interface GlossaryTerm {
  text: string;
  status: TermStatus;
  match: MatchMode;
  note: string;
}

export interface GlossaryConcept {
  id: string;
  terms: GlossaryTerm[];
}

export interface Glossary {
  /** Vault path of the note this came from; also the display name. */
  path: string;
  /** ISO-ish language code driving inflection tolerance. */
  language: string;
  defaultSeverity: Severity;
  concepts: GlossaryConcept[];
}

export interface GlossaryParseResult {
  glossary: Glossary;
  /** Human-readable problems, surfaced as one card per file. */
  errors: string[];
}

/**
 * Frontmatter keys the plugin reads inside a glossary note.
 *
 * Every key is prefixed, with no exceptions for keys that only appear in a
 * glossary note. Obsidian frontmatter is one flat namespace shared with every
 * other plugin and with the user's own properties, and a bare `language` is
 * exactly the kind of name something else will claim.
 */
export const GLOSSARY_MARKER = "schreibstubeGlossary";
export const GLOSSARY_LANGUAGE_KEY = "schreibstubeLanguage";
export const GLOSSARY_SEVERITY_KEY = "schreibstubeDefaultSeverity";

const STATUS_VALUES = new Set<TermStatus>(["preferred", "admitted", "deprecated", "superseded"]);

/** TBX-Basic picklist identifiers and the informal spellings that appear in
 *  exports from termbase tools, all folded onto the four canonical values. */
const STATUS_ALIASES: Record<string, TermStatus> = {
  "preferredterm-admn-sts": "preferred",
  "admittedterm-admn-sts": "admitted",
  "deprecatedterm-admn-sts": "deprecated",
  "supersededterm-admn-sts": "superseded",
  notrecommended: "deprecated",
  obsolete: "superseded",
  deprecated: "deprecated",
  preferred: "preferred",
  admitted: "admitted",
  superseded: "superseded"
};

const MATCH_VALUES = new Set<MatchMode>(["word", "exact", "prefix"]);
const SEVERITY_VALUES = new Set<Severity>(["suggestion", "warning", "error"]);

const REQUIRED_COLUMNS = ["concept", "term", "status"] as const;

export const DEFAULT_GLOSSARY_LANGUAGE = "de";
export const DEFAULT_GLOSSARY_SEVERITY: Severity = "warning";

/** True when a note declares itself a glossary in its frontmatter. Used to
 *  populate the picker without imposing a folder convention. */
export function isGlossaryNote(text: string): boolean {
  const frontmatter = readFrontmatter(text);
  const value = frontmatter.get(GLOSSARY_MARKER);
  return value === "true" || value === "yes";
}

export function parseGlossary(path: string, text: string): GlossaryParseResult {
  const errors: string[] = [];
  const frontmatter = readFrontmatter(text);

  const language =
    frontmatter.get(GLOSSARY_LANGUAGE_KEY)?.toLowerCase() || DEFAULT_GLOSSARY_LANGUAGE;
  const severityRaw = frontmatter.get(GLOSSARY_SEVERITY_KEY)?.toLowerCase() ?? "";
  const defaultSeverity = SEVERITY_VALUES.has(severityRaw as Severity)
    ? (severityRaw as Severity)
    : DEFAULT_GLOSSARY_SEVERITY;
  if (severityRaw && !SEVERITY_VALUES.has(severityRaw as Severity)) {
    errors.push(
      `Unknown ${GLOSSARY_SEVERITY_KEY} "${severityRaw}", using ${DEFAULT_GLOSSARY_SEVERITY}.`
    );
  }

  const rows = readTableRows(text);
  const [headerRow] = rows;
  if (headerRow === undefined) {
    errors.push("No term table found.");
    return { glossary: emptyGlossary(path, language, defaultSeverity), errors };
  }

  const columns = indexColumns(headerRow.cells);
  const missing = REQUIRED_COLUMNS.filter((name) => columns[name] === undefined);
  if (missing.length > 0) {
    errors.push(`Missing required column(s): ${missing.join(", ")}.`);
    return { glossary: emptyGlossary(path, language, defaultSeverity), errors };
  }

  const byConcept = new Map<string, GlossaryTerm[]>();

  rows.slice(1).forEach(({ cells, line }) => {
    const lineLabel = `line ${line}`;

    if (isSeparatorRow(cells)) {
      return;
    }

    const conceptId = cells[columns.concept as number]?.trim() ?? "";
    const termText = cells[columns.term as number]?.trim() ?? "";
    const statusRaw = cells[columns.status as number]?.trim() ?? "";

    if (!conceptId && !termText && !statusRaw) {
      return;
    }
    if (!conceptId || !termText) {
      errors.push(`Skipped ${lineLabel}: concept and term are required.`);
      return;
    }

    const status = STATUS_ALIASES[statusRaw.toLowerCase()];
    if (!status || !STATUS_VALUES.has(status)) {
      errors.push(`Skipped ${lineLabel}: unknown status "${statusRaw}".`);
      return;
    }

    const matchRaw = (columns.match !== undefined ? cells[columns.match] : "")
      ?.trim()
      .toLowerCase();
    let match: MatchMode = "word";
    if (matchRaw) {
      if (MATCH_VALUES.has(matchRaw as MatchMode)) {
        match = matchRaw as MatchMode;
      } else {
        errors.push(`${lineLabel}: unknown match mode "${matchRaw}", using word.`);
      }
    }

    const note = (columns.note !== undefined ? cells[columns.note] : "")?.trim() ?? "";

    const terms = byConcept.get(conceptId) ?? [];
    // Case folding is the right duplicate test for the case-insensitive match
    // modes, but under `exact` two spellings of one word are separate entries
    // on purpose (GmbH as preferred, gmbh as deprecated).
    const isDuplicate = terms.some((t) =>
      t.match === "exact" || match === "exact"
        ? t.text === termText
        : t.text.toLowerCase() === termText.toLowerCase()
    );
    if (isDuplicate) {
      errors.push(
        `Skipped ${lineLabel}: "${termText}" is already defined in concept "${conceptId}".`
      );
      return;
    }
    terms.push({ text: termText, status, match, note });
    byConcept.set(conceptId, terms);
  });

  const concepts: GlossaryConcept[] = [];
  for (const [id, terms] of byConcept) {
    const preferred = terms.filter((t) => t.status === "preferred");
    if (preferred.length > 1) {
      errors.push(
        `Concept "${id}" has ${preferred.length} preferred terms; only the first is used.`
      );
    }
    concepts.push({ id, terms });
  }

  return {
    glossary: { path, language, defaultSeverity, concepts },
    errors
  };
}

/** The preferred term of a concept, or null when the concept only forbids. */
export function preferredTerm(concept: GlossaryConcept): string | null {
  return concept.terms.find((t) => t.status === "preferred")?.text ?? null;
}

function emptyGlossary(path: string, language: string, defaultSeverity: Severity): Glossary {
  return { path, language, defaultSeverity, concepts: [] };
}

/** Minimal frontmatter reader: flat `key: value` pairs only, which is all the
 *  glossary header needs. Avoids pulling in a YAML parser. Keys are kept
 *  verbatim, since the plugin's own keys are camelCase. */
function readFrontmatter(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return result;
  }

  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) result.set(key, value);
  }

  return result;
}

/**
 * Cells of the note's first pipe table, with the line each row came from.
 *
 * The first table and not every `|` line in the note: a glossary note with a
 * second table below it — a changelog, a list of examples — had that table's
 * rows read as terms, and a `|` inside a fenced block with it. The table ends
 * where the pipes stop, which is how Markdown ends one.
 *
 * The line number travels with the row because it is what a person can act
 * on. A message naming "row 2" for the first row of the table (the separator
 * counts, to the code and to nobody else) sent them to the wrong line.
 */
function readTableRows(text: string): TableRow[] {
  const lines = text.split("\n");
  const fenced = fencedLines(lines);
  const rows: TableRow[] = [];

  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    const trimmed = line.trim();

    if (!trimmed.startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }

    rows.push({ cells: splitRow(trimmed), line: index + 1 });
  }

  return rows;
}

/** One table row: its cells, and the note line it was written on. */
interface TableRow {
  cells: string[];
  line: number;
}

function splitRow(line: string): string[] {
  const inner = line.replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

type ColumnIndex = Partial<Record<"concept" | "term" | "status" | "match" | "note", number>>;

/** Map header labels to column positions, accepting German headers so a
 *  glossary can be authored in the language it governs. */
function indexColumns(header: string[]): ColumnIndex {
  const aliases: Record<string, keyof ColumnIndex> = {
    concept: "concept",
    konzept: "concept",
    begriff: "concept",
    term: "term",
    benennung: "term",
    status: "status",
    match: "match",
    treffer: "match",
    note: "note",
    notiz: "note",
    hinweis: "note"
  };

  const columns: ColumnIndex = {};
  header.forEach((label, index) => {
    const key = aliases[label.trim().toLowerCase()];
    if (key && columns[key] === undefined) {
      columns[key] = index;
    }
  });
  return columns;
}
