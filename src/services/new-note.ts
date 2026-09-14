/**
 * What a new note is called and where it goes.
 *
 * Two decisions, both pure: the next free name in Obsidian's own style —
 * "Untitled", then "Untitled 1", filling any gap — and the vault path that
 * name takes in a folder. The vault only answers "is this taken", so the
 * rules can be tested against text.
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
