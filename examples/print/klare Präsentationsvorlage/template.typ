// A deck in the Klartext theme: one slide to a page, 16:9 or 4:3 as the print
// dialog chooses. The plugin groups the note before this runs — a `#` or `##`
// heading starts a slide and is its title, each `###` opens a column, a rule
// starts an untitled slide — and calls schreibstube-slide once for each.
// Everything here is how a slide looks.
//
// The theme's decisions, carried onto the slide: the text in JetBrains Mono
// and ragged right, headings in Fira Sans set tight, no accent colour. Every
// structural mark is type in a faint grey rather than a drawing: a slide
// title carries its level as a small #₁ or #₂ hung in the margin beside it, a
// list item a dash, a step its bare number. One hairline colour for every
// rule; no filled box but the table header and inline code. Links keep the
// text's colour and carry a dotted rule.
//
// `data.scheme` picks the theme's light or dark palette, the light one unless
// it says "dark". `data.monospace` is "false" when the print dialog's "Text
// font" is Fira Sans; headings and code do not change. `data.subtitle`,
// `data.author` and `data.date` are for the title slide, `data.title` stands
// in the foot of every other slide, and `data.logo`, the file name of a
// picture in this folder, at its top right and above the title on the title
// slide.
//
// A slide that holds more than fits is made smaller as a whole until it does,
// never cut off and never carried onto a second page; schreibstube-fit, from
// the prelude, does that. Small type on a slide is the sign it wants splitting.

#import "schreibstube.typ": (
  schreibstube-fit,
  schreibstube-slide-align,
  schreibstube-slide-block,
  schreibstube-slide-note-mark,
)

// The theme's two palettes, value for value. `rule` is the theme's code
// border, the soft line a slide's column heads and code sit between: the
// hairline the theme draws between surfaces is too faint for a projector.
#let light = (
  ground: rgb("#ffffff"),
  ink: rgb("#333333"),
  muted: rgb("#575757"),
  subtle: rgb("#757575"),
  faint: rgb("#8f8f86"),
  rule: rgb("#d4d4d0"),
  hairline: rgb("#e8e8e6"),
  surface: rgb("#f2f2ee"),
  stripe: rgb("#f9f9f9"),
  mark: rgb("#ffeebe"),
  note: rgb(41, 98, 168),
  tip: rgb(30, 118, 70),
  warning: rgb(178, 78, 22),
  danger: rgb(176, 44, 48),
)
#let dark = (
  ground: rgb("#1a1a1a"),
  ink: rgb("#d4d4d0"),
  muted: rgb("#a6a6a0"),
  subtle: rgb("#7d7d77"),
  faint: rgb("#5e5e59"),
  rule: rgb("#3a3a3a"),
  hairline: rgb("#2e2e2e"),
  surface: rgb("#2b2b2a"),
  stripe: rgb("#202020"),
  mark: rgb("#43391d"),
  note: rgb(122, 168, 232),
  tip: rgb(110, 190, 140),
  warning: rgb(232, 140, 92),
  danger: rgb(230, 120, 120),
)

#let mono = ("JetBrains Mono", "DejaVu Sans Mono")
#let sans = ("Fira Sans", "Libertinus Serif")

// The palette a value names: dark for "dark" or "dunkel", light for anything
// else, so a word mistyped in a note is a light deck, not a print that fails.
#let palette-of(value) = if type(value) == str and lower(value.trim()) in ("dark", "dunkel") {
  dark
} else { light }

// The data the slides read, handed in by the entry below: a slide is called
// from the note's body, where `data` is not in scope.
#let praesentation-data = state("praesentation-data", (:))

// The palette in force where it is asked for. Needs context.
#let colours() = palette-of(praesentation-data.get().at("scheme", default: ""))

// Whether the slide on this page stands on its own — a title slide or a
// section divider — and so carries neither logo nor foot. Each slide leaves
// its kind on its page; the header is set before the slide and could not read
// a state the slide sets. Needs context.
#let plain() = {
  let page = here().page()
  query(<praesentation-kind>).any(mark => mark.location().page() == page and mark.value != "content")
}

