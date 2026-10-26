/**
 * What a new note is called and where it goes.
 *
 * Two decisions, both pure: the next free name in Obsidian's own style —
 * "Untitled", then "Untitled 1", filling any gap — and the vault path that
 * name takes in a folder. The vault only answers "is this taken", so the
 * rules can be tested against text. And one about the window it opens in:
 * whether that fills the screen, which decides how wide its lines are.
 */

/** The first of `base`, `base 1`, `base 2`, … that `taken` does not claim. */
export function nextFreeName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 1; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * A folder path and a file name joined into a vault path. The root folder
 * arrives as "" or "/" depending on who asked Obsidian for it.
 */
export function joinVaultPath(folder: string, name: string): string {
  const trimmed = folder.replace(/\/+$/, "");
  return trimmed === "" ? name : `${trimmed}/${name}`;
}

/**
 * The vault path of the next untitled note in `folder`. `exists` is asked
 * about full paths, so a note of the same name in another folder does not
 * count against this one.
 */
export function newNotePath(
  folder: string,
  base: string,
  exists: (path: string) => boolean
): string {
  const name = nextFreeName(base, (candidate) => exists(joinVaultPath(folder, `${candidate}.md`)));
  return joinVaultPath(folder, `${name}.md`);
}

/** Slack for a window manager that keeps a pixel border or a menu bar's worth. */
const FILL_TOLERANCE_PX = 8;

export interface WindowSize {
  outerWidth: number;
  outerHeight: number;
}

export interface ScreenSize {
  availWidth: number;
  availHeight: number;
}

/**
 * Whether a window takes the whole screen: full screen, or maximised to the
 * part of it the system leaves free. Either way the text would otherwise run
 * the width of the screen, or sit in a narrow column in the middle of it,
 * which is what the new note's wider line is for. A size that is missing or
 * not a number says no: a window that cannot be measured keeps the width it has.
 */
export function fillsScreen(win: WindowSize, screen: ScreenSize): boolean {
  const sizes = [win.outerWidth, win.outerHeight, screen.availWidth, screen.availHeight];
  if (!sizes.every((size) => Number.isFinite(size) && size > 0)) return false;
  return (
    win.outerWidth >= screen.availWidth - FILL_TOLERANCE_PX &&
    win.outerHeight >= screen.availHeight - FILL_TOLERANCE_PX
  );
}

/** What follows `obsidian://` in the link that runs New doc from outside Obsidian. */
export const NEW_DOC_ACTION = "schreibstube-new-doc";

/** The link's one flag: the new note starts in typewriter mode. */
export const NEW_DOC_TYPEWRITER_PARAM = "typewriter";

export interface NewDocLinkOptions {
  typewriter?: boolean;
}

/**
 * The link that runs New doc from outside Obsidian, in this vault.
 *
 * The vault is named so the link works with more than one vault; without it
 * Obsidian uses whichever was open last, which is right only by luck. The name
 * is encoded, since a space or an ampersand in it would otherwise end it.
 */
export function newDocLink(vaultName: string, options: NewDocLinkOptions = {}): string {
  const params: string[] = [];
  if (vaultName.length > 0) params.push(`vault=${encodeURIComponent(vaultName)}`);
  if (options.typewriter) params.push(`${NEW_DOC_TYPEWRITER_PARAM}=1`);
  const base = `obsidian://${NEW_DOC_ACTION}`;
  return params.length > 0 ? `${base}?${params.join("&")}` : base;
}

/** What a flag may say to mean yes: what the copied link says, and the two a person types. */
const YES = new Set(["1", "true", "yes"]);

/**
 * What a call of the link asks for, read from Obsidian's parsed parameters.
 *
 * Only the typewriter flag is read, and only as yes or no: it changes how
 * the note is shown, never what goes into it or where it is put, so a page
 * that sets it can do no more than a page that does not. Anything else the
 * link carries is ignored, as it always was. A flag given without a value
 * counts as yes, since `?typewriter` alone reads as asking for it.
 */
export function newDocLinkOptions(params: Readonly<Record<string, unknown>>): NewDocLinkOptions {
  const value = params[NEW_DOC_TYPEWRITER_PARAM];
  if (typeof value !== "string") return { typewriter: false };
  return { typewriter: value === "" || YES.has(value.trim().toLowerCase()) };
}
