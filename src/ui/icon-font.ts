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
import { setIcon } from "obsidian";
import { ICON_CODEPOINTS, ICON_FONT_WOFF2, ICON_GROUPS } from "./icon-font.generated";

export { ICON_FONT_VERSION } from "./icon-font.generated";

const STYLE_ID = "schreibstube-icon-font";

/**
 * Which build of the font a style element carries.
 *
 * A fingerprint of the bytes rather than the Tabler version: two builds from
 * the same Tabler release can differ in which glyphs they carry, and that is
 * exactly the difference that matters below.
 */
const FONT_FINGERPRINT = fingerprint(ICON_FONT_WOFF2);

function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${hash.toString(16)}-${text.length}`;
}

/** The documents this build put the font into, so unload can take it out again. */
const installed = new Set<Document>();

/** The family the font is registered under, for stylesheets that draw from it. */
export const ICON_FONT_FAMILY = "schreibstube-icons";

/** The character `name` is drawn as, or undefined for a name the font does not have. */
export function iconGlyph(name: string): string | undefined {
  return ICON_CODEPOINTS[name];
}

export interface IconGroup {
  id: string;
  icons: string[];
}

export const iconGroups: IconGroup[] = ICON_GROUPS;

/** Every icon a user can choose, in picker order. */
export function allIconNames(): string[] {
  return ICON_GROUPS.flatMap((group) => group.icons);
}

/**
 * Register the font once per Obsidian window.
 *
 * Obsidian can put a leaf in a popped-out window with its own document, so this
 * takes the document rather than assuming the main one.
 *
 * A style element that is already there is kept only when it carries this
 * build's font. Obsidian updates a plugin in place, in the same window, and
 * an earlier build left its element behind on unload; this function then
 * found it and returned, the picker listed every icon the new build knew,
 * and the window drew each one the old font lacked as a blank square. An
 * element from another build is replaced.
 */
export function installIconFont(doc: Document = document): void {
  const existing = doc.getElementById(STYLE_ID);
  if (existing?.getAttribute("data-font") === FONT_FINGERPRINT) {
    installed.add(doc);
    return;
  }
  existing?.remove();

  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.setAttribute("data-font", FONT_FINGERPRINT);
  style.textContent = `@font-face {
  font-family: "${ICON_FONT_FAMILY}";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("data:font/woff2;base64,${ICON_FONT_WOFF2}") format("woff2");
}`;
  doc.head.appendChild(style);
  installed.add(doc);
}

/**
 * Take the font out of every window it was put into.
 *
 * Called on unload: what this build put up, this build takes down, so the
 * next build starts from a clean window whether or not it can tell the two
 * apart. A window closed in the meantime has a detached document, and
 * removing from that is harmless.
 */
export function uninstallIconFont(): void {
  for (const doc of installed) doc.getElementById(STYLE_ID)?.remove();
  installed.clear();
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

/**
 * An icon Obsidian draws — its own Lucide set, or one a plugin registered —
 * trying each name in turn, and one of the bundled set when Obsidian knows
 * none of them: a plugin disabled since, or an icon it never added.
 */
export function applyObsidianIcon(
  el: HTMLElement,
  names: readonly string[],
  fallback: string
): void {
  for (const name of names) {
    setIcon(el, name);
    if (el.querySelector("svg")) {
      el.addClass("is-obsidian-icon");
      el.setAttribute("aria-hidden", "true");
      return;
    }
  }
  applyIcon(el, fallback);
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
