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

// A slide's body, made smaller until it fits the space it is given, and never
// larger. It is set wider and the whole scaled down, so lines stay as long as
// the space and every size on the slide keeps its proportion to the others. A
// body that does not get shorter when it is set wider — a picture at the full
// width grows with it — is scaled as it stands instead, which always fits.
//
// Every measurement sets the whole slide again, which on a phone is the cost
// of a long deck, so the search is short. Text set 1/f wider runs about f as
// tall, so the square root of the space over the natural height is measured
// first. The two heights then give the curve the slide follows, height ≈
// natural · f^p, and the factor that curve says fills the space, a hair under,
// is measured last. A slide that fits is measured once, one that shrinks three
// times, and the worst case five.
//
// The scale it settles on is left as metadata labelled <schreibstube-fit>,
// with the page, so the print can say which slides were set small.
#let schreibstube-fit(body) = layout(size => {
  let tall(factor) = measure(block(width: size.width / factor, body)).height * factor
  let natural = tall(1.0)
  if natural <= size.height { return block(width: size.width, body) }
  let low = size.height / natural
  let guess = calc.sqrt(low)
  let at-guess = tall(guess)
  let power = calc.ln(at-guess / natural) / calc.ln(guess)
  let aimed = if power > 1 { calc.min(1.0, calc.exp(calc.ln(low) / power) * 0.99) } else { 0.0 }
  let factor = if aimed > guess and tall(aimed) <= size.height { aimed } else if (
    at-guess <= size.height
  ) { guess } else if aimed > low and tall(aimed) <= size.height { aimed } else if (
    tall(low) <= size.height
  ) { low } else { none }
  if factor == none {
    // Nothing set wider fits: scaled as it stands, which always does.
    [#metadata((page: here().page(), scale: low)) <schreibstube-fit>]
    return scale(low * 100%, origin: top + left, reflow: true, block(width: size.width, body))
  }
  [#metadata((page: here().page(), scale: factor)) <schreibstube-fit>]
  scale(factor * 100%, origin: top + left, reflow: true, block(width: size.width / factor, body))
})

// A picture on a slide, with its alt text as the caption. A figure of its own
// kind rather than a drawing, so the slide decides where the caption goes: a
// slide sets its full-width part and its columns under different rules
// (schreibstube-slide-pictures), and a figure is what a show rule can reach.
#let schreibstube-slide-image(path, alt) = figure(
  image(path, width: 100%),
  kind: "schreibstube-slide-image",
  supplement: none,
  numbering: none,
  caption: if alt == "" { none } else { alt },
)

// The pictures in body, their captions beside them — on the right, level with
// the picture's foot — or beneath. Beside is for a slide's full width, where a
// line under the picture would take height the slide needs; a column is too
// narrow for it.
#let schreibstube-slide-pictures(beside, body) = {
  show figure.where(kind: "schreibstube-slide-image"): it => {
    if it.caption == none { return it.body }
    let words = text(size: 0.7em, fill: luma(90), it.caption.body)
    if beside {
      grid(
        columns: (3fr, 1fr),
        column-gutter: 1em,
        align: (auto, left + bottom),
        it.body,
        words,
      )
    } else {
      block(breakable: false, width: 100%, stack(spacing: 0.5em, it.body, words))
    }
  }
  body
}

// One block of a slide — a paragraph, a list, a table, a heading — placed by
// the alignment in force, its own lines flush left. Centred, the block stands
// in the middle as a whole, as wide as its longest line, and reads like any
// text; a block as wide as the slide looks the same either way. The converter
// wraps every block of a slide in it.
#let schreibstube-slide-block(body) = context align(align.alignment, box({
  set align(left)
  body
}))

// The alignment a slide's blocks are placed by: center or left.
#let schreibstube-slide-align(horizontal, body) = {
  set align(horizontal)
  body
}

// One slide to a page, as the converter groups a note for a slide template.
// kind: "title" opens the deck, "section" divides it, "content" is the rest;
// level is the heading that opened the slide, 0 for none; horizontal is
// center or left, where the content stands across the page. The title stands on
// top; the intro and then the column cells, each (title, body), share the
// rest of the page and shrink together when they do not fit it. The prelude
// is imported into a layout like any file, so a template that draws its own
// slide still reaches schreibstube-fit with
// #import "schreibstube.typ": schreibstube-fit
#let schreibstube-slide(
  kind: "content",
  level: 2,
  horizontal: center,
  title: none,
  columns: 1,
  intro: [],
  cells: (),
) = {
  pagebreak(weak: true)
  show: schreibstube-slide-align.with(horizontal)
  if kind != "content" {
    block(height: 100%, width: 100%, align(horizon, heading(level: 1, title)))
    return
  }
  let body = {
    schreibstube-slide-pictures(true, intro)
    if cells.len() > 0 {
      grid(
        columns: (1fr,) * columns,
        column-gutter: 1.5em,
        row-gutter: 1em,
        ..cells.map(((head, main)) => block(width: 100%, {
          schreibstube-slide-block(strong(head))
          parbreak()
          schreibstube-slide-pictures(false, main)
        })),
      )
    }
  }
  if title != none { schreibstube-slide-block(heading(level: calc.max(level, 1), title)) }
  // The rest of the page, less what its footnotes need: a fraction of the
  // flow is measured after them, where a grid row claimed the whole page.
  block(height: 1fr, width: 100%, schreibstube-fit(body))
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

// A bulleted task: a list of one item whose marker is the task's box, so the
// box stands where the bullet would. The converter passes the box in, drawn by
// whichever schreibstube-task is in force, so a template that redraws the box
// needs nothing more. Consecutive items are separate lists, which Typst would
// part by a paragraph's spacing; the block spacing is set to the list's own,
// and the larger of two neighbouring gaps wins, so the space around the list
// is what it was.
#let schreibstube-task-item(marker, body) = context {
  let gap = if list.spacing == auto { par.leading } else { list.spacing }
  set block(spacing: gap)
  list(marker: marker, body)
}
`;
