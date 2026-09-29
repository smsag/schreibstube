// A deck: one slide to a page, 16:9 or 4:3 as the print dialog chooses. The
// plugin groups the note before this runs — a `#` or `##` heading starts a
// slide and is its title, a `###` opens one of two columns and a `####` one of
// three, a rule starts an untitled slide — and calls schreibstube-slide once
// for each. Everything here is how a slide looks.
//
// A slide that holds more than fits is made smaller as a whole until it does,
// never cut off and never carried onto a second page; schreibstube-fit, from
// the prelude, does that. Small type on a slide is the sign it wants splitting.
//
// `data.subtitle` and `data.author` are for the title slide, beside the date;
// `data.title` is the note's first heading, and stands in the foot of every
// slide but the title slide and the section dividers.

// The prelude's shrink-to-fit, which every job carries beside this file.
#import "schreibstube.typ": schreibstube-fit

#let ink = rgb("#1f2328")
#let muted = rgb("#5b6470")
#let faint = rgb("#9aa3ad")
#let hairline = rgb("#e3e6ea")
#let surface = rgb("#f4f5f7")
#let accent = rgb("#2f6fb0")
#let sans = ("Fira Sans", "Libertinus Serif")
#let mono = ("JetBrains Mono", "DejaVu Sans Mono")

// Marks which slides carry the foot: a title slide and a section divider
// stand on their own.
#let plain = state("folien-plain", false)

// The data the title slide reads, handed in by the entry below: a slide is
// called from the note's body, where `data` is not in scope.
#let folien-data = state("folien-data", (:))

#let schreibstube-slide(
  kind: "content",
  level: 2,
  title: none,
  columns: 1,
  intro: [],
  cells: (),
) = {
  pagebreak(weak: true)
  plain.update(kind != "content")

  if kind == "title" {
    block(height: 100%, width: 100%, align(horizon, context {
      heading(level: 1, text(size: 40pt, title))
      let data = folien-data.get()
      if data.subtitle != "" {
        v(0.3em)
        text(size: 22pt, fill: muted, data.subtitle)
      }
      v(1.2em)
      line(length: 3cm, stroke: 2pt + accent)
      v(0.6em)
      text(size: 14pt, fill: muted, (data.author, data.date).filter(x => x != "").join(" · "))
    }))
    return
  }
  if kind == "section" {
    block(height: 100%, width: 100%, align(horizon, {
      line(length: 2cm, stroke: 2pt + accent)
      v(0.4em)
      heading(level: 1, text(size: 34pt, title))
    }))
    return
  }

  let body = {
    // A heading inside the body — in a callout, or below a column's — is
    // no slide title, and is set no larger than a column's.
    show heading: set text(size: 22pt)
    intro
    if cells.len() > 0 {
      grid(
        columns: (1fr,) * columns,
        column-gutter: 1.4em,
        row-gutter: 1.2em,
        ..cells.map(((head, main)) => block(width: 100%, {
          block(
            below: 0.5em,
            inset: (bottom: 0.3em),
            stroke: (bottom: 1pt + accent),
            width: 100%,
            text(weight: 600, fill: accent, head),
          )
          main
        })),
      )
    }
  }
  if title != none { heading(level: calc.max(level, 1), title) }
  // The rest of the page, less what its footnotes need: a fraction of the
  // flow is measured after them, where a grid row claimed the whole page.
  block(height: 1fr, width: 100%, schreibstube-fit(body))
}

#let schreibstube-code(source, language) = block(
  width: 100%,
  fill: surface,
  inset: 10pt,
  radius: 4pt,
  {
    set text(font: mono, size: 0.8em)
    raw(source, block: true, lang: if language == "" { none } else { language })
  },
)

#let schreibstube-table(columns: 1, align: (left,), ..cells) = {
  set par(justify: false)
  set text(hyphenate: false, size: 0.85em)
  show table.cell.where(y: 0): set text(weight: 600)
  table(
    columns: columns,
    align: align,
    inset: (x: 8pt, y: 6pt),
    stroke: (x, y) => if y == 0 { (bottom: 1pt + ink) } else { (bottom: 0.5pt + hairline) },
    ..cells,
  )
}

#let schreibstube-callout(kind, title, body) = {
  let color = if kind == "warning" { rgb(178, 78, 22) } else if kind == "danger" {
    rgb(176, 44, 48)
  } else if kind == "tip" { rgb(30, 118, 70) } else { accent }
  block(width: 100%, inset: (left: 12pt, y: 4pt), stroke: (left: 3pt + color))[
    #text(weight: 600, fill: color, title)
    #v(0.1em)
    #body
  ]
}

#let slides(body, data) = {
  set document(title: data.title)
  // The paper is the dialog's format, and the margins the descriptor's, so
  // neither is set here.
  set page(footer: context {
    if not plain.get() {
      set text(size: 10pt, fill: faint)
      grid(
        columns: (1fr, auto),
        data.title,
        counter(page).display("1 / 1", both: true),
      )
    }
  })
  set text(font: sans, size: 20pt, fill: ink, lang: data.lang)
  set par(justify: false, leading: 0.6em, spacing: 0.9em)

  show heading: set text(fill: ink, weight: 700, tracking: -0.01em)
  show heading: set block(above: 0.8em, below: 0.5em)
  show heading.where(level: 1): set text(size: 30pt)
  show heading.where(level: 2): set text(size: 30pt)
  show heading.where(level: 3): set text(size: 22pt)
  show heading.where(level: 4): set text(size: 20pt)

  set list(marker: text(fill: accent)[•], indent: 0.2em, body-indent: 0.6em, spacing: 0.7em)
  set enum(indent: 0.2em, body-indent: 0.6em, spacing: 0.7em)
  show raw.where(block: false): it => box(
    fill: surface,
    inset: (x: 3pt),
    outset: (y: 3pt),
    radius: 2pt,
    text(font: mono, size: 0.9em, it),
  )
  show link: set text(fill: accent)
  show quote.where(block: true): it => block(
    inset: (left: 12pt),
    stroke: (left: 2pt + faint),
    text(fill: muted, style: "italic", it.body),
  )
  show footnote.entry: set text(size: 11pt, fill: muted)

  folien-data.update(data)
  body
}