// A heading's level as the theme marks it: #₁ … #₆, faint, in the body's
// monospaced face, hung in the margin so the title keeps the slide's edge.
#let level-mark(level) = "#" + str.from-unicode(0x2080 + calc.clamp(level, 1, 6))

// A title as the converter hands it over, without the line break at either
// end: after the mark it would be a space, and the title would leave the edge.
#let trimmed(body) = {
  if not body.has("children") { return body }
  let space = [ ].func()
  let parts = body.children
  while parts.len() > 0 and parts.first().func() == space { parts = parts.slice(1) }
  while parts.len() > 0 and parts.last().func() == space { parts = parts.slice(0, -1) }
  parts.join()
}

#let hung(level, body) = context {
  let mark = text(font: mono, size: 0.42em, weight: 400, tracking: 0em, fill: colours().faint, level-mark(level))
  let gap = 0.5em
  let width = measure(mark).width + gap
  [#h(-width)#box(width: width, mark)#trimmed(body)]
}

// A caption in the body's face, muted, a step smaller.
#let caption(body) = context text(size: 0.7em, fill: colours().muted, body)

// The pictures in body, their captions beside them — on the right, level with
// the picture's foot — or beneath: beside on a slide's full width, where a
// line under the picture would take height the slide needs; beneath in a
// column, which is too narrow for it. The prelude's own, in the palette.
#let schreibstube-slide-pictures(beside, body) = {
  show figure.where(kind: "schreibstube-slide-image"): it => {
    if it.caption == none { return it.body }
    if beside {
      grid(columns: (3fr, 1fr), column-gutter: 1em, align: (auto, left + bottom), it.body, caption(
        it.caption.body,
      ))
    } else {
      block(breakable: false, width: 100%, stack(spacing: 0.5em, it.body, caption(it.caption.body)))
    }
  }
  body
}

// A picture with a space of its own — a slide that is one picture, or the
// picture half of image-left and image-right — as large as the space allows
// and never cropped. The prelude's own, in the palette.
#let schreibstube-slide-filled(beside, body) = layout(size => {
  show figure.where(kind: "schreibstube-slide-image"): it => {
    let picture(height) = image(it.body.source, width: 100%, height: height, fit: "contain")
    if it.caption == none { return picture(size.height) }
    let words = caption(it.caption.body)
    if beside {
      grid(columns: (3fr, 1fr), column-gutter: 1em, align: (auto, left + bottom), picture(size.height), words)
    } else {
      let below = measure(block(width: size.width, words)).height + 0.5em
      stack(spacing: 0.5em, picture(size.height - below), words)
    }
  }
  body
})

// The part of a slide under its title, as the prelude lays it out, calling
// the two above.
#let schreibstube-slide-area(layout, picture, body) = block(height: 1fr, width: 100%, {
  if layout == "picture" {
    schreibstube-slide-filled(true, picture)
  } else if layout == "image-left" or layout == "image-right" {
    let side = block(height: 100%, width: 100%, schreibstube-slide-filled(false, picture))
    let rest = block(height: 100%, width: 100%, schreibstube-fit(body))
    grid(
      columns: (1fr, 1fr),
      rows: (100%,),
      column-gutter: 1.5em,
      ..if layout == "image-left" { (side, rest) } else { (rest, side) },
    )
  } else {
    schreibstube-fit(body)
  }
})

