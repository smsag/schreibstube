/**
 * The colour actually painted behind an element, from the backgrounds of its
 * ancestors.
 *
 * A sticky header has to paint something, or rows show through where it
 * holds. The one colour certainly right is what is already behind the pane,
 * and that is not one ancestor's background but all of them laid over each
 * other: a theme with window translucency paints its sidebar as a tint, and
 * the tint alone, painted opaque, is the wrong colour. So the layers are
 * composited, innermost last, from the nearest one that is opaque.
 *
 * Computed styles arrive as `rgb()` or `rgba()`, in either the comma or the
 * slash notation, or as the keyword `transparent`; anything else is not a
 * colour the browser would have painted and is skipped.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const COLOUR_PATTERN =
  /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

export function parseCssColour(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const match = COLOUR_PATTERN.exec(text);
  if (!match) return null;

  const [, r, g, b, alpha] = match;
  const a =
    alpha === undefined
      ? 1
      : alpha.endsWith("%")
        ? Number(alpha.slice(0, -1)) / 100
        : Number(alpha);
  const channel = (raw: string | undefined) => Math.min(255, Math.max(0, Number(raw ?? 0)));
  if (!Number.isFinite(a)) return null;
  return { r: channel(r), g: channel(g), b: channel(b), a: Math.min(1, Math.max(0, a)) };
}

/** `top` painted over `under`, which is opaque. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1
  };
}

/**
 * The colour behind the innermost of `layers`, given innermost first — the
 * element's own background, then its parent's, and so on outward.
 *
 * Compositing starts at the nearest opaque layer; what is behind that cannot
 * show. When nothing is opaque — a translucent window, where what is behind
 * the outermost tint is the desktop — the outermost tint is taken as if it
 * were solid, which is the nearest thing to what the eye sees there. When
 * nothing paints at all there is no answer, and null says so.
 */
export function groundColour(layers: readonly string[]): string | null {
  const painted: { colour: Rgba; index: number }[] = [];
  layers.forEach((layer, index) => {
    const colour = parseCssColour(layer);
    if (colour && colour.a > 0) painted.push({ colour, index });
  });
  if (painted.length === 0) return null;

  const base = painted.find(({ colour }) => colour.a >= 1) ?? painted[painted.length - 1]!;
  let result: Rgba = { ...base.colour, a: 1 };

  // Outer layers first, so each inner one lands on top of what is behind it.
  const inner = painted.filter(({ index }) => index < base.index).sort((x, y) => y.index - x.index);
  for (const { colour } of inner) result = over(colour, result);

  return `rgb(${Math.round(result.r)}, ${Math.round(result.g)}, ${Math.round(result.b)})`;
}
