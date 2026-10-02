/**
 * `:folder:` drawn on the site as the icon the plugin draws in Obsidian.
 *
 * The plugin's glyphs are a font inside its bundle; a page cannot borrow it,
 * and a font of four hundred icons is a heavy thing to load for the two a page
 * names. So each icon is drawn inline, from the stroke drawing of the same
 * Tabler release the font was cut from, and a page carries exactly the icons
 * it uses and loads nothing for them.
 *
 * Where a shortcode counts follows the plugin: a name that starts with a
 * letter and is in the set, outside code and outside a link. Anything else is
 * left as the text it was — `:note:` in a sentence about notes is a sentence,
 * and `10:30:45` is a time.
 */
import { escapeHtml } from "./html.mjs";
import { ICON_SHAPES } from "./icons.generated.mjs";

const SHORTCODE = /:([a-z][a-z0-9-]*):/g;

/** Whether the set has an icon of that name. */
export function isIcon(name) {
  return Object.hasOwn(ICON_SHAPES, name);
}

/**
 * `text` cut into its words and its icons, in order: `{ text }` and `{ icon }`.
 *
 * A match that is not an icon steps back over its closing colon, which may
 * open the next one: in `:note:folder:` the icon is `:folder:`.
 */
export function splitShortcodes(text, known = isIcon) {
  const parts = [];
  let last = 0;
  SHORTCODE.lastIndex = 0;
  let match;
  while ((match = SHORTCODE.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (!known(match[1])) {
      SHORTCODE.lastIndex = end - 1;
      continue;
    }
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ icon: match[1] });
    last = end;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * One icon as an inline SVG.
 *
 * Everything it needs to draw is on the element, because a vault's own
 * `theme.css` replaces the built-in one and owes this rule nothing. The
 * baseline is the plugin's own setting, read through `--icon-baseline` so a
 * theme can move it without `!important`; the size is attributes, which any
 * stylesheet rule outranks. The name is its title: a screen reader says
 * "folder", and a pointer shows it.
 */
export function iconSvg(name) {
  return (
    `<svg class="icon-shortcode" viewBox="0 0 24 24" width="1.05em" height="1.05em" ` +
    `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" role="img" style="vertical-align: var(--icon-baseline, -0.15em)">` +
    `<title>${name}</title>${ICON_SHAPES[name]}</svg>`
  );
}

/**
 * Plain text as HTML, with its icons drawn: for the lines a rule writes itself
 * rather than through inline parsing, such as a callout's title.
 */
export function textWithIcons(text) {
  return splitShortcodes(text)
    .map((part) => (part.icon ? iconSvg(part.icon) : escapeHtml(part.text)))
    .join("");
}

/**
 * The markdown-it plugin. It runs after every other core rule, so heading ids
 * are taken from the words — `## :folder: Ablage` keeps the id a `[[#…]]` to
 * it computes — and a URL linkify turned into a link is already one.
 */
export function iconShortcodes(md) {
  md.core.ruler.push("icon_shortcode", (state) => {
    for (const token of state.tokens) {
      if (token.type === "inline" && token.children) {
        token.children = withIcons(token.children, state.Token);
      }
    }
  });
  md.renderer.rules.icon_shortcode = (tokens, index) => iconSvg(tokens[index].meta.name);
}

function withIcons(children, Token) {
  const out = [];
  let linkDepth = 0;
  for (const child of children) {
    if (child.type === "link_open") linkDepth += 1;
    if (child.type === "link_close") linkDepth = Math.max(0, linkDepth - 1);

    const plain =
      child.type === "text" &&
      linkDepth === 0 &&
      !child.meta?.fromLink &&
      child.content.includes(":");
    const parts = plain ? splitShortcodes(child.content) : [];
    if (!parts.some((part) => part.icon)) {
      out.push(child);
      continue;
    }
    for (const part of parts) {
      const token = new Token(part.icon ? "icon_shortcode" : "text", "", 0);
      if (part.icon) token.meta = { name: part.icon };
      else token.content = part.text;
      out.push(token);
    }
  }
  return out;
}
