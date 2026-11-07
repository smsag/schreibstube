/**
 * The ```schreibstube-home``` block: the sections of a start page that a base
 * cannot draw.
 *
 * A base lists notes by what their properties say. It cannot list the
 * bookmarks file, the notes a source changed, or buttons that make something
 * new — and those are what a start page is for, beside the base of what
 * changed last. So the block names them, one section per line, in the order
 * they are drawn:
 *
 *     actions
 *     bookmarks
 *     updated 5
 *     due 10
 *
 * A number after a section caps its rows; words after `actions` pick which
 * buttons it shows. An empty block shows every section. A line the block
 * does not understand is reported under it, by number, rather than dropped:
 * unlike the bookmarks file, this block is short and written to be read
 * back, and a section that silently does not appear looks like a bug.
 */
import type { Bookmark } from "./bookmark-file";
import { dueLabel, type DueDate, type DueLabel } from "./due-date";

export const HOME_LANGUAGE = "schreibstube-home";

export const HOME_SECTION_KINDS = ["actions", "bookmarks", "updated", "due"] as const;
export type HomeSectionKind = (typeof HOME_SECTION_KINDS)[number];

/**
 * The buttons `actions` can show: the four Obsidian puts on an empty tab,
 * since the start page takes that tab's place.
 */
export const HOME_ACTIONS = ["new-note", "go-to-file", "new-base", "new-canvas"] as const;
export type HomeAction = (typeof HOME_ACTIONS)[number];

/**
 * The Obsidian command each button runs, when it is not the plugin's own. A
 * button whose command is not registered — a core plugin turned off — is not
 * drawn, rather than drawn to do nothing.
 */
export const HOME_ACTION_COMMANDS: Readonly<Record<Exclude<HomeAction, "new-note">, string>> = {
  "go-to-file": "switcher:open",
  "new-base": "bases:new-file",
  "new-canvas": "canvas:new-file"
};

/** Rows a section shows when its line names no number: one phone screen of them. */
export const DEFAULT_HOME_LIMIT = 8;

/** More rows than a start page is for; a larger number is read as this. */
export const MAX_HOME_LIMIT = 50;

/** More sections than a page has room for; the lines after them are not read. */
export const MAX_HOME_SECTIONS = 12;

/** A block is a few short lines. Past this it is a paste, and only this much is read. */
export const MAX_HOME_BLOCK_CHARS = 2000;

export type HomeSection =
  | { kind: "actions"; actions: HomeAction[] }
  | { kind: Exclude<HomeSectionKind, "actions">; limit: number };

export interface HomeBlock {
  sections: HomeSection[];
  /** One-based line numbers of lines that were not understood, at most a few. */
  unreadable: number[];
}

/** More line numbers than a hint can usefully list. */
const MAX_UNREADABLE = 5;

const KINDS = new Set<string>(HOME_SECTION_KINDS);
const ACTIONS = new Set<string>(HOME_ACTIONS);

/** Every section with its defaults, which an empty block shows. */
export function defaultHomeSections(): HomeSection[] {
  return HOME_SECTION_KINDS.map((kind) =>
    kind === "actions" ? { kind, actions: [...HOME_ACTIONS] } : { kind, limit: DEFAULT_HOME_LIMIT }
  );
}

/**
 * What the block asks for. Blank lines and lines starting with `#` are
 * skipped; each other line is a section's name, case aside, and what follows
 * it on the line.
 */
export function parseHomeBlock(source: string): HomeBlock {
  const sections: HomeSection[] = [];
  const unreadable: number[] = [];
  const lines = source.slice(0, MAX_HOME_BLOCK_CHARS).split(/\r?\n/);
  let wrote = false;

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    wrote = true;
    if (sections.length === MAX_HOME_SECTIONS) break;

    const section = parseLine(line);
    if (section) sections.push(section);
    else if (unreadable.length < MAX_UNREADABLE) unreadable.push(index + 1);
  }

  // Only a block with nothing written in it means "everything". One whose
  // every line was misspelled shows the hint alone, so the misspelling is
  // what the person sees, not a page they did not ask for.
  return { sections: wrote ? sections : defaultHomeSections(), unreadable };
}

