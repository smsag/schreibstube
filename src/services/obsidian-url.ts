/**
 * The `obsidian://` links Recommended copies: one for a file, one for a
 * conversation in Pythia.
 *
 * The file link is Obsidian's own, built the way its "Copy Obsidian URL" builds
 * it (read from Obsidian 1.13.7): the vault by name, the path with a note's
 * `.md` left off, both URI-encoded. Built here rather than through the app's
 * undocumented `getObsidianUrl`, so the one thing Recommended needs does not
 * depend on an internal, and a test can hold it to Obsidian's form.
 *
 * The conversation link is Pythia's resume link, in the form Pythia writes into
 * its own notes (`resumeDeepLink`), so a copied link and one Pythia made open
 * the same way.
 */

/** A file, as Obsidian's "Copy Obsidian URL" writes it. */
export function obsidianFileUrl(vault: string, path: string): string {
  const file = /\.md$/i.test(path) ? path.slice(0, -3) : path;
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}
