/**
 * The bookmarks file, as the pane reads it.
 *
 * A bookmark is a link to somewhere the vault cannot reach on its own: a web
 * page, an Obsidian URI, a folder, a note. Obsidian's own bookmarks hold the
 * last two and have no room for the first two, which is the reason this file
 * exists at all.
 *
 * It is a Markdown file in the vault, written by hand. Nothing here writes: the
 * pane shows what the file says and a person edits the file, so there is no
 * second writer to reconcile and no conflict a sync client has to resolve.
 *
 * ```markdown
 * # Work
 * - [Linear](https://linear.app/team)
 * - [Objekte](vault://Immobilien/Objekte)
 *
 * ## Design
 * - [[Design Brief]]
 * - [Weekly review](Reviews/Weekly%20review.md)
 * ```
 *
 * A heading opens a folder one level below the heading above it, a list item is
 * a bookmark, and anything else is ignored rather than reported: a file a
 * person types into by hand has to tolerate the lines they did not mean as
 * bookmarks. A Markdown link without a scheme is a note, because that is what
 * Obsidian writes for one when wikilinks are turned off.
 *
 * The file syncs, so it is read as untrusted and within a budget: every step
 * below is linear in the length of a line, and the file, a line and the number
 * of bookmarks each have a ceiling.
 */

/** Where the file sits unless a setting says otherwise. */
export const BOOKMARK_FILE_DEFAULT = "bookmarks.md";

/** How much of the file is read. Ten thousand bookmarks fit in a quarter of it. */
export const MAX_BOOKMARK_FILE_CHARS = 256 * 1024;
/** A line longer than this is not a bookmark anybody typed, and is skipped. */
export const MAX_BOOKMARK_LINE = 4096;
/** More rows than a pane can usefully hold; the rest of the file is not read. */
export const MAX_BOOKMARKS = 2000;

/** Between a folder's name and its parent's in a fold key: a character no
 *  heading can hold. The same one the pane has always stored keys with. */
export const BOOKMARK_FOLDER_SEP = "\u001f";
/** Before the number that tells two same-named folders apart in a fold key. */
const DUPLICATE_SEP = "\u001e";

/**
 * What a bookmark points at. The kind is derived from the scheme once, here,
 * rather than re-read from the URL at every click.
 */
export type BookmarkKind = "web" | "obsidian" | "folder" | "note";

export interface Bookmark {
  name: string;
  /** Normalized: a wikilink shorthand is already a `note://` URL. */
  url: string;
  kind: BookmarkKind;
}

export interface BookmarkFolder {
  name: string;
  /**
   * What the pane remembers the folder's fold state by: its name, under its
   * parent's key. A second folder of the same name beside it gets a number, so
   * folding one of them does not fold both.
   */
  key: string;
  bookmarks: Bookmark[];
  subfolders: BookmarkFolder[];
}

export interface BookmarkTree {
  /** Bookmarks written before the first heading. */
  loose: Bookmark[];
  folders: BookmarkFolder[];
  /** True when a ceiling cut the file short, which the caller may log. */
  truncated: boolean;
}

/** One bookmark with the folder it came from, for a flat list. */
export interface BookmarkEntry {
  bookmark: Bookmark;
  /** "" for a loose bookmark, "Work" or "Work / Design" otherwise. */
  folderPath: string;
}

/**
 * The schemes that may be opened, and what each one means.
 *
 * Everything else is dropped while parsing rather than when clicked. The file
 * is plain text in a vault that syncs, so `javascript:` and `file:` must never
 * reach a row a person can tap — and a row that cannot be opened is worse than
 * no row at all.
 */
const SCHEMES: ReadonlyArray<{ prefix: string; kind: BookmarkKind }> = [
  { prefix: "https://", kind: "web" },
  { prefix: "http://", kind: "web" },
  { prefix: "obsidian://", kind: "obsidian" },
  { prefix: "vault://", kind: "folder" },
  { prefix: "note://", kind: "note" }
];

