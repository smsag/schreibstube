/**
 * Text somebody else wrote, made safe to stand in a note.
 *
 * A note is not a neutral container. Obsidian renders an embed, raw HTML and
 * a remote image the moment the note is shown, and other plugins run code
 * the note holds: Dataview a `dataviewjs` fence or an inline `$=` span,
 * Templater a `<% %>` tag, JS Engine, Datacore, Meta Bind and Buttons their
 * own blocks, all with Obsidian's rights, which on a desktop are the
 * machine's. Mail, a file name from a mail, a model's answer: each arrives
 * here from outside, and each went through its own escaper, which is how one
 * of them came to block the embed and let the code through.
 *
 * Two readings, because there are two kinds of foreign text. Text that is
 * meant to be read as written — a mail body, a sender, a file name — has
 * every sequence that could build something escaped. Markdown a model wrote
 * at a person's request keeps its formatting, and only the constructs that
 * run are disarmed, and only those the person's own text did not already
 * hold: a summary of a note about Dataview may quote the query it was given.
 *
 * Escaped rather than stripped, and with entities rather than backslashes
 * where it matters: a backslash the sender typed in front of an escaping
 * backslash would cancel it, and an entity cannot be cancelled that way.
 */

import { findExecutableCode, type ExecutableRegion } from "./executable-code";

/**
 * Text written by someone else, escaped so that it shows and builds nothing.
 *
 * A wikilink or an embed would render a vault file of the sender's choosing;
 * a tag opener, a comment or a processing instruction would be raw HTML; a
 * backtick could open an inline span Dataview runs, and a run of three
 * backticks or tildes a fence it runs; `<%` is a Templater command and `%%`
 * an Obsidian comment that hides the rest of the note. An address in angle
 * brackets is not a tag — a tag name ends at a space, a slash or the closing
 * bracket — and stays as written, as does a lone `<` or `%`.
 *
 * Line endings are made `\n` first: a bare carriage return is a line break to
 * Obsidian and none to a caller splitting on `\n`, which is how a quoted line
 * could leave its quote.
 */
export function escapeForeignText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/!?\[\[|!\[/g, (match) => match.replace(/\[/g, "\\["))
    .replace(/<(?=[!?%]|\/?[a-z][a-z0-9-]*(?:[\s/>]|$))/gi, "&lt;")
    .replace(/`/g, "&#96;")
    .replace(/~(?=~~)/g, "&#126;")
    .replace(/%%/g, "%&#37;");
}

/**
 * One line of somebody else's text, escaped as above.
 *
 * A subject, a sender or a file name may hold newlines, and one written into
 * a heading or a list item takes the rest of the note's structure with it:
 * everything after the first line lands outside as Markdown of the sender's
 * choosing. A bound keeps a name chosen to be enormous from becoming a page.
 */
export function foreignLine(text: string, maxChars = Infinity): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  const cut = chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join("")}…` : flat;
  return escapeForeignText(cut);
}

/** Markdown with its executing constructs disarmed, and which kinds were. */
export interface NeutralizedText {
  text: string;
  kinds: string[];
}

/**
 * Markdown a model wrote, with every executing construct `source` did not
 * already hold disarmed.
 *
 * A construct counts as already there when `source` holds one with exactly
 * the same text: a summary that repeats the query it was asked about is
 * repeating the person's own code, and one that writes a new query is not.
 *
 * A fence keeps its body and is relabelled `text`, so it is shown instead of
 * run and the language it claimed stays readable after the label. An inline
 * span loses its backticks to entities and reads the same; a Templater tag
 * loses its opener to `&lt;`.
 */
export function neutralizeIntroducedCode(source: string, output: string): NeutralizedText {
  const introduced = introducedRegions(source, output);
  return { text: disarm(output, introduced), kinds: kindsOf(introduced) };
}

/** The kinds of executing construct `output` holds that `source` did not, word for word. */
export function introducedCodeKinds(source: string, output: string): string[] {
  return kindsOf(introducedRegions(source, output));
}

function introducedRegions(source: string, output: string): ExecutableRegion[] {
  const known = new Set(
    findExecutableCode(source).map((region) => source.slice(region.from, region.to))
  );
  return findExecutableCode(output).filter(
    (region) => !known.has(output.slice(region.from, region.to))
  );
}

function kindsOf(regions: readonly ExecutableRegion[]): string[] {
  return [...new Set(regions.map((region) => region.kind))];
}

/** Every executing construct in `text` disarmed: nothing in it is the reader's own. */
export function neutralizeExecutableCode(text: string): NeutralizedText {
  return neutralizeIntroducedCode("", text);
}

/** A change at one offset: `length` characters there become `insert`. */
interface PointEdit {
  at: number;
  length: number;
  insert: string;
}

/**
 * Each region is disarmed at one or two points rather than rewritten whole,
 * because regions may nest — a Templater tag inside an inline span — and
 * rewriting the outer one must not leave the inner one live.
 */
function disarm(text: string, regions: readonly ExecutableRegion[]): string {
  const edits = regions.flatMap((region) => disarmEdits(text, region));
  edits.sort((a, b) => a.at - b.at);

  let out = "";
  let at = 0;
  for (const edit of edits) {
    if (edit.at < at) continue;
    out += text.slice(at, edit.at) + edit.insert;
    at = edit.at + edit.length;
  }
  return out + text.slice(at);
}

function disarmEdits(text: string, region: ExecutableRegion): PointEdit[] {
  const code = text.slice(region.from, region.to);
  if (code.startsWith("<%")) return [{ at: region.from, length: 1, insert: "&lt;" }];

  const fence = /^[ \t]*([`~])\1{2,}[ \t]*/.exec(code);
  if (fence)
    return [{ at: region.from, length: fence[0].length, insert: `${fence[0].trimEnd()}text ` }];

  // An inline span: its two backticks, and nothing between them.
  return [
    { at: region.from, length: 1, insert: "&#96;" },
    { at: region.to - 1, length: 1, insert: "&#96;" }
  ];
}
