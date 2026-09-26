/**
 * What happens to a description note when its picture moves or goes.
 *
 * A description note holds its picture by a link. Obsidian rewrites that link
 * on a rename only when "Automatically update internal links" is on, and a
 * link that no longer resolves turns the note into an orphan: back in the
 * tree, and its picture no longer found by what it shows. So the note follows
 * its picture here, whatever that setting says — and when the picture is
 * deleted, the note goes to the trash with it rather than lingering as a
 * description of nothing.
 *
 * Pure: the controller asks the vault; these rules only compare paths and
 * rewrite text.
 */
import { descriptionNotePath } from "./image-description";

/**
 * Whether a link that is broken now pointed at the file that was at `oldPath`.
 *
 * A full path is certain. A bare name — how Obsidian writes a link when the name
 * is unique — counts only while nothing else answers to that name now: if
 * something does, the link was never broken by this move.
 */
export function linkPointedAt(link: string, oldPath: string, resolvesNow: boolean): boolean {
  if (resolvesNow) return false;
  if (link === oldPath) return true;
  const name = oldPath.split("/").pop() ?? oldPath;
  return !link.includes("/") && link === name;
}

/**
 * Where the note goes when its picture moves from `oldImage` to `newImage`, or
 * null to leave it where it is.
 *
 * A description note is named for its picture's path, which is also how a
 * second "Describe picture" finds it to replace in place. Following the picture
 * keeps that true. A note someone renamed by hand no longer carries the name
 * Schreibstube gave it, and a name somebody chose is theirs: it stays.
 */
export function followedNotePath(
  notePath: string,
  oldImage: string,
  newImage: string
): string | null {
  const folder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  if (notePath !== descriptionNotePath(folder, oldImage)) return null;
  const next = descriptionNotePath(folder, newImage);
  return next === notePath ? null : next;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every `[[oldLink]]`, `[[oldLink|…]]` and `[[oldLink#…]]` in the note, pointed
 * at `newPath` — the key in the frontmatter, the embed at the top and any link
 * the person added in the text, in one write. Only whole link targets change:
 * `[[a.jpg]]` is rewritten, `[[a.jpg.md]]` and `[[Ordner/a.jpg]]` are not.
 */
export function retargetLinks(content: string, oldLink: string, newPath: string): string {
  const pattern = new RegExp(`\\[\\[${escapeRegExp(oldLink)}(?=[\\]|#])`, "g");
  return content.replace(pattern, () => `[[${newPath}`);
}
