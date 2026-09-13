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
  return heading ? heading.text : null;
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
