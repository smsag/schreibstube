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

// The note's properties, when a print asks for them: a quiet two-column list
// above the text, each row a key and its value.
#let schreibstube-properties(rows) = block(
  width: 100%,
  below: 1.4em,
  inset: (bottom: 0.6em),
  stroke: (bottom: 0.5pt + luma(200)),
  {
    set text(size: 0.88em)
    set par(justify: false)
    grid(
      columns: (auto, 1fr),
      column-gutter: 1.2em,
      row-gutter: 0.55em,
      ..rows.map(row => (text(fill: luma(100), row.at(0)), row.at(1))).flatten(),
    )
  },
)

// A slideshow, arranged as the print asked. Each picture arrives as a path and
// its description. "single" and "stacked" set them at the text's width with
// the description beneath; "filmstrip" is its first picture over a row of
// thumbnails; "feature" one large scene beside two details; "strip" equal
// tiles; "masonry" columns at the pictures' own proportions; "compare" two
// side by side, each named. Tiles are cut to the proportions the screen gives
// them, so the page looks like the note.
#let schreibstube-slideshow(kind, images, columns: 1) = {
  let gap = 4pt
  let caption(alt) = if alt != "" {
    align(center, text(size: 0.85em, fill: luma(90), alt))
  }
  let tile(path, w, h) = image(path, width: w, height: h, fit: "cover")
  if kind == "single" or kind == "stacked" {
    for (path, alt) in images {
      block(breakable: false, width: 100%, below: 1em, {
        align(center, image(path, width: 100%, fit: "contain"))
        caption(alt)
      })
    }
  } else if kind == "filmstrip" {
    let (stage, ..thumbs) = images
    block(breakable: false, width: 100%, layout(size => {
      align(center, image(stage.at(0), width: 100%, fit: "contain"))
      caption(stage.at(1))
      let w = (size.width - gap * (columns - 1)) / columns
      grid(columns: (w,) * columns, gutter: gap, ..thumbs.map(t => tile(t.at(0), w, w * 3 / 4)))
    }))
  } else if kind == "feature" {
    block(breakable: false, width: 100%, layout(size => {
      let main = (size.width - gap) * 2 / 3
      let height = main * 2 / 3
      let side = size.width - gap - main
      let details = images.slice(1)
      let each = if details.len() == 0 { height } else {
        (height - gap * (details.len() - 1)) / details.len()
      }
      grid(
        columns: (main, side),
        gutter: gap,
        tile(images.at(0).at(0), main, height),
        stack(spacing: gap, ..details.map(d => tile(d.at(0), side, each))),
      )
    }))
  } else if kind == "strip" {
    block(breakable: false, width: 100%, layout(size => {
      let w = (size.width - gap * (columns - 1)) / columns
      grid(columns: (w,) * columns, gutter: gap, ..images.map(i => tile(i.at(0), w, w * 3 / 4)))
    }))
  } else if kind == "masonry" {
    // Balanced columns in reading order, as the screen's CSS columns set them:
    // each picture measured, the series cut into columns of equal height, down
    // one and on to the next. Typst's own columns fill the first to the foot of
    // the page instead. A series taller than a page goes on in a further block.
    layout(size => {
      let w = (size.width - gap * (columns - 1)) / columns
      let limit = if size.height < 40cm { size.height } else { 22cm }
      let heights = images.map(i => measure(image(i.at(0), width: w)).height + gap)
      let chunks = ()
      let chunk = ()
      let sum = 0pt
      for k in range(images.len()) {
        if chunk.len() > 0 and sum + heights.at(k) > limit * columns * 0.75 {
          chunks.push(chunk)
          chunk = ()
          sum = 0pt
        }
        chunk.push(k)
        sum += heights.at(k)
      }
      if chunk.len() > 0 { chunks.push(chunk) }
      for chunk in chunks {
        let target = chunk.map(k => heights.at(k)).sum() / columns
        let cols = range(columns).map(_ => ())
        let current = 0
        let filled = 0pt
        for k in chunk {
          let h = heights.at(k)
          if filled > 0pt and filled + h / 2 > target and current < columns - 1 {
            current += 1
            filled = 0pt
          }
          cols.at(current).push(image(images.at(k).at(0), width: w))
          filled += h
        }
        block(breakable: false, below: gap, grid(
          columns: (w,) * columns,
          column-gutter: gap,
          ..cols.map(c => stack(spacing: gap, ..c)),
        ))
      }
    })
  } else if kind == "compare" {
    block(breakable: false, width: 100%, layout(size => {
      let w = (size.width - gap) / 2
      grid(
        columns: (w, w),
        gutter: gap,
        ..images.map(i => stack(spacing: 3pt, tile(i.at(0), w, w * 2 / 3), caption(i.at(1)))),
      )
    }))
  }
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
