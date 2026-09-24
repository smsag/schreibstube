/**
 * The site's icon, the small picture a browser shows in its tab, named by the
 * site's own stylesheet.
 *
 * A theme is where a site's look lives, and the logo already stands in it, so
 * the icon is named there too: `--site-icon: url("data:image/svg+xml,…")`. The
 * bridge reads it out of the theme it was sent and writes it as a file of its
 * own, because a browser asks for an icon by address and never looks inside a
 * stylesheet for one. No new field in the index: a theme was always sent.
 *
 * The icon is served from the site's own domain, where an SVG opened on its
 * own would run whatever it carries, so it is checked like any other input:
 * an SVG or a PNG, no larger than a small picture needs, and an SVG with no
 * script, no event handler and nothing it loads from elsewhere. An icon that
 * fails is left out — the site loses its tab icon, not its publish.
 */

/** Far more than an icon needs; a drawing of a pile is under one kilobyte. */
export const MAX_SITE_ICON_BYTES = 32_000;

// A quoted value ends at its quote, so the brackets of a media query inside
// the drawing do not end it; an unquoted one ends at the first bracket.
const DECLARATION =
  /--site-icon\s*:\s*url\(\s*(?:"(data:[^"]*)"|'(data:[^']*)'|(data:[^"')\s]+))\s*\)/;

/**
 * The icon a theme names, as a file: `{ path, bytes }`, or null when the theme
 * names none or names one the site will not serve.
 */
export function siteIconFromTheme(css) {
  if (typeof css !== "string") return null;
  const match = DECLARATION.exec(css);
  if (!match) return null;

  const decoded = decodeDataUri(match[1] ?? match[2] ?? match[3]);
  if (!decoded || decoded.bytes.length === 0 || decoded.bytes.length > MAX_SITE_ICON_BYTES) {
    return null;
  }

  if (decoded.type === "image/svg+xml") {
    return isSafeSvg(decoded.bytes.toString("utf8"))
      ? { path: "assets/site-icon.svg", type: decoded.type, bytes: decoded.bytes }
      : null;
  }
  if (decoded.type === "image/png") {
    return isPng(decoded.bytes)
      ? { path: "assets/site-icon.png", type: decoded.type, bytes: decoded.bytes }
      : null;
  }
  return null;
}

/** A `data:` URI's type and bytes, percent-encoded or base64, or null. */
export function decodeDataUri(uri) {
  const match = /^data:([a-z0-9.+/-]+)((?:;[a-z0-9=.-]+)*),(.*)$/is.exec(String(uri).trim());
  if (!match) return null;
  const type = match[1].toLowerCase();
  const base64 = /;base64/i.test(match[2]);
  try {
    const bytes = base64
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
    return { type, bytes };
  } catch {
    return null;
  }
}

/**
 * Whether an SVG is a picture and nothing more: its root is `<svg>`, and it
 * holds no script, no event handler, no `javascript:` and no reference to
 * anything outside itself. Stricter than a drawing needs, which is the point.
 */
export function isSafeSvg(text) {
  const body = text.replace(/^\s*(<\?xml[^>]*\?>\s*)?/, "");
  if (!/^<svg[\s>]/i.test(body)) return false;
  if (/<script[\s>]/i.test(body)) return false;
  if (/<foreignObject[\s>]/i.test(body)) return false;
  if (/\son[a-z]+\s*=/i.test(body)) return false;
  if (/javascript:/i.test(body)) return false;
  if (/(?:xlink:)?href\s*=\s*["']?\s*(?!#)[^"'\s>]/i.test(body)) return false;
  if (/@import|url\(\s*["']?(?!#)/i.test(body)) return false;
  return true;
}

function isPng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length > 8 && signature.every((byte, i) => bytes[i] === byte);
}