function parseLine(line: string): HomeSection | null {
  const [head = "", ...rest] = line.toLowerCase().split(/\s+/);
  if (!KINDS.has(head)) return null;
  const kind = head as HomeSectionKind;

  if (kind === "actions") {
    if (rest.length === 0) return { kind, actions: [...HOME_ACTIONS] };
    if (!rest.every((word) => ACTIONS.has(word))) return null;
    // Repeats once each, in the order written: the order is the person's.
    return { kind, actions: [...new Set(rest)] as HomeAction[] };
  }

  if (rest.length === 0) return { kind, limit: DEFAULT_HOME_LIMIT };
  if (rest.length > 1 || !/^\d{1,6}$/.test(rest[0] ?? "")) return null;
  const limit = Number(rest[0]);
  if (limit < 1) return null;
  return { kind, limit: Math.min(limit, MAX_HOME_LIMIT) };
}

/** A note with a due day, reduced to what the `due` section shows. */
export interface DueCandidate {
  path: string;
  name: string;
  due: DueDate;
}

/**
 * The notes the `due` section lists: earliest day first, so what is overdue
 * leads and what is far off falls past the limit. Notes due the same day are
 * in name order, so the list does not reshuffle with every save.
 */
export function selectDue(candidates: readonly DueCandidate[], limit: number): DueCandidate[] {
  return [...candidates]
    .sort(
      (a, b) =>
        a.due.iso.localeCompare(b.due.iso) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path)
    )
    .slice(0, Math.max(0, limit));
}

/** A note a section lists. */
export interface HomeRow {
  path: string;
  name: string;
}

export type HomeSectionModel =
  | { kind: "actions"; actions: HomeAction[] }
  | { kind: "bookmarks"; bookmarks: Bookmark[]; missingFile: string | null }
  | { kind: "updated"; rows: HomeRow[] }
  | { kind: "due"; rows: Array<HomeRow & { label: DueLabel }> };

export interface HomeModel {
  sections: HomeSectionModel[];
  unreadable: number[];
}

/** What the vault holds right now, as the sections read it. */
export interface HomeData {
  /** Every bookmark, in file order. */
  bookmarks: readonly Bookmark[];
  /** The bookmarks file's path when it does not exist, else null. */
  bookmarksMissing: string | null;
  /** The notes whose source changed, newest first. */
  updated: readonly HomeRow[];
  /** Every note with a due day. */
  due: readonly DueCandidate[];
  /** `YYYY-MM-DD`, the day the due labels are drawn against. */
  today: string;
  locale: string;
  /** Whether a button can do anything here: its command may be switched off. */
  available(action: HomeAction): boolean;
}

/** The block's sections filled with what the vault holds, each cut to its limit. */
export function planHome(block: HomeBlock, data: HomeData): HomeModel {
  const sections = block.sections.map((section): HomeSectionModel => {
    switch (section.kind) {
      case "actions":
        return { kind: "actions", actions: section.actions.filter((a) => data.available(a)) };
      case "bookmarks":
        return {
          kind: "bookmarks",
          bookmarks: data.bookmarks.slice(0, section.limit),
          missingFile: data.bookmarksMissing
        };
      case "updated":
        return { kind: "updated", rows: data.updated.slice(0, section.limit) };
      case "due":
        return {
          kind: "due",
          rows: selectDue(data.due, section.limit).map((note) => ({
            path: note.path,
            name: note.name,
            label: dueLabel(note.due, data.today, data.locale)
          }))
        };
    }
  });
  return { sections, unreadable: block.unreadable };
}

/** Whether any section reads the notes' due days, which costs a pass over the vault. */
export function readsDue(block: HomeBlock): boolean {
  return block.sections.some((section) => section.kind === "due");
}
