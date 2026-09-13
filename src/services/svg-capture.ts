/**
 * Turning a drawn diagram into a picture a page can hold.
 *
 * Mermaid and the canvas plugins draw SVG into the document. SVG is exactly
 * what a PDF would like to be given — but the drawing leans on the stylesheet
 * around it, and the moment it leaves the document that stylesheet is gone.
 * Rasterising it while it is still in the document keeps what it looked like,
 * at the cost of pixels; at twice the page's resolution nobody can tell.
 *
 * What can be decided about an SVG without a browser is decided here: how big
 * it is, how big the picture should be, and what has to be written into the
 * markup so that it draws the same detached as it did attached.
 */

/** Pixels per CSS pixel. Twice is a print that stays sharp; more is weight. */
export const CAPTURE_SCALE = 2;

/** Neither dimension may pass this, or a phone runs out of memory drawing it. */
export const MAX_CAPTURE_PX = 4000;

/** Below this an SVG is a glyph, not a diagram, and something went wrong. */
const MIN_CAPTURE_PX = 8;

export interface Size {
  width: number;
  height: number;
}

/**
 * How large a diagram is, from what the markup says.
 *
 * Three sources in decreasing order of trust: the size the browser measured,
 * the `viewBox` the drawing declares, and the width and height attributes. A
 * mermaid diagram gives a viewBox and a percentage width, so the measured box
 * is the only one that knows how wide it actually became.
 */
export function svgSize(svg: string, measured?: Partial<Size>): Size | null {
  if (isUsable(measured?.width) && isUsable(measured?.height)) {
    return { width: measured.width, height: measured.height };
  }

  const viewBox =
    /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/.exec(svg);
  if (viewBox) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (isUsable(width) && isUsable(height)) return { width, height };
  }

  const width = lengthAttribute(svg, "width");
  const height = lengthAttribute(svg, "height");
  if (width !== null && height !== null) return { width, height };

  return null;
}

/**
 * The pixel size to draw at: the diagram's own size at the capture scale, held
 * under the limit without changing its shape.
 */
export function captureSize(size: Size, scale = CAPTURE_SCALE): Size {
  const width = size.width * scale;
  const height = size.height * scale;
  const longest = Math.max(width, height);

  if (longest <= MAX_CAPTURE_PX) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }

  const shrink = MAX_CAPTURE_PX / longest;
  return {
    width: Math.max(1, Math.round(width * shrink)),
    height: Math.max(1, Math.round(height * shrink))
  };
}

/**
 * The markup, made to stand on its own.
 *
 * An SVG about to be drawn into a canvas is parsed on its own, with no
 * document and no stylesheet: it needs its namespace stated, its size in
 * pixels rather than in percent, and a background, since a transparent diagram
 * on white paper loses every light stroke in it.
 */
export function standaloneSvg(svg: string, size: Size, background = "#ffffff"): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return svg;

  let attributes = open[0]
    .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/g, "")
    .replace(/<svg\b/, "<svg");

  if (!/xmlns\s*=/.test(attributes)) {
    attributes = attributes.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/xmlns:xlink\s*=/.test(attributes) && /xlink:/.test(svg)) {
    attributes = attributes.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  attributes = attributes.replace(/\/?>$/, ` width="${size.width}" height="${size.height}">`);

  const rect = `<rect x="0" y="0" width="100%" height="100%" fill="${background}"/>`;
  return attributes + rect + svg.slice(open[0].length);
}

/** A length attribute in pixels, ignoring one given as a percentage. */
function lengthAttribute(svg: string, name: string): number | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`).exec(svg);
  if (!match?.[1]) return null;
  if (match[1].includes("%")) return null;
  const value = Number.parseFloat(match[1]);
  return isUsable(value) ? value : null;
}

function isUsable(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_CAPTURE_PX;
}
