// A German business letter, roughly DIN 5008: the sender above the address
// field, the recipient where a window envelope shows it, the date on the right,
// the subject in bold, then the body.
//
// Every value comes from `data`, which is the note's frontmatter over this
// template's defaults. A key the note never sets is an empty string, so each
// block asks before it draws.

#let letter(body, data) = {
  set page(paper: "a4", margin: (top: 25mm, bottom: 25mm, left: 25mm, right: 20mm))
  set text(font: ("Fira Sans", "Liberation Sans"), size: 11pt, lang: "de")
  set par(justify: true, leading: 0.62em, spacing: 1.1em)

  // The sender, small and right, above the address field.
  align(right)[
    #set par(justify: false, leading: 0.5em)
    #text(size: 9.5pt)[
      #strong(data.senderName) \
      #data.senderAddress
      #if data.senderPhone != "" [\ #data.senderPhone]
      #if data.senderEmail != "" [\ #data.senderEmail]
    ]
  ]

  v(12mm)

  // The address field. The return line above it is what a window envelope
  // shows next to the recipient, and it is set in the smallest type on the page.
  block(height: 40mm, width: 85mm)[
    #set par(justify: false, leading: 0.5em)
    #text(size: 7.5pt)[
      #data.senderName · #data.senderAddress.split("\n").join(" · ")
    ]
    #v(2mm)
    #text(size: 11pt)[#data.recipient]
  ]

  align(right)[#data.date]
  v(6mm)

  if data.subject != "" {
    text(weight: 700, size: 11pt)[#data.subject]
    v(4mm)
  }

  body

  if data.signature != "" {
    v(16mm)
    data.signature
  }
}