#let schreibstube-slide(
  kind: "content",
  level: 2,
  horizontal: center,
  title: none,
  columns: 1,
  widths: none,
  layout: "text",
  picture: none,
  notes: none,
  intro: [],
  cells: (),
) = {
  pagebreak(weak: true)
  schreibstube-slide-note-mark(title, notes)
  [#metadata(kind) <praesentation-kind>]
  show: schreibstube-slide-align.with(horizontal)

  if kind == "title" {
    block(height: 100%, width: 100%, align(horizon, context {
      let data = praesentation-data.get()
      let ink = colours()
      let logo = data.at("logo", default: "")
      if logo != "" {
        schreibstube-slide-block(image(logo, height: 16mm))
        v(1.2em)
      }
      schreibstube-slide-block(heading(level: 1, text(size: 46pt, hung(1, title))))
      let subtitle = data.at("subtitle", default: "")
      if subtitle != "" {
        v(0.2em)
        schreibstube-slide-block(text(font: sans, size: 22pt, fill: ink.muted, subtitle))
      }
      let byline = (data.at("author", default: ""), data.at("date", default: "")).filter(x => x != "")
      if byline.len() > 0 {
        v(1.6em)
        schreibstube-slide-block(text(font: mono, size: 13pt, fill: ink.subtle, byline.join("  ·  ")))
      }
    }))
    return
  }
  if kind == "section" {
    block(height: 100%, width: 100%, align(horizon, schreibstube-slide-block(heading(
      level: 1,
      text(size: 40pt, hung(1, title)),
    ))))
    return
  }

  let body = {
    // A heading inside the body — in a callout, or below a column's — is no
    // slide title, and is set no larger than a column's.
    show heading: set text(size: 1.1em)
    show heading: set block(above: 1em, below: 0.5em)
    schreibstube-slide-pictures(true, intro)
    if cells.len() > 0 {
      grid(
        columns: if widths == none { (1fr,) * columns } else { widths },
        column-gutter: 1.6em,
        row-gutter: 1.2em,
        ..cells.map(((head, main)) => block(width: 100%, {
          context block(
            below: 0.6em,
            inset: (bottom: 0.35em),
            stroke: (bottom: 0.75pt + colours().rule),
            width: 100%,
            schreibstube-slide-block(text(font: sans, weight: 600, size: 1.05em, tracking: -0.01em, head)),
          )
          schreibstube-slide-pictures(false, main)
        })),
      )
    }
  }
  if title != none {
    let level = calc.max(level, 1)
    schreibstube-slide-block(heading(level: level, hung(level, title)))
    v(0.5em)
  }
  schreibstube-slide-area(layout, picture, body)
}

// Code: no box. A hairline above and below, and a header naming the language
// with the theme's mark. On the dark ground the text keeps the palette's ink:
// the typesetter's highlighting colours are chosen for white paper.
#let schreibstube-code(source, language) = context {
  let ink = colours()
  block(width: 100%, inset: (y: 7pt), stroke: (top: 0.75pt + ink.rule, bottom: 0.75pt + ink.rule), {
    set text(font: mono, style: "normal", size: 0.78em)
    if language != "" {
      text(size: 0.85em, fill: ink.faint)[\</\> #language]
      v(2pt)
    }
    raw(
      source,
      block: true,
      lang: if language == "" { none } else { language },
      theme: if ink == dark { none } else { auto },
    )
  })
}

// Tables: the theme's grey header row in the heading face, a hairline grid,
// and a faint zebra. A cell is a column a few words wide, so it never
// hyphenates.
#let schreibstube-table(columns: 1, align: (left,), ..cells) = context {
  let ink = colours()
  set par(justify: false)
  set text(hyphenate: false, size: 0.88em)
  show table.cell.where(y: 0): set text(font: sans, weight: 600, size: 1.04em)
  table(
    columns: columns,
    align: align,
    inset: (x: 9pt, y: 6pt),
    stroke: 0.75pt + ink.rule,
    fill: (x, y) => if y == 0 { ink.surface } else if calc.even(y) { ink.stripe } else { none },
    ..cells,
  )
}

// Callouts: a bar in the kind's colour and a small capital label, as the
// theme draws them. No box around the body.
#let schreibstube-callout(kind, title, body) = context {
  let ink = colours()
  let colour = ink.at(if kind in ("tip", "warning", "danger") { kind } else { "note" })
  block(width: 100%, inset: (left: 12pt, y: 3pt), stroke: (left: 1.5pt + colour))[
    #text(font: sans, weight: 600, size: 0.7em, fill: colour, tracking: 0.05em, upper(title))
    #v(0.05em)
    #body
  ]
}