/** Control characters, as escapes: a raw one in this file would be invisible. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** `# Name` to `###### Name`. */
const HEADING = /^(#{1,6}) (.*)$/;

/** The bullet in front of a list item. */
const BULLET = /^\s*[-*]\s+/;

/** A task box, `[ ]` or `[x]`, between the bullet and the link. */
const TASK_BOX = /^\[[ xX]\]\s+/;

/** Any scheme at all, allowed or not: `mailto:` and `javascript:` included. */
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function emptyBookmarkTree(): BookmarkTree {
  return { loose: [], folders: [], truncated: false };
}

/**
 * Read the file.
 *
 * Nothing is trusted: a disallowed scheme is dropped, control characters are
 * stripped, and a heading deeper than the one above it by more than a level
 * sits one level below that one rather than nowhere.
 */
export function parseBookmarkFile(text: string): BookmarkTree {
  const tree = emptyBookmarkTree();
  let body = text;
  if (body.length > MAX_BOOKMARK_FILE_CHARS) {
    // Cut at the last whole line, so the last row read is not half a link.
    body = body.slice(0, body.lastIndexOf("\n", MAX_BOOKMARK_FILE_CHARS));
    tree.truncated = true;
  }

  /** The folder each heading level opened, outermost first. */
  const open: BookmarkFolder[] = [];
  let count = 0;

  for (const raw of body.split("\n")) {
    if (raw.length > MAX_BOOKMARK_LINE) continue;
    const line = raw.trimEnd();

    const heading = HEADING.exec(line);
    if (heading) {
      const name = clean(heading[2] ?? "");
      if (name.length === 0) continue;

      // One level below the heading above it at most: `###` straight under `#`
      // is a subfolder, not a folder two levels down with nothing between.
      const depth = Math.min((heading[1] ?? "#").length - 1, open.length);
      open.length = depth;
      const parent = open[depth - 1];
      const siblings = parent?.subfolders ?? tree.folders;
      const folder: BookmarkFolder = {
        name,
        key: folderKey(parent?.key ?? null, name, siblings),
        bookmarks: [],
        subfolders: []
      };
      siblings.push(folder);
      open.push(folder);
      continue;
    }

    const bookmark = parseItem(line);
    if (!bookmark) continue;

    if (count === MAX_BOOKMARKS) {
      tree.truncated = true;
      break;
    }
    count += 1;
    (open[open.length - 1]?.bookmarks ?? tree.loose).push(bookmark);
  }

  return tree;
}

function folderKey(parentKey: string | null, name: string, siblings: BookmarkFolder[]): string {
  const same = siblings.filter((folder) => folder.name === name).length;
  const own = same === 0 ? name : `${name}${DUPLICATE_SEP}${same + 1}`;
  return parentKey === null ? own : `${parentKey}${BOOKMARK_FOLDER_SEP}${own}`;
}

/**
 * A list item, taken apart by position rather than by one pattern over the
 * whole line: a pattern with two open-ended groups backtracks over every `](`
 * in a line, and a long line of them held the pane for seconds.
 */
function parseItem(line: string): Bookmark | null {
  const bullet = BULLET.exec(line);
  if (!bullet) return null;

  let rest = line.slice(bullet[0].length);
  const box = TASK_BOX.exec(rest);
  if (box) rest = rest.slice(box[0].length);

  if (rest.startsWith("[[")) return parseWikilink(rest);
  return parseMarkdownLink(rest);
}

/** `[[Note]]`, `[[Note|Label]]`, `[[Note#Heading]]`. */
function parseWikilink(rest: string): Bookmark | null {
  if (!rest.endsWith("]]")) return null;
  const link = wikilinkTarget(rest.slice(2, -2));
  if (!link) return null;
  return { name: link.label, url: `note://${link.target}`, kind: "note" };
}

/** The inside of a wikilink: its target and what it is called. */
function wikilinkTarget(inner: string): { target: string; label: string } | null {
  if (inner.includes("]") || inner.includes("[")) return null;

  const bar = inner.indexOf("|");
  const target = clean(bar === -1 ? inner : inner.slice(0, bar));
  const label = bar === -1 ? "" : clean(inner.slice(bar + 1));
  if (target.length === 0 || target.startsWith("#")) return null;

  // Obsidian writes `Note > Heading` for a link to a heading it shows unlabelled.
  return { target, label: label.length > 0 ? label : target.replace("#", " > ") };
}

/**
 * `[Name](target)`. The name runs to the first `](`, which keeps a name holding
 * a bracket intact; the target runs to the `)` that ends the line, which keeps
 * a query string holding brackets intact.
 */
function parseMarkdownLink(rest: string): Bookmark | null {
  if (!rest.startsWith("[") || !rest.endsWith(")")) return null;

  const split = rest.indexOf("](", 2);
  if (split === -1) return null;

  const name = clean(rest.slice(1, split));
  // Obsidian wraps a link target holding a space in angle brackets.
  const target = clean(rest.slice(split + 2, -1)).replace(/^<(.*)>$/, "$1");
  if (name.length === 0 || target.length === 0) return null;

  if (target.startsWith("[[") && target.endsWith("]]")) {
    const link = wikilinkTarget(target.slice(2, -2));
    return link ? { name, url: `note://${link.target}`, kind: "note" } : null;
  }

  const kind = classifyBookmarkUrl(target);
  if (kind) return { name, url: target, kind };

  // A web address typed without its scheme is still a web address, not a note
  // called "www.example.com" that the vault will never find.
  if (/^www\./i.test(target)) return { name, url: `https://${target}`, kind: "web" };

  const linkpath = markdownLinkPath(target);
  return linkpath ? { name, url: `note://${linkpath}`, kind: "note" } : null;
}

/**
 * The note a scheme-less link target names, as a link path:
 * `Today%20I%20learned.md#Goals` is `Today I learned#Goals`. Null for anything
 * that has a scheme, which the allow-list has already refused, and for `//host`
 * and a bare `#heading`, which name no note.
 */
function markdownLinkPath(target: string): string | null {
  if (ANY_SCHEME.test(target) || target.startsWith("//")) return null;

  const hash = target.indexOf("#");
  const path = clean(decoded(hash === -1 ? target : target.slice(0, hash)))
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "");
  if (path.length === 0) return null;

  const heading = hash === -1 ? "" : clean(decoded(target.slice(hash + 1)));
  return heading.length > 0 ? `${path}#${heading}` : path;
}

