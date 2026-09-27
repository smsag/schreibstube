// A CV: a photo and the contact block at the top, then the note's own
// headings. Level three is a section, four a role, five the employer and the
// dates — which is the shape the Markdown already has, so nothing has to be
// restructured to print it.
//
// Measured against the same CV exported from iA Writer, and set to match it:
// every gap below is that export's baseline-to-baseline distance, converted
// through Fira's line box (ascender 0.935 em + descender 0.265 em = 1.2 em).

#let ink = rgb("#121212")
#let grey = rgb("#5b5b5b")

#let cv(body, data) = {
  set document(title: "Lebenslauf – " + data.name, author: data.name)
  // The margins are the descriptor's, so the dialog's presets can move them.
  set page(paper: "a4")

  // Gaps measured on the whole line box, descender to ascender, as a browser
  // measures them. On Typst's default (baseline to cap height) every gap is
  // smaller than it reads, and a heading runs into the line below it.
  set text(
    font: ("Fira Sans", "Liberation Sans"),
    size: 10.2pt,
    fill: ink,
    lang: "de",
    top-edge: "ascender",
    bottom-edge: "descender",
  )
  // Running text: lines 14.4 pt apart, paragraphs 19.2 pt.
  set par(leading: 2.16pt, spacing: 6.96pt, justify: false)

  // The condensed cuts hold a long German job title on one line. Typst files
  // "Fira Sans Condensed" under Fira Sans as a width, so they are asked for by
  // stretch; without them the normal width is the nearest.
  let condensed(size: 10pt, weight: 700, fill: ink, body) = text(
    font: "Fira Sans",
    stretch: 75%,
    weight: weight,
    size: size,
    fill: fill,
    body,
  )

  // A section, a role and its employer line are kept with what follows, so a
  // page never ends on a title whose bullets start the next one.

  show heading.where(level: 3): it => block(above: 13.77pt, below: 5.7pt, sticky: true)[
    #condensed(size: 14.9pt)[#it.body]
  ]
  show heading.where(level: 4): it => block(above: 5.7pt, below: 2.82pt, sticky: true)[
    #condensed(size: 12pt)[#it.body]
  ]
  show heading.where(level: 5): it => block(above: 0pt, below: 0.5pt, sticky: true)[
    #condensed(size: 10.7pt, weight: 600, fill: grey)[#it.body]
  ]

  // A skill's level, written in italics in the note, is a quiet aside on paper.
  show emph: it => text(fill: grey, style: "normal")[#it.body]

  // Lists are tighter than running text: lines 12.8 pt apart, items 13.6 pt.
  // 6 pt under an employer line, 7.7 pt before what follows the list.
  set list(
    indent: 7.2pt,
    body-indent: 8.4pt,
    spacing: 1.36pt,
    // The marker hangs from the top of the line box, so it is given the
    // ascender's height and the dot sits at its foot, 1.2 pt over the baseline.
    marker: box(
      width: 3.6pt,
      height: 0.935em,
      align(bottom, move(dy: -1.2pt, circle(radius: 1.8pt, fill: ink))),
    ),
  )
  show list: set par(leading: 0.56pt)
  show list: set block(above: 6.02pt, below: 7.68pt)

  // Photo and contact: the photo 77 pt square with rounded corners; beside
  // it the name, the address and the contact line, at iA Writer's distances
  // (baselines 18.4 pt and 15.3 pt apart), the name's top 6.9 pt below the
  // photo's.
  block(below: 12.1pt)[
    #grid(
      columns: if data.photo != "" { (77pt, 1fr) } else { (1fr,) },
      column-gutter: 12.9pt,
      ..(
        if data.photo != "" {
          (box(clip: true, radius: 8pt, image(data.photo, width: 77pt, height: 77pt, fit: "cover")),)
        } else { () }
      ),
      {
        set text(size: 10.7pt)
        v(if data.photo != "" { 6.9pt } else { 0pt })
        stack(
          condensed(size: 25.6pt)[#data.name],
          v(1.62pt),
          data.address,
          ..if data.contact != "" {
            (v(2.46pt), data.contact.split(" · ").join([#h(0.8em)·#h(0.8em)]))
          },
        )
      },
    )
  ]

  body
}
