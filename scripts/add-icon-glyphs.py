"""
Draw the icons Tabler does not have into the subset font.

Called by scripts/build-icon-font.mjs, never on its own. The sources are
authored the way Tabler's are — a 24-unit grid, a 2-unit stroke, round caps
and joins — but a font glyph is a filled outline, so each stroke is outlined
first. The outline then goes through the same mapping Tabler's own glyphs
went through: 1000 units to the em, 24 grid units to the em, the grid's top
edge at the ascender. A logo therefore lands on the same box and at the same
weight as the glyph beside it in the picker.

Usage: add-icon-glyphs.py <in.woff2> <out.woff2> <name> <codepoint> <svg> ...
"""

import sys

from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from picosvg.svg import SVG

GRID = 24


def outline(svg_path):
    """The stroked artwork as filled path data, on the 24-unit grid."""
    svg = SVG.parse(svg_path).topicosvg()
    paths = [shape.d for shape in svg.shapes()]
    if not paths:
        raise SystemExit(f"{svg_path} draws nothing.")
    return paths


def add_glyph(font, name, codepoint, svg_path):
    upem = font["head"].unitsPerEm
    ascent = font["hhea"].ascent
    unit = upem / GRID

    pen = TTGlyphPen(None)
    # SVG's y runs down and the font's up: flip, then lift the grid's top
    # edge to the ascender, where Tabler's own glyphs put it.
    transformed = TransformPen(pen, (unit, 0, 0, -unit, 0, ascent))
    for d in outline(svg_path):
        parse_path(d, transformed)
    glyph = pen.glyph()

    order = font.getGlyphOrder()
    if name in order:
        raise SystemExit(f"The font already has a glyph called {name}.")
    font.setGlyphOrder(order + [name])
    font["glyf"][name] = glyph
    glyph.recalcBounds(font["glyf"])
    font["hmtx"][name] = (upem, glyph.xMin)

    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        if table.format in (4, 0) and codepoint > 0xFFFF:
            continue
        # Subtables stored at one offset share one mapping once loaded, so
        # the second may already carry what the first was given.
        if table.cmap.get(codepoint, name) != name:
            raise SystemExit(f"U+{codepoint:X} is taken in the font already.")
        table.cmap[codepoint] = name


def main(argv):
    if len(argv) < 3 or (len(argv) - 2) % 3 != 0:
        raise SystemExit(__doc__)

    source, target, specs = argv[0], argv[1], argv[2:]
    # No fresh timestamp: the generated file is committed, and a rebuild with
    # nothing changed should leave it byte for byte as it was.
    font = TTFont(source, recalcTimestamp=False)

    names = []
    for i in range(0, len(specs), 3):
        name, codepoint, svg_path = specs[i], int(specs[i + 1], 16), specs[i + 2]
        add_glyph(font, name, codepoint, svg_path)
        names.append(name)

    # The outlined strokes overlap where the artwork's lines meet: union them,
    # so no renderer has to decide what an overlap means.
    removeOverlaps(font, names)

    font.flavor = "woff2"
    font.save(target)


if __name__ == "__main__":
    main(sys.argv[1:])
