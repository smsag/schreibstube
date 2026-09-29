/**
 * The rows of the bookmarks section: loose bookmarks first, then each folder
 * with what is in it, at any depth.
 *
 * Kept apart from the pane so it can be drawn and pressed in a test. The pane
 * says what it knows — which folders are folded, what the filter keeps, which
 * plugin icon a link wears — and hears back when a folder is folded or a
 * bookmark opened. Nothing here decides; it draws.
 */
import type { Bookmark, BookmarkFolder, BookmarkTree } from "../services/bookmark-file";
import { drawBookmarkIcon } from "./bookmark-icon";
import { indent } from "./explorer-row";
import { applyIcon } from "./icon-font";
import { pressable } from "./pressable";

export interface BookmarkRowsHost {
  /** Whether the folder under this key is folded right now. */
  isFolded(key: string): boolean;
  /** Whether a bookmark is drawn at all: kept by the filter, and not a note
   *  deleted a moment ago. A folder with none of these left is not drawn. */
  isShown(bookmark: Bookmark): boolean;
  /** The icon of the plugin an `obsidian://` bookmark calls, if it has one. */
  pluginIconFor(bookmark: Bookmark): string | null;
  /** A folder row was pressed: fold it if open, open it if folded. */
  fold(key: string): void;
  open(bookmark: Bookmark): void;
}

/** Draws every row into `host`; returns how many were drawn. */
export function renderBookmarkRows(
  host: HTMLElement,
  tree: BookmarkTree,
  pane: BookmarkRowsHost
): number {
  let drawn = 0;
  for (const bookmark of tree.loose) drawn += renderRow(host, bookmark, 0, pane);
  for (const folder of tree.folders) drawn += renderFolder(host, folder, 0, pane);
  return drawn;
}

function renderFolder(
  host: HTMLElement,
  folder: BookmarkFolder,
  depth: number,
  pane: BookmarkRowsHost
): number {
  if (shownUnder(folder, pane) === 0) return 0;

  const folded = pane.isFolded(folder.key);
  // Reachable by keyboard, but not a Tab stop of its own, as the tree's rows
  // are not: the list is the stop, and a press or an arrow lands on a row.
  const row = host.createDiv({
    cls: "schreibstube-explorer-row is-folder",
    attr: { role: "button", tabindex: "-1", "aria-expanded": String(!folded) }
  });
  indent(row, depth);
  row.setAttribute("data-bookmark-folder", folder.key);

  applyIcon(
    row.createSpan({ cls: "schreibstube-explorer-twisty" }),
    folded ? "chevron-right" : "chevron-down"
  );
  applyIcon(row.createSpan({ cls: "schreibstube-explorer-glyph" }), "folder");
  row.createSpan({ cls: "schreibstube-explorer-name", text: folder.name });
  pressable(row, () => pane.fold(folder.key));

  if (folded) return 1;

  let drawn = 1;
  for (const bookmark of folder.bookmarks) drawn += renderRow(host, bookmark, depth + 1, pane);
  for (const sub of folder.subfolders) drawn += renderFolder(host, sub, depth + 1, pane);
  return drawn;
}

function renderRow(
  host: HTMLElement,
  bookmark: Bookmark,
  depth: number,
  pane: BookmarkRowsHost
): number {
  if (!pane.isShown(bookmark)) return 0;

  const row = host.createDiv({
    cls: "schreibstube-explorer-row is-bookmark",
    attr: { role: "link", tabindex: "-1" }
  });
  indent(row, depth);
  row.setAttribute("data-kind", bookmark.kind);
  row.setAttribute("title", bookmark.url);

  row.createSpan({ cls: "schreibstube-explorer-twisty" });
  drawBookmarkIcon(
    row.createSpan({ cls: "schreibstube-explorer-glyph" }),
    bookmark,
    pane.pluginIconFor(bookmark)
  );
  row.createSpan({ cls: "schreibstube-explorer-name", text: bookmark.name });
  pressable(row, () => pane.open(bookmark));
  return 1;
}

/** How many bookmarks under a folder are drawn, at any depth. */
function shownUnder(folder: BookmarkFolder, pane: BookmarkRowsHost): number {
  const here = folder.bookmarks.filter((bookmark) => pane.isShown(bookmark)).length;
  return folder.subfolders.reduce((total, sub) => total + shownUnder(sub, pane), here);
}
