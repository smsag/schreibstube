/**
 * The bookmarks file, as the pane reads it.
 *
 * A bookmark is a link to somewhere the vault cannot reach on its own: a web
 * page, an Obsidian URI, a folder, a note. Obsidian's own bookmarks hold the
 * last two and have no room for the first two, which is the reason this file
 * exists at all.
 *
 * It is a Markdown file in the vault, written by hand. Two consequences follow
 * and both are deliberate. Nothing here writes: the pane shows what the file
 * says and a person edits the file, so there is no second writer to reconcile
 * and no conflict a sync client has to resolve. And the format stays the one
 * Launchpad used, so an existing `bookmarks.md` is read as it stands.
 *
 * ```markdown
 * # Work
 * - [Linear](https://linear.app/team)
 * - [Objekte](vault://Immobilien/Objekte)
 *
 * ## Design
 * - [[Design Brief]]
 * ```
 *
 * A heading opens a folder, a second-level heading opens a subfolder, a list
 * item is a bookmark, and anything else is ignored rather than reported. A file
 * a person types into by hand has to tolerate the lines they did not mean as
 * bookmarks.
 */

/** Where the file sits unless a setting says otherwise. Launchpad's default,
 *  so a vault that already has one is picked up without being told. */
export const BOOKMARK_FILE_DEFAULT = "bookmarks.md";

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
  bookmarks: Bookmark[];
  subfolders: BookmarkFolder[];
}

export interface BookmarkTree {
  /** Bookmarks written before the first heading. */
  loose: Bookmark[];
  folders: BookmarkFolder[];
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

/** The icon each kind gets in the pane, from the bundled set. */
const KIND_ICONS: Record<BookmarkKind, string> = {
  web: "world",
  obsidian: "external-link",
  folder: "folder",
  note: "file-text"
};

/** Control characters, as escapes: a raw one in this file would be invisible. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * A list item.
 *
 * The name is lazy so it stops at the first `](`, which keeps a name holding a
 * bracket intact. The URL is greedy so it runs to the last `)` on the line,
 * which keeps a query string holding brackets intact.
 */
const ITEM = /^\s*[-*]\s+\[(.+?)\]\((.+)\)\s*$/;

/** `- [[Note]]` and `- [[Note|Label]]`, which is what a person types by hand. */
const WIKILINK = /^\s*[-*]\s+\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/;

export function bookmarkIcon(kind: BookmarkKind): string {
  return KIND_ICONS[kind];
}

export function emptyBookmarkTree(): BookmarkTree {
  return { loose: [], folders: [] };
}

/**
 * Read the file.
 *
 * Nothing is trusted: a disallowed scheme is dropped, control characters are
 * stripped, and a second-level heading before any first-level one becomes a
 * top-level folder rather than an item with nowhere to go.
 */
export function parseBookmarkFile(text: string): BookmarkTree {
  const tree = emptyBookmarkTree();
  let folder: BookmarkFolder | null = null;
  let subfolder: BookmarkFolder | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");

    if (line.startsWith("## ")) {
      const name = clean(line.slice(3));
      if (name.length === 0) continue;

      if (folder) {
        subfolder = { name, bookmarks: [], subfolders: [] };
        folder.subfolders.push(subfolder);
      } else {
        subfolder = null;
        folder = { name, bookmarks: [], subfolders: [] };
        tree.folders.push(folder);
      }
      continue;
    }

    if (line.startsWith("# ")) {
      const name = clean(line.slice(2));
      if (name.length === 0) continue;

      subfolder = null;
      folder = { name, bookmarks: [], subfolders: [] };
      tree.folders.push(folder);
      continue;
    }

    const bookmark = parseItem(line);
    if (!bookmark) continue;

    const target = subfolder?.bookmarks ?? folder?.bookmarks ?? tree.loose;
    target.push(bookmark);
  }

  return tree;
}

function parseItem(line: string): Bookmark | null {
  const wiki = line.match(WIKILINK);
  if (wiki) {
    const linkpath = clean(wiki[1] ?? "");
    if (linkpath.length === 0) return null;
    const name = clean(wiki[2] ?? linkpath);
    return { name, url: `note://${linkpath}`, kind: "note" };
  }

  const item = line.match(ITEM);
  if (!item) return null;

  const name = clean(item[1] ?? "");
  const url = clean(item[2] ?? "");
  if (name.length === 0 || url.length === 0) return null;

  const inner = url.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  if (inner) {
    const linkpath = clean(inner[1] ?? "");
    return linkpath.length > 0 ? { name, url: `note://${linkpath}`, kind: "note" } : null;
  }

  const kind = classifyBookmarkUrl(url);
  return kind ? { name, url, kind } : null;
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

  for (const folder of tree.folders) {
    for (const bookmark of folder.bookmarks) {
      entries.push({ bookmark, folderPath: folder.name });
    }
    for (const sub of folder.subfolders) {
      for (const bookmark of sub.bookmarks) {
        entries.push({ bookmark, folderPath: `${folder.name} / ${sub.name}` });
      }
    }
  }

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

/** The link path inside a `note://` URL. */
export function bookmarkLinkPath(url: string): string {
  return url.slice("note://".length);
}

/**
 * Control characters would let a line in the file break the row it is drawn
 * into, and a tab in a name is never meant. Collapsed to spaces, then trimmed.
 */
function clean(value: string): string {
  return value.replace(CONTROL_CHARS, " ").trim();
}
