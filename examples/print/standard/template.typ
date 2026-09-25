// The page a note is printed on when nothing else is asked for: A4, the
// standard fonts, the note's own headings, and the page number at the foot
// once there is more than one page.
//
// Nothing here needs a value from the note. `data.title` is the note's first
// heading, or its file name when it has none, and names the PDF; `data.lang`
// is the language the plugin speaks, so words break the way that language
// breaks them.

#let standard(body, data) = {
  set document(title: data.title)
  set page(
    paper: "a4",
    margin: (x: 25mm, top: 25mm, bottom: 30mm),
    footer: context {
      let total = counter(page).final().first()
      if total > 1 {
        align(center, text(size: 9pt, fill: luma(110), counter(page).display("1 / 1", both: true)))
      }
    },
  )
  set text(font: "Libertinus Serif", size: 11pt, lang: data.lang, hyphenate: true)
  set par(justify: true, leading: 0.65em, spacing: 1.2em)

  show heading: set block(above: 1.6em, below: 0.8em)
  show heading.where(level: 1): set text(size: 20pt, weight: "semibold")
  show heading.where(level: 2): set text(size: 15pt, weight: "semibold")
  show heading.where(level: 3): set text(size: 12.5pt, weight: "semibold")
  show heading: it => {
    set par(justify: false)
    it
  }

  show raw: set text(font: "DejaVu Sans Mono", size: 0.85em)
  show link: it => text(fill: rgb("#2f5d8a"), it)
  show footnote.entry: set text(size: 9pt)

  // A note without a first heading still gets a title: its file name, set
  // the way a heading would be, so the page does not begin mid-thought.
  context if query(heading.where(level: 1)).len() == 0 {
    block(below: 1em, text(size: 20pt, weight: "semibold", data.title))
  }

  body
}
