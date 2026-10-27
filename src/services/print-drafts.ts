/**
 * Working notes a writer leaves in a draft, which a print leaves out.
 *
 * A comment is the way to keep a note to oneself, and printing drops it. This
 * is the backup for the two other ways people write one anyway: a `[TODO: …]`
 * in the running text, and a `> [!todo]` box. Either one on paper hands a
 * reader a question meant for the writer, so both go, and the print says how
 * many went: the writer still has to see that something was open.
 */
import { fencedLines } from "./markdown-fence";

/** The callout kind that holds a working note rather than part of the text. */
const DRAFT_CALLOUT = "todo";

/**
 * Upper case only: "[Prüfen Sie …]" or "[todo list]" can be prose, an
 * all-capitals word in brackets is a flag.
 */
const MARKER_WORDS = "TODO|TBD|FIXME|PRÜFEN";

/**
 * A marker in brackets of its own. Not a link's text, `[TODO](…)` or
 * `[TODO][ref]`, not a reference definition, and not a wikilink, whose name
 * may well start with the word.
 */
const BARE_MARKER = new RegExp(
  `[ \\t]*(?<![\\[\\\\])\\[(?:${MARKER_WORDS})\\b[^\\]\\n]*\\](?![(\\[:\\]])`,
  "gu"
);

/** A code span that holds nothing but a marker, as an article quotes one. */
const SPAN_MARKER = new RegExp(`^\\[(?:${MARKER_WORDS})\\b[^\\]\\n]*\\]$`, "u");

export function isDraftCallout(kind: string | undefined): boolean {
  return kind?.toLowerCase() === DRAFT_CALLOUT;
}

/**
 * The note without its `[TODO …]` markers, and how many there were.
 *
 * Outside fenced blocks and inside code spans only when the span is the marker
 * and nothing else: code that mentions `[TODO]` is about markers, not one. A
 * line that was nothing but markers leaves no blank behind, as a comment does.
 */
export function stripDraftMarkers(source: string): { text: string; markers: number } {
  const lines = source.split("\n");
  const fenced = fencedLines(lines);
  let markers = 0;
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) {
      out.push(line);
      continue;
    }
    const stripped = stripLine(line);
    markers += stripped.markers;
    if (stripped.markers > 0 && stripped.text.trim() === "") continue;
    out.push(stripped.text);
  }
  return { text: out.join("\n"), markers };
}

function stripLine(line: string): { text: string; markers: number } {
  let markers = 0;
  const prose = (text: string): string =>
    text.replace(BARE_MARKER, () => {
      markers += 1;
      return "";
    });

  let text = "";
  let at = 0;
  while (at < line.length) {
    const open = line.indexOf("`", at);
    if (open === -1) {
      text += prose(line.slice(at));
      break;
    }
    const run = runAt(line, open);
    const close = closingRun(line, run, open + run);
    if (close === -1) {
      // Backticks without their match are characters, and the text goes on.
      text += prose(line.slice(at, open + run));
      at = open + run;
      continue;
    }
    const before = prose(line.slice(at, open));
    if (SPAN_MARKER.test(line.slice(open + run, close).trim())) {
      markers += 1;
      text += before.replace(/[ \t]+$/, "");
    } else {
      text += before + line.slice(open, close + run);
    }
    at = close + run;
  }
  return { text, markers };
}

/** How many backticks stand in a row from `at`. */
function runAt(line: string, at: number): number {
  let end = at;
  while (line[end] === "`") end += 1;
  return end - at;
}

/** Where a run of exactly `length` backticks starts, from `from` on, or -1. */
function closingRun(line: string, length: number, from: number): number {
  let at = line.indexOf("`", from);
  while (at !== -1) {
    const run = runAt(line, at);
    if (run === length) return at;
    at = line.indexOf("`", at + run);
  }
  return -1;
}
