/**
 * The `source:` of a `csvtable` block, carried along when its file moves.
 *
 * The block belongs to another plugin, which reads the path from the vault's
 * root and never looks at it again: Obsidian rewrites links on a rename, not
 * paths inside a code block, so a renamed export used to leave every table
 * that showed it as an error. Only the path is touched; the rest of the block,
 * its quoting and a comment after the path stay as written.
 */
import { fenceLanguage, fenceMarker } from "./markdown-fence";

export const CSVTABLE_LANGUAGE = "csvtable";

/** A cheap first look before a note is read line by line. */
export function mentionsCsvTable(markdown: string): boolean {
  return markdown.toLowerCase().includes(CSVTABLE_LANGUAGE);
}

/**
 * A path as the other plugin resolves it: Obsidian's own normalising, then
 * any leading `./`, which a person writes and the vault root does not need.
 */
export function normalizeSourcePath(source: string): string {
  const path = source
    .replace(/[\\/]+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\u00a0|\u202f/g, " ")
    .normalize("NFC");
  return path.replace(/^(\.\/)+/, "");
}

type Quoting = "plain" | "single" | "double";

interface SourceLine {
  before: string;
  value: string;
  quoting: Quoting;
  after: string;
}

/** The parts of a `source:` line, or null for any other line or a value YAML spreads over lines. */
function readSourceLine(line: string): SourceLine | null {
  const head = /^(\s*source\s*:[ \t]*)/.exec(line);
  if (!head) return null;
  const before = head[1]!;
  const rest = line.slice(before.length);

  if (rest.startsWith('"')) {
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
    if (!quoted) return null;
    const value = quoted[1]!.replace(/\\(["\\])/g, "$1");
    return { before, value, quoting: "double", after: rest.slice(quoted[0].length) };
  }
  if (rest.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'/.exec(rest);
    if (!quoted) return null;
    const value = quoted[1]!.replace(/''/g, "'");
    return { before, value, quoting: "single", after: rest.slice(quoted[0].length) };
  }

  // A `#` starts a comment only after a space; `Q#3.csv` is a name.
  const comment = rest.search(/\s#/);
  const value = (comment === -1 ? rest : rest.slice(0, comment)).trimEnd();
  if (value === "" || /^[|>]/.test(value)) return null;
  return { before, value, quoting: "plain", after: rest.slice(value.length) };
}

/** A path YAML would read as something else when written bare. */
function needsQuotes(path: string): boolean {
  return /^[\s'"!&*#|>%@`{[\]},?:-]|:\s|\s#|:$|\s$/.test(path);
}

function writeValue(path: string, quoting: Quoting): string {
  const as = quoting === "plain" && needsQuotes(path) ? "double" : quoting;
  if (as === "single") return `'${path.replace(/'/g, "''")}'`;
  if (as === "double") return `"${path.replace(/["\\]/g, "\\$&")}"`;
  return path;
}

/**
 * The note with every `csvtable` block's source moved, and how many moved.
 * `moved` answers the path a file is at now for the path it was at, or null
 * for a file that stayed. Only the first `source:` of a block counts, as only
 * the first counts to the parser reading it.
 */
export function retargetCsvTableSources(
  markdown: string,
  moved: (path: string) => string | null
): { text: string; changed: number } {
  const lines = markdown.split("\n");
  let changed = 0;
  let fence: string | null = null;
  let inTable = false;
  let sourceSeen = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const marker = fenceMarker(line);

    if (fence === null) {
      if (!marker) continue;
      fence = marker;
      inTable = fenceLanguage(line, marker) === CSVTABLE_LANGUAGE;
      sourceSeen = false;
      continue;
    }
    // Closed as `fencedLines` closes a fence, so both agree where a block ends.
    if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null;
      continue;
    }
    if (!inTable || sourceSeen) continue;

    const source = readSourceLine(line);
    if (!source) continue;
    sourceSeen = true;
    const next = moved(normalizeSourcePath(source.value));
    if (next === null) continue;
    lines[index] = `${source.before}${writeValue(next, source.quoting)}${source.after}`;
    changed++;
  }

  return { text: changed > 0 ? lines.join("\n") : markdown, changed };
}
