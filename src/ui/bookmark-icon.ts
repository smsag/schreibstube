/**
 * Drawing a bookmark's icon, shared by the pane and "Open bookmark" so a
 * bookmark looks the same in both places. Which icon it is is decided in
 * `services/bookmark-icon`; this only draws it.
 */
import type { Bookmark } from "../services/bookmark-file";
import { bookmarkGlyph } from "../services/bookmark-icon";
import { applyIcon, applyObsidianIcon } from "./icon-font";

export function drawBookmarkIcon(el: HTMLElement, bookmark: Bookmark, plugin: string | null): void {
  const glyph = bookmarkGlyph(bookmark, plugin);
  if (glyph.from === "bundled") applyIcon(el, glyph.name);
  else applyObsidianIcon(el, glyph.names, glyph.fallback);
}
