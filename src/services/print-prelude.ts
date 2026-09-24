/**
 * The helpers every converted note calls, and a template may replace.
 *
 * The converter emits `#schreibstube-image`, `-diagram`, `-table` and
 * `-callout` rather than Typst's own primitives, for one reason: how a
 * diagram sits on a page, how wide a table runs, what a warning looks like,
 * are design decisions, and design decisions belong to the template. These are
 * the defaults for a template that has no opinion; a template with one defines
 * its own at the top level of its layout, and its definition wins: `main.typ`
 * imports the prelude first and the layout after it.
 *
 * Written as source rather than assembled, because it is read by whoever
 * writes a template and has to look like what they would write themselves.
 */
export const PRELUDE_FILE = "schreibstube.typ";

export const PRELUDE_SOURCE = `// Defaults the converted note calls. A template may define any of these
// at the top level of its layout, and its version is used instead.

#let schreibstube-image(path, alt) = {
  figure(image(path, width: 100%), caption: none)
}

// The drawings of one fence: each full text width, none split over a page, and
// scaled down rather than cropped when one is taller than the page it lands on.
// Several arrive when a fence holds a carousel, whose panels a page shows all
// at once. The caption belongs to the fence, so it follows the last of them and
// stays in the same unbreakable block, where a page break cannot separate them.
#let schreibstube-diagram(paths, caption) = {
  let last = paths.len() - 1
  for (index, path) in paths.enumerate() {
    block(breakable: false, width: 100%)[
      #set align(center)
      #image(path, width: 100%, fit: "contain")
      #if index == last and caption != "" [
        #v(0.3em)
        #text(size: 0.85em, fill: luma(90))[#caption]
      ]
    ]
  }
}

// Breakable, like the callout below: a block that may not break and is longer
// than a page does not move to the next one, it runs off the bottom of this one.
#let schreibstube-code(source, language) = {
  block(
    breakable: true,
    width: 100%,
    fill: luma(245),
    inset: 8pt,
    radius: 3pt,
    raw(source, lang: if language == "" { none } else { language }),
  )
}

#let schreibstube-table(columns: 1, align: (left,), ..cells) = {
  set table(stroke: (x, y) => if y == 0 { (bottom: 0.6pt + luma(120)) } else { none })
  // A cell is a column a few words wide. Justifying one stretches its spaces
  // to the margins and hyphenates what is left, which is how a price column
  // ends up unreadable; the surrounding page keeps whatever it had.
  set par(justify: false)
  set text(hyphenate: false)
  table(columns: columns, align: align, inset: (x: 6pt, y: 4pt), ..cells)
}

// The body arrives as the third argument: Typst hands a trailing content block
// to the function it follows, so callout(kind, title)[body] is one call.
#let schreibstube-callout(kind, title, body) = {
  let accent = if kind == "warning" { rgb("#c08a2e") } else if kind == "danger" {
    rgb("#b4534a")
  } else if kind == "tip" { rgb("#4f8a6b") } else { luma(120) }

  block(
    breakable: true,
    width: 100%,
    inset: (x: 10pt, y: 8pt),
    stroke: (left: 2pt + accent, rest: 0.5pt + luma(200)),
    radius: 2pt,
  )[
    #text(weight: 700)[#title]
    #v(0.2em)
    #body
  ]
}

// A task's box, drawn rather than typed so that no font has to carry the glyph.
#let schreibstube-task(done) = box(
  width: 0.75em,
  height: 0.75em,
  baseline: 0.05em,
  stroke: 0.6pt + luma(90),
  inset: 0.15em,
  if done { box(width: 100%, height: 100%, fill: luma(90)) },
)
`;
