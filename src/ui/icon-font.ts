/**
 * Drawing an icon.
 *
 * Obsidian ships Lucide and `setIcon` draws from it, which is right for buttons
 * that should look like Obsidian's own. It is not enough for a picker: a person
 * labelling a folder wants a key, a floor plan, a signature, and reaching those
 * means shipping a set. The set is a subsetted Tabler webfont carried in the
 * bundle, because a release delivers `main.js`, `manifest.json` and
 * `styles.css` and nothing else — a separate font file would never arrive.
 *
 * The name is what is stored, never the codepoint. A font upgrade that moves a
 * glyph is then a change to the generated map rather than a migration of every
 * vault's icons.
 */
import { ICON_CODEPOINTS, ICON_FONT_WOFF2, ICON_GROUPS } from "./icon-font.generated";

export { ICON_FONT_VERSION } from "./icon-font.generated";

const STYLE_ID = "schreibstube-icon-font";

export interface IconGroup {
  id: string;
  icons: string[];
}

export const iconGroups: IconGroup[] = ICON_GROUPS;

/** Every icon a user can choose, in picker order. */
export function allIconNames(): string[] {
  return ICON_GROUPS.flatMap((group) => group.icons);
}

export function isKnownIcon(name: string | undefined): name is string {
  return typeof name === "string" && name in ICON_CODEPOINTS;
}

/**
 * Register the font once per Obsidian window.
 *
 * Obsidian can put a leaf in a popped-out window with its own document, so this
 * takes the document rather than assuming the main one.
 */
export function installIconFont(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `@font-face {
  font-family: "schreibstube-icons";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("data:font/woff2;base64,${ICON_FONT_WOFF2}") format("woff2");
}`;
  doc.head.appendChild(style);
}

/**
 * Draw `name` into `el`.
 *
 * The glyph is decorative: the row it sits in carries the name, so a screen
 * reader that read the private-use character as well would only add noise.
 * An unknown name leaves the element empty rather than drawing a blank box,
 * which is what a stale icon from an older catalogue would otherwise look like.
 */
export function applyIcon(el: HTMLElement, name: string | undefined): boolean {
  el.addClass("schreibstube-icon");
  el.setAttribute("aria-hidden", "true");

  const glyph = name ? ICON_CODEPOINTS[name] : undefined;
  el.setText(glyph ?? "");
  return glyph !== undefined;
}

/** Icons whose name or group matches, for the picker's search box. */
export function searchIcons(query: string): IconGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return iconGroups;

  return iconGroups
    .map((group) => ({
      id: group.id,
      icons: group.icons.filter((icon) => icon.includes(needle))
    }))
    .filter((group) => group.icons.length > 0);
}
