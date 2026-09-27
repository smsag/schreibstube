// The page a note is printed on when nothing else is asked for: the Klartext
// theme on paper. A4, the note's own headings in Fira Sans, the text in
// JetBrains Mono, and the note's title and page number at the foot once there
// is more than one page.
//
// Nothing here needs a value from the note. `data.title` is the note's first
// heading, or its file name when it has none, and names the PDF; `data.lang`
// is the language the plugin speaks. `data.monospace` is "false" when the
// print settings, or the note's own `schreibstubePrint`, ask for the text in
// Fira Sans instead; headings, tables and labels are Fira Sans either way, and
// code stays monospaced.
//
// The theme's decisions, carried over: ragged right (a monospaced line set
// justified opens holes between its words), marks in a faint grey at the text
// edge, one hairline colour for every rule, and no filled box except the table
// header and inline code.

#let ink = rgb("#333333")
#let muted = rgb("#575757")
#let faint = rgb("#8f8f86")
#let hairline = rgb("#e8e8e6")
#let surface = rgb("#f2f2ee")
// The fallbacks are the faces Typst defaults to, which every device also has.
#let mono = ("JetBrains Mono", "DejaVu Sans Mono")
#let sans = ("Fira Sans", "Libertinus Serif")

// Code: no box. A hairline above and below, and a header naming the language
// with the theme's mark.
#let schreibstube-code(source, language) = block(
  breakable: true,
  width: 100%,
  above: 1.2em,
  below: 1.2em,
  inset: (y: 6pt),
  stroke: (top: 0.5pt + hairline, bottom: 0.5pt + hairline),
  {
    text(font: mono, style: "normal", size: 0.78em, fill: faint)[\</\> #language]
    v(2pt)
    set text(size: 0.92em)
    raw(source, block: true, lang: if language == "" { none } else { language })
  },
)

// Tables: the theme's grey header row in the heading face, a hairline grid,
// and a faint zebra. A cell is a column a few words wide, so it never
// hyphenates.
#let schreibstube-table(columns: 1, align: (left,), ..cells) = {
  set par(justify: false)
  set text(hyphenate: false, size: 0.92em)
  show table.cell.where(y: 0): set text(font: sans, weight: 600, size: 1.02em)
  table(
    columns: columns,
    align: align,
    inset: (x: 7pt, y: 5pt),
    stroke: 0.5pt + hairline,
    fill: (x, y) => if y == 0 { surface } else if calc.even(y) { luma(250) } else { none },
    ..cells,
  )
}

// Callouts: a bar in the kind's colour and a small capital label, as the
// theme draws them. No box around the body.
#let schreibstube-callout(kind, title, body) = {
  let color = if kind == "warning" { rgb(178, 78, 22) } else if kind == "danger" {
    rgb(176, 44, 48)
  } else if kind == "tip" { rgb(30, 118, 70) } else { rgb(41, 98, 168) }
  block(
    breakable: true,
    width: 100%,
    inset: (left: 10pt, y: 3pt),
    stroke: (left: 0.75pt + color),
  )[
    #text(font: sans, weight: 600, size: 0.78em, fill: color, tracking: 0.04em, upper(title))
    #v(0.1em)
    #body
  ]
}

// A task's box, in the marks' grey. It stands where a bullet would.
#let schreibstube-task(done) = box(
  width: 0.7em,
  height: 0.7em,
  baseline: 0.05em,
  stroke: 0.6pt + faint,
  radius: 1pt,
  inset: 0.14em,
  if done { box(width: 100%, height: 100%, fill: muted, radius: 0.5pt) },
)

// The note's properties, when a print asks for them: keys in the marks' grey,
// a hairline under the list.
#let schreibstube-properties(rows) = block(
  width: 100%,
  below: 1.4em,
  inset: (bottom: 0.6em),
  stroke: (bottom: 0.5pt + hairline),
  {
    set text(size: 0.9em)
    grid(
      columns: (auto, 1fr),
      column-gutter: 1.2em,
      row-gutter: 0.55em,
      ..rows.map(row => (text(fill: faint, row.at(0)), row.at(1))).flatten(),
    )
  },
)

#let standard(body, data) = {
  let monospaced = lower(data.monospace) not in ("false", "no", "off")

  set document(title: data.title)
  // The margins are the descriptor's, not set here, so the print dialog's
  // "Klein" and "Breit" can replace them; a layout that sets its own keeps it.
  set page(
    paper: "a4",
    footer: context {
      let total = counter(page).final().first()
      if total > 1 {
        set text(font: mono, size: 7.5pt, fill: faint)
        grid(
          columns: (1fr, auto),
          data.title,
          counter(page).display("1 / 1", both: true),
        )
      }
    },
  )
  set text(
    font: if monospaced { mono } else { sans },
    size: if monospaced { 9pt } else { 10pt },
    fill: ink,
    lang: data.lang,
  )
  set par(justify: false, leading: if monospaced { 0.78em } else { 0.7em }, spacing: 1.25em)

  // Headings in Fira Sans, tight, the smallest level greyed as on screen.
  show heading: set text(font: sans, fill: ink, tracking: -0.02em)
  show heading: set block(above: 1.7em, below: 0.75em)
  show heading.where(level: 1): set text(size: 22pt, weight: 700, tracking: -0.03em)
  show heading.where(level: 2): set text(size: 14pt, weight: 600)
  show heading.where(level: 3): set text(size: 12pt, weight: 600)
  show heading.where(level: 4): set text(size: 11pt, weight: 600)
  show heading.where(level: 5): set text(size: 10pt, weight: 600)
  show heading.where(level: 6): set text(size: 9.5pt, weight: 600, fill: muted)

  // Marks: a dash for a bullet at every level, a bare number for a step, both
  // faint.
  set list(marker: text(fill: faint)[–], indent: 0pt, body-indent: 1.2em, spacing: 0.9em)
  set enum(numbering: n => text(fill: faint)[#n], indent: 0pt, body-indent: 1.2em, spacing: 0.9em)

  // Quotes: a thin bar, and the text muted and italic. Code inside a quote
  // stays upright.
  show quote.where(block: true): it => block(
    inset: (left: 10pt, y: 2pt),
    stroke: (left: 0.75pt + faint),
    {
      set text(style: "italic", fill: muted)
      it.body
    },
  )

  // Links keep the text's colour and carry a dotted rule, as the theme draws
  // a link that leaves the vault; legible on a printer with no colour.
  show link: it => underline(
    stroke: (paint: ink, thickness: 0.5pt, dash: "dotted"),
    offset: 2.5pt,
    it,
  )
  show raw: set text(font: mono, style: "normal")
  show raw.where(block: false): it => box(
    fill: surface,
    inset: (x: 2pt),
    outset: (y: 2pt),
    radius: 1.5pt,
    text(size: 0.92em, it),
  )
  show highlight: set highlight(fill: rgb(255, 200, 40, 77))
  show line: set line(stroke: 0.5pt + hairline)

  // Footnotes small and muted, the number apart from the text it numbers.
  show footnote.entry: it => {
    let number = numbering(it.note.numbering, ..counter(footnote).at(it.note.location()))
    text(size: 7.5pt, fill: muted)[#super(number)#h(0.35em)#it.note.body]
  }

  // A note without a first heading still gets a title: its file name, set
  // the way a heading would be, so the page does not begin mid-thought.
  context if query(heading.where(level: 1)).len() == 0 {
    block(below: 1em, text(font: sans, size: 22pt, weight: 700, tracking: -0.03em, data.title))
  }

  body
}
