/**
 * A tag pinned beside the files in the pane's pinned block.
 *
 * A pinned file is a place to go. A pinned tag is a question kept on screen —
 * how much is still open across everything that carries it — so what its row
 * shows is the open tasks of every tagged note added together, and pressing it
 * lists those notes.
 *
 * Three rules decide what "tagged" means, and all three are Obsidian's own, so
 * the count agrees with what its tag search finds:
 *
 * **A note carries a tag wherever it writes it** — in its frontmatter or in its
 * text — and every task in the note counts, not only the tasks on a tagged line.
 *
 * **A tag includes the tags nested under it.** `#projekt` counts the notes
 * tagged `#projekt/alpha`, the way searching for it finds them.
 *
 * **Case does not matter.** `#Projekt` and `#projekt` are one tag.
 *
 * A note is counted once per row however often it writes the tag. The same note
 * appears in the row of every tag it carries, because it does belong to each of
 * them; nothing adds the rows together.
 */
import { tallyTasks, type TaskItem, type TaskTally } from "./task-count";

/**
 * How a tag is stored among the pane's paths.
 *
 * The pin shares `explorer.json` with files, so the key must never be a path a
 * file could have. Obsidian refuses a colon in any file or folder name, on every
 * platform, so nothing in a vault can be called this.
 */
export const TAG_PIN_PREFIX = "tag:";

/** The key a tag is pinned under, or null when it is not a tag at all. */
export function tagPinKey(raw: string): string | null {
  const tag = normalizeTag(raw);
  return tag === null ? null : `${TAG_PIN_PREFIX}${tag}`;
}

/** The tag a pinned key stands for, or null when the key is a path. */
export function tagFromPinKey(key: string): string | null {
  if (!key.startsWith(TAG_PIN_PREFIX)) return null;
  return normalizeTag(key.slice(TAG_PIN_PREFIX.length));
}

/**
 * A tag as it is written, without its `#`, or null when it is not one.
 *
 * What Obsidian accepts as a tag: no whitespace, no characters that end one,
 * no empty segment between slashes, and at least one character that is not a
 * digit — `#2026` is a heading of sorts in plenty of notes, never a tag.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#/, "");
  if (tag.length === 0) return null;
  if (/[\s#,;:!?"'()[\]{}<>|\\^`*=+&%$@~.]/.test(tag)) return null;
  if (tag.split("/").some((segment) => segment.length === 0)) return null;
  if (/^[0-9/]+$/.test(tag)) return null;
  return tag;
}

/** Whether a tag a note carries falls under a pinned tag. */
export function tagIncludes(pinned: string, carried: string): boolean {
  const outer = pinned.replace(/^#/, "").toLowerCase();
  const inner = carried.replace(/^#/, "").toLowerCase();
  return inner === outer || inner.startsWith(`${outer}/`);
}

/** One note, reduced to what a tag row asks of it. */
export interface TaggedNote {
  path: string;
  /** Every tag the note carries, with or without `#`, repeats allowed. */
  tags: readonly string[];
  items: readonly TaskItem[] | undefined;
}

/** Whether a note carries a tag, or one nested under it. */
export function noteHasTag(note: Pick<TaggedNote, "tags">, tag: string): boolean {
  return note.tags.some((carried) => tagIncludes(tag, carried));
}

/**
 * The tasks under each pinned tag, in one pass over the vault.
 *
 * The pane redraws on every metadata change, so this is asked often. Walking
 * the vault once for all the pinned tags, rather than once per tag, keeps a
 * block of pins as cheap as one.
 */
export function tallyTags(
  notes: Iterable<TaggedNote>,
  tags: readonly string[]
): Map<string, TaskTally> {
  const tallies = new Map<string, TaskTally>(tags.map((tag) => [tag, { open: 0, total: 0 }]));
  if (tags.length === 0) return tallies;

  for (const note of notes) {
    if (note.tags.length === 0) continue;
    const matched = tags.filter((tag) => noteHasTag(note, tag));
    if (matched.length === 0) continue;

    const own = tallyTasks(note.items);
    for (const tag of matched) {
      const tally = tallies.get(tag);
      if (!tally) continue;
      tally.open += own.open;
      tally.total += own.total;
    }
  }

  return tallies;
}

/** A tag the vault uses, as the picker offers it. */
export interface VaultTag {
  tag: string;
  /** How many notes carry it, nested tags included. */
  notes: number;
}

/**
 * Every tag worth offering, most used first.
 *
 * A nested tag brings its parents with it — `#projekt/alpha` offers `#projekt`
 * too — because pinning the parent is how a person counts a whole project. The
 * spelling offered is the first one met, since the vault has no canonical one.
 */
export function vaultTags(notes: Iterable<Pick<TaggedNote, "tags">>): VaultTag[] {
  const found = new Map<string, { tag: string; notes: number }>();

  for (const note of notes) {
    const seen = new Set<string>();
    for (const carried of note.tags) {
      const tag = normalizeTag(carried);
      if (tag === null) continue;

      const segments = tag.split("/");
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const prefix = segments.slice(0, depth).join("/");
        const key = prefix.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const entry = found.get(key);
        if (entry) entry.notes += 1;
        else found.set(key, { tag: prefix, notes: 1 });
      }
    }
  }

  return [...found.values()].sort(
    (a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" })
  );
}

/** A note as a card in the tag's list. */
export interface TagCard {
  path: string;
  title: string;
  /** The folder the note sits in, empty at the vault root. */
  folder: string;
  tally: TaskTally;
  modifiedAt: number;
}

/**
 * The order the cards come in: open work first, most of it at the top, then
 * whatever was touched last.
 *
 * A tag is pinned to see what is left to do, so a note with nothing open is
 * still listed — it carries the tag — but below every note that has something.
 */
export function sortTagCards(cards: readonly TagCard[]): TagCard[] {
  return [...cards].sort(
    (a, b) =>
      b.tally.open - a.tally.open ||
      b.modifiedAt - a.modifiedAt ||
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
}

/** The whole list's line under its heading: how many notes, how much open. */
export function summarizeTagCards(cards: readonly TagCard[]): { notes: number } & TaskTally {
  let open = 0;
  let total = 0;
  for (const card of cards) {
    open += card.tally.open;
    total += card.tally.total;
  }
  return { notes: cards.length, open, total };
}
