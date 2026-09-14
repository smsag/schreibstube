// A CV: a photo and the contact block at the top, then the note's own
// headings. Level three is a section, four a role, five the employer and the
// dates — which is the shape the Markdown already has, so nothing has to be
// restructured to print it.

#let cv(body, data) = {
  set page(paper: "a4", margin: (top: 18mm, bottom: 20mm, x: 20mm))
  set text(font: ("Fira Sans", "Liberation Sans"), size: 10.2pt, lang: "de")
  set par(leading: 0.58em, spacing: 0.72em, justify: false)

  // The condensed cuts hold a long German job title on one line, which is the
  // whole reason a CV uses them. Fira registers them as a width on the same
  // family rather than as a family of their own, so they are asked for by
  // stretch; a font that names its condensed cut separately is asked for by
  // name instead.
  let condensed(size: 10pt, weight: 700, fill: black, body) = text(
    font: "Fira Sans",
    stretch: 75%,
    weight: weight,
    size: size,
    fill: fill,
    body,
  )

  show heading.where(level: 3): it => block(above: 1.35em, below: 0.55em)[
    #condensed(size: 14.9pt)[#it.body]
  ]
  show heading.where(level: 4): it => block(above: 1.05em, below: 0.1em)[
    #condensed(size: 12pt)[#it.body]
  ]
  show heading.where(level: 5): it => block(above: 0em, below: 0.45em)[
    #condensed(size: 10.7pt, weight: 600, fill: luma(107))[#it.body]
  ]
  // A skill's level, written in italics in the note, is a quiet aside on paper.
  show emph: it => text(fill: luma(107), style: "normal")[#it.body]

  set list(indent: 6pt, spacing: 0.4em, marker: [•])

  block[
    #grid(
      columns: if data.photo != "" { (84pt, 1fr) } else { (1fr,) },
      gutter: 12pt,
      align: bottom,
      ..(
        if data.photo != "" {
          (image(data.photo, width: 84pt, height: 84pt, fit: "cover"),)
        } else { () }
      ),
      [
        #set par(leading: 0.5em, spacing: 0.35em)
        #condensed(size: 25.6pt)[#data.name]
        #v(2pt)
        #data.address
        #if data.contact != "" [\ #data.contact]
      ],
    )
  ]

  v(9pt)
  body
}
