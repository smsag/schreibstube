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
