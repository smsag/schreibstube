/**
 * The start page: one file in the vault that a tab shows instead of nothing.
 *
 * Obsidian draws an empty tab as four buttons on a blank screen — at launch
 * with nothing open, after the last tab closes, and for every new tab. That
 * screen is where a phone spends its first second, and the buttons are the
 * same every time. A note a person chose, which embeds their own bases and
 * lists what waits for them, is a better first screen; the four buttons live
 * on in its `actions` section.
 *
 * The page is a file rather than a screen of settings for the reason the
 * bookmarks are: a person arranges it by editing it, it syncs as any note
 * does, and nothing has to migrate it. This module decides which file that
 * is and when a tab turns into it; the controller only does what it says.
 */
import { normalizeVaultFolder } from "./file-name";
import { HOME_LANGUAGE } from "./home-block";

/**
 * Longer than any path a person types into a field. Past it the value is a
 * paste, and the start page is off rather than a lookup of a paragraph.
 */
export const MAX_START_PAGE_PATH = 512;

/**
 * How long the tab must stay empty before it turns into the start page.
 *
 * A note opened into a new tab passes through an empty view while it loads,
 * and that tab must not be taken from it. Long enough for a load's own
 * events to settle; short enough that the four buttons of a new tab are a
 * flicker, not a screen.
 */
export const START_PAGE_SETTLE_MS = 150;

/** What Obsidian calls the view of a tab that shows nothing. */
export const EMPTY_VIEW_TYPE = "empty";

/**
 * The start page's path as the settings hold it: a vault path without
 * leading or trailing slashes, or "" when it is off. A value that is no
 * usable path — a hidden folder, a backslash, a control character, too
 * long — turns the start page off rather than pointing it somewhere odd.
 */
export function normalizeStartPagePath(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_START_PAGE_PATH) return "";
  return normalizeVaultFolder(value) ?? "";
}

/** What the controller sees of the tab Obsidian just made current. */
export interface TabSnapshot {
  /** The start page as configured; "" when it is off. */
  path: string;
  /** Whether that path is a file in the vault right now. */
  exists: boolean;
  /** The type of the view the tab shows, or null when it has none yet. */
  viewType: string | null;
  /** Whether the tab was restored at launch and has not been shown yet. */
  deferred: boolean;
  /** Whether the tab is in the main area, not a sidebar. */
  inMainArea: boolean;
  /** Whether opening the start page in this tab already failed once. */
  failedBefore: boolean;
}

/**
 * Whether this tab should become the start page.
 *
 * Only an empty tab in the main area: a sidebar is not a place to read a
 * page, and a tab that shows anything at all was put there by a person. A
 * tab restored at launch and not shown yet is someone's note waiting to
 * load, whatever stands in for it meanwhile. A
 * tab where the open failed is left as Obsidian drew it, so a broken file
 * shows the four buttons once rather than an attempt on every event.
 */
export function opensStartPage(tab: TabSnapshot): boolean {
  if (tab.path === "" || !tab.exists || tab.failedBefore || tab.deferred) return false;
  return tab.inMainArea && tab.viewType === EMPTY_VIEW_TYPE;
}

/**
 * The view state the start page opens with: a note in Reading view, so a
 * press on the page opens what it lists rather than putting a cursor in the
 * block, and a phone's keyboard does not come up over it. Anything else — a
 * base, a canvas — opens as its own view always does.
 */
export function startPageViewState(extension: string): { state: { mode: "preview" } } | null {
  return extension.toLowerCase() === "md" ? { state: { mode: "preview" } } : null;
}

/** The words the starter note is written with, in the language the person reads. */
export interface StarterWords {
  /** One sentence under the block on how to make the page one's own. */
  hint: string;
}

/**
 * What **Create start page** writes into a new file: the block with every
 * section named, so the page shows what it can do and a line comes out by
 * deleting it, and one sentence on where a base goes. The sentence is a
 * comment, hidden in Reading view, which is the view the page opens in.
 */
export function starterNote(words: StarterWords): string {
  return (
    "```" +
    HOME_LANGUAGE +
    "\nactions\nbookmarks\nupdated\ndue\n```\n\n" +
    `%% ${words.hint.replace(/%%/g, "")} %%\n`
  );
}

/**
 * Where **Create start page** writes: the path as typed, or with `.md` added
 * when it names no extension. A file without one would be a file Obsidian
 * cannot open as a note, and "Start" typed into the field means a note.
 */
export function starterPath(path: string): string {
  const name = path.split("/").pop() ?? "";
  return /\.[^.]+$/.test(name) ? path : `${path}.md`;
}