// A task's box, in the marks' grey. It stands where a bullet would.
#let schreibstube-task(done) = context {
  let ink = colours()
  box(
    width: 0.66em,
    height: 0.66em,
    baseline: 0.04em,
    stroke: 0.9pt + ink.faint,
    radius: 1.5pt,
    inset: 0.13em,
    if done { box(width: 100%, height: 100%, fill: ink.muted, radius: 0.5pt) },
  )
}

// The note's properties, when a print asks for them: keys in the marks'
// grey, a hairline under the list.
#let schreibstube-properties(rows) = context {
  let ink = colours()
  block(width: 100%, below: 1.2em, inset: (bottom: 0.5em), stroke: (bottom: 0.75pt + ink.rule), {
    set text(size: 0.8em)
    grid(
      columns: (auto, 1fr),
      column-gutter: 1.2em,
      row-gutter: 0.5em,
      ..rows.map(row => (text(fill: ink.faint, row.at(0)), row.at(1))).flatten(),
    )
  })
}

#let praesentation(body, data) = {
  let ink = palette-of(data.at("scheme", default: ""))
  let monospaced = lower(data.monospace) not in ("false", "no", "off")
  let logo = data.at("logo", default: "")

  set document(title: data.title)
  // The paper is the dialog's format and the margins the descriptor's, so
  // neither is set here. The logo stands in the top margin, clear of the
  // title, on every slide that carries the foot.
  set page(
    fill: ink.ground,
    header: context {
      if logo != "" and not plain() { align(right + bottom, image(logo, height: 7mm)) }
    },
    footer: context {
      if not plain() {
        set text(font: mono, size: 9pt, fill: ink.subtle)
        // Flush on both sides whatever the slides above it ask for.
        grid(columns: (1fr, auto), align: (left, right), data.title, counter(page).display(
          "1 / 1",
          both: true,
        ))
      }
    },
  )
  set text(
    font: if monospaced { mono } else { sans },
    size: if monospaced { 18pt } else { 20pt },
    fill: ink.ink,
    lang: data.lang,
  )
  set par(justify: false, leading: if monospaced { 0.72em } else { 0.62em }, spacing: 1em)

  // Headings in Fira Sans, tight: the theme's weights and letter-spacing.
  show heading: set text(font: sans, fill: ink.ink, weight: 600, tracking: -0.02em)
  show heading: set block(above: 0.6em, below: 1em)
  show heading.where(level: 1): set text(size: 30pt, weight: 700, tracking: -0.03em)
  show heading.where(level: 2): set text(size: 30pt)
  show heading.where(level: 3): set text(size: 22pt)
  show heading.where(level: 4): set text(size: 20pt)

  // Marks: a dash for a bullet at every level, a bare number for a step, both
  // faint, the text one cell further in.
  set list(marker: text(fill: ink.faint)[–], indent: 0pt, body-indent: 0.6em, spacing: 0.75em)
  set enum(numbering: n => text(fill: ink.faint)[#n], indent: 0pt, body-indent: 0.6em, spacing: 0.75em)

  // Quotes: a thin bar, the text muted and italic.
  show quote.where(block: true): it => block(inset: (left: 12pt, y: 2pt), stroke: (left: 1.5pt + ink.faint), {
    set text(style: "italic", fill: ink.muted)
    it.body
  })

  // Links keep the text's colour and carry a dotted rule, as the theme draws
  // a link that leaves the vault.
  show link: it => underline(stroke: (paint: ink.ink, thickness: 0.75pt, dash: "dotted"), offset: 3pt, it)
  show raw: set text(font: mono, style: "normal")
  show raw.where(block: false): it => box(
    fill: ink.surface,
    inset: (x: 3pt),
    outset: (y: 3pt),
    radius: 2pt,
    text(size: 0.9em, it),
  )
  show highlight: set highlight(fill: ink.mark)
  show line: set line(stroke: 0.75pt + ink.rule)
  show footnote.entry: set text(size: 10pt, fill: ink.muted)

  praesentation-data.update(data)
  body
}
