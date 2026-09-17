/**
 * What a check writes into a mirrored note's own frontmatter.
 *
 * A note bound to a source is a document, and a document has a name and a date
 * on which it last changed. Both belong in the note's frontmatter rather than
 * in the plugin's bookkeeping: there they are visible in Obsidian's properties,
 * searchable, usable in a Base, and they survive the plugin being removed.
 *
 * Two rules decide everything here, and both are about not trampling a person:
 *
 * **A title is written once.** It is taken from the document's first heading,
 * which is what the document calls itself, and it is never written again. Once
 * there is a title in the file it belongs to whoever put it there — a person
 * who renames a mirrored note in its frontmatter has said what they want it
 * called, and a check that overwrote that would be undoing their work on a
 * timer.
 *
 * **A date follows the source, not the checking.** `updatedAt` moves only when
 * the document at the other end actually changed, never on a check that found
 * it unchanged, and never on the first fetch — arriving is not changing.
 */
import { buildHeadingIndex } from "./heading-index";
import { frontmatterTitle } from "./note-title";

/** The keys a check maintains. Plain names, because other tools read them. */
export const SYNC_TITLE_KEY = "title";
export const SYNC_UPDATED_KEY = "updatedAt";

export interface SyncFrontmatterInput {
  /** The note's frontmatter as it stands, or undefined when it has none. */
  frontmatter: Record<string, unknown> | undefined;
  /** The source's body, or null when the check did not fetch one. */
  remoteBody: string | null;
  /** The note's own body, frontmatter already removed. */
  noteBody: string;
  /** Whether the source's content differs from what the last check saw. */
  remoteChanged: boolean;
  now: Date;
}

/** Only the keys that should be written. An empty plan means: touch nothing. */
export interface SyncFrontmatterPlan {
  title?: string;
  updatedAt?: string;
}

export function planSyncFrontmatter(input: SyncFrontmatterInput): SyncFrontmatterPlan {
  const plan: SyncFrontmatterPlan = {};

  // A title already there is the person's, whatever it says and whoever wrote
  // it first. Only a note that has none is given one.
  if (frontmatterTitle(input.frontmatter?.[SYNC_TITLE_KEY]) === null) {
    const title = firstHeading(input.remoteBody) ?? firstHeading(input.noteBody);
    if (title !== null) plan.title = title;
  }

  if (input.remoteChanged) {
    plan.updatedAt = formatUpdatedAt(input.now);
  }

  return plan;
}

/**
 * The document's own name: its first level-one heading.
 *
 * Read through the same index the heading stack uses, so a `#` inside a code
 * fence is not mistaken for a title and the formatting around one — a link, an
 * emphasis, a piece of code — is stripped the same way.
 */
export function firstHeading(markdown: string | null): string | null {
  if (!markdown) return null;

  const heading = buildHeadingIndex(markdown).find((entry) => entry.level === 1);
  if (!heading) return null;

  // A README often puts its logo in the heading as an inline `<img>`, and the
  // tag is not part of what the document is called. It was written into the
  // title as it stood.
  const text = heading.text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * A date and time Obsidian reads as one.
 *
 * Its datetime property is local and unzoned, `YYYY-MM-DDTHH:mm:ss`, which also
 * sorts correctly as plain text — so a Base can order by it without anything
 * having to parse it first.
 */
export function formatUpdatedAt(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** An edit to the note's text: replace `from`..`to` with `text`. */
export interface FrontmatterEdit {
  from: number;
  to: number;
  text: string;
}

/**
 * The plan written into the note's own text rather than into the file on disk.
 *
 * A note open in an editor has two copies, the editor's and the file's, and
 * `processFrontMatter` writes only the file. Obsidian then merges the file into
 * the editor, and that merge drops whatever it cannot place without saying so.
 * A first sync put the properties on disk and offered the whole document as a
 * card; accepting it filled the editor, the merge could not fit a document's
 * worth of text against frontmatter that had changed underneath it, and the
 * note was left as it was on disk — properties and nothing else. Written into
 * the editor there is only one copy, and the editor saves it.
 *
 * Only the two keys a check maintains are touched, one line each, so the rest
 * of the block keeps its spelling. Null when the note has no frontmatter block
 * to write into, or a key holds a value spread over several lines; the caller
 * then falls back to Obsidian's own writer.
 */
export function planFrontmatterEdit(
  noteText: string,
  plan: SyncFrontmatterPlan
): FrontmatterEdit | null {
  const lines = noteText.split("\n");
  if (lines[0]?.trim() !== "---") return null;

  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close === -1) return null;

  const block = lines.slice(1, close);
  const entries: [string, string | undefined][] = [
    [SYNC_TITLE_KEY, plan.title],
    [SYNC_UPDATED_KEY, plan.updatedAt]
  ];

  for (const [key, value] of entries) {
    if (value === undefined) continue;

    const line = `${key}: ${yamlScalar(value)}`;
    const at = block.findIndex((entry) => new RegExp(`^${key}\\s*:`).test(entry));
    if (at === -1) {
      block.push(line);
      continue;
    }

    // A value continued on the lines below is a list or a folded block, and
    // one line cannot stand in for it without losing what it says.
    const next = block[at + 1];
    if (next !== undefined && /^\s/.test(next)) return null;

    // The title is written once. A line the metadata cache has not caught up
    // with yet is still the person's title if it says anything.
    const existing = block[at]?.replace(/^[^:]*:/, "").trim() ?? "";
    if (key === SYNC_TITLE_KEY && existing.length > 0) continue;

    block[at] = line;
  }

  const head = lines.slice(0, close + 1).join("\n");
  const text = ["---", ...block, "---"].join("\n");
  return text === head ? null : { from: 0, to: head.length, text };
}

/**
 * A value as YAML reads it back unchanged.
 *
 * Plain where that is safe, which is how Obsidian writes a date; double-quoted
 * otherwise, and a JSON string is a valid double-quoted YAML scalar.
 */
function yamlScalar(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return value;

  const plain =
    /^[\p{L}\p{N}][\p{L}\p{N} ._()'’,&+/-]*$/u.test(value) &&
    !/\s$/.test(value) &&
    !/^(true|false|yes|no|on|off|null|~|[-+]?[\d._]+(e[-+]?\d+)?)$/i.test(value);
  return plain ? value : JSON.stringify(value);
}