/** Percent-escapes decoded, or the text as written when one is malformed. */
function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A hand-typed percent sign is not an escape; the path is read as written.
    return value;
  }
}

/** The kind of a URL, or null when the scheme is not one that may be opened. */
export function classifyBookmarkUrl(url: string): BookmarkKind | null {
  const match = SCHEMES.find((scheme) => url.toLowerCase().startsWith(scheme.prefix));
  return match?.kind ?? null;
}

/** Whether the tree holds anything at all, which decides the empty state. */
export function isBookmarkTreeEmpty(tree: BookmarkTree): boolean {
  return tree.loose.length === 0 && tree.folders.length === 0;
}

/**
 * Every bookmark in one list, in the order the file has them, each carrying the
 * folder it came from. What the "Open bookmark" command searches.
 */
export function flattenBookmarks(tree: BookmarkTree): BookmarkEntry[] {
  const entries: BookmarkEntry[] = tree.loose.map((bookmark) => ({ bookmark, folderPath: "" }));

  const walk = (folder: BookmarkFolder, parentPath: string): void => {
    const folderPath = parentPath.length > 0 ? `${parentPath} / ${folder.name}` : folder.name;
    for (const bookmark of folder.bookmarks) entries.push({ bookmark, folderPath });
    for (const sub of folder.subfolders) walk(sub, folderPath);
  };
  for (const folder of tree.folders) walk(folder, "");

  return entries;
}

/**
 * The `vault://` URL for a folder, ready to paste into the file.
 *
 * Each segment is encoded on its own so the separators survive, which is what
 * lets `bookmarkFolderPath` decode it back to a vault path.
 */
export function vaultUrlFor(folderPath: string): string {
  return `vault://${folderPath.split("/").map(encodeURIComponent).join("/")}`;
}

/** The vault path inside a `vault://` URL, or null when it cannot be decoded. */
export function bookmarkFolderPath(url: string): string | null {
  if (classifyBookmarkUrl(url) !== "folder") return null;

  try {
    return decodeURIComponent(url.slice("vault://".length));
  } catch {
    // A hand-typed percent sign is not an escape; the row stays, the click says so.
    return null;
  }
}

/**
 * The note a `note://` URL names, and the heading or block inside it.
 *
 * Apart, because the vault finds a note by its path alone — `Note#Goals` is no
 * note's name — and the heading is where the note opens once it is found.
 */
export function bookmarkNoteTarget(url: string): { linkpath: string; subpath: string } {
  const target = url.slice("note://".length);
  const hash = target.indexOf("#");
  return hash === -1
    ? { linkpath: target, subpath: "" }
    : { linkpath: target.slice(0, hash), subpath: target.slice(hash) };
}

/**
 * Control characters would let a line in the file break the row it is drawn
 * into, and a tab in a name is never meant. Collapsed to spaces, then trimmed.
 */
function clean(value: string): string {
  return value.replace(CONTROL_CHARS, " ").trim();
}
