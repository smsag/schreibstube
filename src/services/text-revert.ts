/**
 * Taking back one change to a note's text after the note has moved on.
 *
 * A notice offers the undo for half a minute, and in that time the person
 * may type elsewhere in the note. Restoring the whole text as it was would
 * throw that typing away, so only the stretch the change touched is put back,
 * found again by its own lines and the line either side of it. When that
 * stretch was itself edited, or appears twice, there is no telling which
 * text is meant, and nothing is put back.
 */

/** One replacement in a text, by character offsets into it. */
export interface TextEdit {
  from: number;
  to: number;
  text: string;
}

/** The single, smallest replacement that turns `from` into `to`. */
export function smallestEdit(from: string, to: string): TextEdit {
  let prefix = 0;
  const limit = Math.min(from.length, to.length);
  while (prefix < limit && from.charCodeAt(prefix) === to.charCodeAt(prefix)) prefix += 1;
  // Never between the two halves of a character outside the BMP.
  if (prefix > 0 && isHighSurrogate(from.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  const room = limit - prefix;
  while (
    suffix < room &&
    from.charCodeAt(from.length - 1 - suffix) === to.charCodeAt(to.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(from.charCodeAt(from.length - suffix))) suffix -= 1;

  return { from: prefix, to: from.length - suffix, text: to.slice(prefix, to.length - suffix) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.text + text.slice(edit.to);
}

/**
 * The edit that takes `current` back from `after` to `before` in the lines the
 * change touched, keeping every other edit made since. Null when those lines
 * cannot be found exactly once.
 */
export function revertEdit(current: string, before: string, after: string): TextEdit | null {
  if (current === after) return smallestEdit(after, before);

  const old = before.split("\n");
  const changed = after.split("\n");
  let prefix = 0;
  while (prefix < Math.min(old.length, changed.length) && old[prefix] === changed[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < Math.min(old.length, changed.length) - prefix &&
    old[old.length - 1 - suffix] === changed[changed.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  // The changed lines with one unchanged line either side, or the edge of
  // the note when there is none: that is what has to be found again.
  const anchoredStart = prefix > 0;
  const anchoredEnd = suffix > 0;
  const needle = changed.slice(
    anchoredStart ? prefix - 1 : 0,
    anchoredEnd ? changed.length - suffix + 1 : changed.length
  );
  const restored = old.slice(prefix, old.length - suffix);

  const lines = current.split("\n");
  const matches: number[] = [];
  for (let at = 0; at + needle.length <= lines.length; at += 1) {
    if (!anchoredStart && at > 0) break;
    if (!anchoredEnd && at + needle.length !== lines.length) continue;
    if (needle.every((line, i) => lines[at + i] === line)) matches.push(at);
  }
  const at = matches.length === 1 ? matches[0] : undefined;
  if (at === undefined) return null;

  const start = at + (anchoredStart ? 1 : 0);
  const end = at + needle.length - (anchoredEnd ? 1 : 0);
  const next = [...lines.slice(0, start), ...restored, ...lines.slice(end)].join("\n");
  return smallestEdit(current, next);
}
