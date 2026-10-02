/**
 * Which glyphs a font build takes from where, decided before any tool runs.
 *
 * Kept apart from `build-icon-font.mjs` so the decisions can be tested without
 * the Tabler package, fonttools or a file system: every refusal here is one
 * that would otherwise ship an empty square or the wrong glyph.
 */

/**
 * Where our own glyphs start: Supplementary Private Use Area-A. Tabler lives in
 * the BMP's private area and just past it (U+EA02 to U+1028D), so a plane of
 * its own keeps the two from meeting however far Tabler grows.
 */
export const CUSTOM_CODEPOINT_BASE = 0xf0000;

/**
 * @param {string[]} wanted every name the build ships
 * @param {Map<string, number>} available Tabler's names and codepoints
 * @param {{ name: string, source: string }[]} custom our own glyphs
 * @returns {{ errors: string[], tabler: string[], custom: { name: string, source: string, codepoint: number }[] }}
 */
export function planIconFont(wanted, available, custom) {
  const errors = [];
  const customNames = new Set();

  for (const icon of custom) {
    if (customNames.has(icon.name)) errors.push(`"${icon.name}" is listed twice in CUSTOM_ICONS.`);
    if (available.has(icon.name)) {
      errors.push(`"${icon.name}" is a Tabler name too; give our own glyph another one.`);
    }
    customNames.add(icon.name);
  }

  const unknown = wanted.filter((name) => !available.has(name) && !customNames.has(name));
  if (unknown.length > 0) {
    errors.push(
      `Unknown icon names in scripts/icon-set.mjs: ${unknown.join(", ")}.\n` +
        "Check the name against https://tabler.io/icons — a typo would ship an empty square."
    );
  }

  const shipped = new Set(wanted);
  return {
    errors,
    tabler: wanted.filter((name) => !customNames.has(name)),
    // Codepoints by position in the list, so an appended icon never moves an
    // existing one and leaving one out of every group renumbers nothing.
    custom: custom
      .map((icon, index) => ({ ...icon, codepoint: CUSTOM_CODEPOINT_BASE + index }))
      .filter((icon) => shipped.has(icon.name))
  };
}

/**
 * What an icon drawn inline on the website may be made of.
 *
 * The bridge writes this markup into a published page as it is, so the lists
 * are what keep a script, a link or a style out of it. They hold what Tabler
 * and our own artwork actually draw with; anything else fails the build rather
 * than reaching a reader.
 */
const INLINE_SHAPES = new Set(["path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
const INLINE_ATTRIBUTES = new Set([
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
  "fill",
  "stroke",
  "opacity"
]);
// Path data, numbers and the two colour words; no parenthesis, so no `url()`.
const INLINE_VALUE = /^[0-9a-zA-Z .,-]*$/;

/**
 * One icon's shapes as the inside of a 24-unit SVG.
 *
 * @param {string} name the icon, for the error a bad shape fails with
 * @param {[string, Record<string, string>][]} nodes Tabler's node list form
 * @returns {string}
 */
export function inlineMarkup(name, nodes) {
  if (nodes.length === 0) throw new Error(`"${name}" draws nothing.`);
  return nodes.map(([tag, attributes]) => inlineElement(name, tag, attributes)).join("");
}

/**
 * Our own artwork in Tabler's node list form, ready for `inlineMarkup`.
 *
 * The sources are a root `<svg>` on Tabler's 24-unit grid holding self-closing
 * shapes and nothing else, which is how they are drawn; a group, a comment,
 * text or another grid fails here, where it is one file to fix, rather than on
 * a page that draws every icon in a 24-unit box.
 *
 * @param {string} name
 * @param {string} svg the file's text
 * @returns {[string, Record<string, string>][]}
 */
export function artworkNodes(name, svg) {
  const body = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim());
  if (!body) throw new Error(`"${name}": the artwork is not one <svg> element.`);
  if (!/\sviewBox="0 0 24 24"/.test(body[1] ?? "")) {
    throw new Error(`"${name}": the artwork is not drawn on the 24-unit grid.`);
  }

  const nodes = [];
  const rest = (body[2] ?? "").replace(
    /<([a-z]+)((?:\s+[a-z0-9-]+="[^"]*")*)\s*\/>/g,
    (_, tag, attributes) => {
      const pairs = [...attributes.matchAll(/([a-z0-9-]+)="([^"]*)"/g)];
      nodes.push([tag, Object.fromEntries(pairs.map((pair) => [pair[1], pair[2]]))]);
      return "";
    }
  );
  if (rest.trim() !== "") {
    throw new Error(`"${name}": only self-closing shapes can be drawn inline, not ${rest.trim()}`);
  }
  return nodes;
}

function inlineElement(name, tag, attributes) {
  if (!INLINE_SHAPES.has(tag)) throw new Error(`"${name}": <${tag}> cannot be drawn inline.`);
  const written = Object.entries(attributes).map(([key, value]) => {
    if (!INLINE_ATTRIBUTES.has(key)) {
      throw new Error(`"${name}": the attribute ${key} cannot be drawn inline.`);
    }
    if (!INLINE_VALUE.test(String(value))) {
      throw new Error(`"${name}": ${key}="${value}" is not plain path data or a colour word.`);
    }
    return ` ${key}="${value}"`;
  });
  return `<${tag}${written.join("")}/>`;
}
