/**
 * The templates the plugin can lay down in a vault.
 *
 * Generated from `examples/print/` by `scripts/build-print-examples.mjs`; edit the
 * folders there, not this file. A template is three or four small text files,
 * so carrying them costs a few kilobytes and saves a person leaving the app to
 * find a folder on a web page — which on a phone is not really possible at all.
 *
 * Fonts are not carried. A typeface is licensed, a repository is no place to
 * redistribute one, and a template with no font still prints: it is set in the
 * standard fonts the plugin fetches with the typesetter. The descriptor says so
 * in the prose a person reads after adding it.
 */

export interface ExampleFile {
  name: string;
  text: string;
}

export interface ExampleTemplate {
  /** The folder name it is written as, and the name a note asks for. */
  name: string;
  /** Where it came from, for the documentation to agree with the code. */
  source: string;
  /** The descriptor's frontmatter, parsed at build time as Obsidian would. */
  frontmatter: Record<string, unknown>;
  files: ExampleFile[];
}

export const EXAMPLE_TEMPLATES: readonly ExampleTemplate[] = [
  {
    name: "Brief",
    source: "examples/print/brief",
    frontmatter: {
      schreibstubePrintTemplate: true,
      schreibstubeEntry: "letter",
      schreibstubePage: { size: "a4" },
      schreibstubeData: {
        senderName: "Vorname Nachname",
        senderAddress: "Musterstraße 1\n12345 Musterstadt",
        senderPhone: "",
        senderEmail: "",
        recipient: "",
        subject: "",
        signature: "Mit freundlichen Grüßen"
      }
    },
    files: [
      {
        name: "template.md",
        text: '---\nschreibstubePrintTemplate: true\nschreibstubeEntry: letter\nschreibstubePage: { size: a4 }\nschreibstubeData:\n  senderName: Vorname Nachname\n  senderAddress: "Musterstraße 1\\n12345 Musterstadt"\n  senderPhone: ""\n  senderEmail: ""\n  recipient: ""\n  subject: ""\n  signature: Mit freundlichen Grüßen\n---\n\n# Brief\n\nEin deutscher Geschäftsbrief nach DIN 5008: Absender klein über dem Anschriftenfeld, Empfänger dort, wo ein Fensterumschlag ihn zeigt, Datum rechts, Betreff fett, dann der Text.\n\n## Einrichten\n\nTrage deinen Absender einmal hier oben in `schreibstubeData` ein. Er gilt dann für jeden Brief, der diese Vorlage benutzt.\n\nLege deine Schriftdateien in `fonts/` ab — `.ttf` oder `.otf`. Ohne eigene Schrift wird der Brief in der Standardschrift gesetzt, die das Plugin mit dem Satzteil lädt — Libertinus Serif. Das funktioniert, sieht aber nicht nach dir aus.\n\n## Benutzen\n\nEine Notiz, die als Brief gedruckt wird, sagt im Frontmatter, an wen sie geht:\n\n```yaml\n---\nschreibstubePrintTemplate: Brief\nschreibstubePrint:\n  recipient: "Frau Handan Ekinci\\nHintere Marktstraße 83\\n90441 Nürnberg"\n  subject: Kündigung Tanzkurs\n---\n```\n\nDer Text der Notiz ist der Text des Briefes — Anrede, Inhalt, Dank. Gruß und Unterschrift kommen aus der Vorlage.\n\n## Werte, die die Vorlage liest\n\n| Schlüssel       | Woher                     | Wofür                               |\n| --------------- | ------------------------- | ----------------------------------- |\n| `senderName`    | Vorlage                   | Absenderzeile und Rücksendeangabe   |\n| `senderAddress` | Vorlage                   | ebenso; Zeilenumbrüche sind erlaubt |\n| `senderPhone`   | Vorlage                   | optional, unter der Adresse         |\n| `senderEmail`   | Vorlage                   | optional, darunter                  |\n| `recipient`     | Notiz                     | das Anschriftenfeld                 |\n| `subject`       | Notiz                     | die Betreffzeile                    |\n| `date`          | automatisch, Notiz sticht | rechts über dem Betreff             |\n| `signature`     | Vorlage                   | die Grußformel am Ende              |\n'
      },
      {
        name: "template.typ",
        text: '// A German business letter, roughly DIN 5008: the sender above the address\n// field, the recipient where a window envelope shows it, the date on the right,\n// the subject in bold, then the body.\n//\n// Every value comes from `data`, which is the note\'s frontmatter over this\n// template\'s defaults. A key the note never sets is an empty string, so each\n// block asks before it draws.\n\n#let letter(body, data) = {\n  set page(paper: "a4", margin: (top: 25mm, bottom: 25mm, left: 25mm, right: 20mm))\n  set text(font: ("Fira Sans", "Liberation Sans"), size: 11pt, lang: "de")\n  set par(justify: true, leading: 0.62em, spacing: 1.1em)\n\n  // The sender, small and right, above the address field.\n  align(right)[\n    #set par(justify: false, leading: 0.5em)\n    #text(size: 9.5pt)[\n      #strong(data.senderName) \\\n      #data.senderAddress\n      #if data.senderPhone != "" [\\ #data.senderPhone]\n      #if data.senderEmail != "" [\\ #data.senderEmail]\n    ]\n  ]\n\n  v(12mm)\n\n  // The address field. The return line above it is what a window envelope\n  // shows next to the recipient, and it is set in the smallest type on the page.\n  block(height: 40mm, width: 85mm)[\n    #set par(justify: false, leading: 0.5em)\n    #text(size: 7.5pt)[\n      #data.senderName · #data.senderAddress.split("\\n").join(" · ")\n    ]\n    #v(2mm)\n    #text(size: 11pt)[#data.recipient]\n  ]\n\n  align(right)[#data.date]\n  v(6mm)\n\n  if data.subject != "" {\n    text(weight: 700, size: 11pt)[#data.subject]\n    v(4mm)\n  }\n\n  body\n\n  if data.signature != "" {\n    v(16mm)\n    data.signature\n  }\n}\n'
      }
    ]
  },
  {
    name: "Lebenslauf",
    source: "examples/print/lebenslauf",
    frontmatter: {
      schreibstubePrintTemplate: true,
      schreibstubeEntry: "cv",
      schreibstubePage: { size: "a4" },
      schreibstubeHrIsPageBreak: true,
      schreibstubeData: {
        name: "Vorname Nachname",
        address: "Musterstraße 1, 12345 Musterstadt, DE",
        contact: "+49 000 0000000 · du@example.de",
        photo: ""
      }
    },
    files: [
      {
        name: "template.md",
        text: '---\nschreibstubePrintTemplate: true\nschreibstubeEntry: cv\nschreibstubePage: { size: a4 }\nschreibstubeHrIsPageBreak: true\nschreibstubeData:\n  name: Vorname Nachname\n  address: "Musterstraße 1, 12345 Musterstadt, DE"\n  contact: "+49 000 0000000 · du@example.de"\n  photo: ""\n---\n\n# Lebenslauf\n\nFoto und Kontakt oben, darunter die Überschriften der Notiz selbst. Die Gliederung, die ein Lebenslauf ohnehin hat, wird gesetzt statt umgebaut.\n\n## Die Gliederung\n\n| Ebene | Im Markdown | Auf dem Papier                         |\n| ----- | ----------- | -------------------------------------- |\n| 3     | `###`       | Abschnitt: Berufserfahrung, Ausbildung |\n| 4     | `####`      | Position                               |\n| 5     | `#####`     | Arbeitgeber und Zeitraum, grau         |\n\nKursives wird grau und aufrecht gesetzt — gedacht für die Stufe hinter einem Werkzeug (`Linear — *Experte*`).\n\n## Einrichten\n\nTrage Name, Adresse und Kontakt hier oben in `schreibstubeData` ein. Für ein Foto legst du die Bilddatei in diesen Ordner und setzt `photo` auf ihren Dateinamen; ohne Foto rückt der Kopf nach links und nichts bleibt leer stehen.\n\nLege deine Schriftdateien in `fonts/` ab. Diese Vorlage fragt nach Fira Sans und Fira Sans Condensed; ohne sie wird der Lebenslauf in der Standardschrift gesetzt, die das Plugin mit dem Satzteil lädt — Libertinus Serif.\n\n## Benutzen\n\n```yaml\n---\nschreibstubePrintTemplate: Lebenslauf\n---\n```\n\nMehr braucht die Notiz nicht, wenn alles Persönliche in der Vorlage steht. Ein einzelner Wert lässt sich für eine Bewerbung überschreiben:\n\n```yaml\nschreibstubePrint:\n  contact: "+49 000 0000000 · bewerbung@example.de"\n```\n'
      },
      {
        name: "template.typ",
        text: '// A CV: a photo and the contact block at the top, then the note\'s own\n// headings. Level three is a section, four a role, five the employer and the\n// dates — which is the shape the Markdown already has, so nothing has to be\n// restructured to print it.\n\n#let cv(body, data) = {\n  set page(paper: "a4", margin: (top: 18mm, bottom: 20mm, x: 20mm))\n  set text(font: ("Fira Sans", "Liberation Sans"), size: 10.2pt, lang: "de")\n  set par(leading: 0.58em, spacing: 0.72em, justify: false)\n\n  // The condensed cuts hold a long German job title on one line, which is the\n  // whole reason a CV uses them. Fira registers them as a width on the same\n  // family rather than as a family of their own, so they are asked for by\n  // stretch; a font that names its condensed cut separately is asked for by\n  // name instead.\n  let condensed(size: 10pt, weight: 700, fill: black, body) = text(\n    font: "Fira Sans",\n    stretch: 75%,\n    weight: weight,\n    size: size,\n    fill: fill,\n    body,\n  )\n\n  show heading.where(level: 3): it => block(above: 1.35em, below: 0.55em)[\n    #condensed(size: 14.9pt)[#it.body]\n  ]\n  show heading.where(level: 4): it => block(above: 1.05em, below: 0.1em)[\n    #condensed(size: 12pt)[#it.body]\n  ]\n  show heading.where(level: 5): it => block(above: 0em, below: 0.45em)[\n    #condensed(size: 10.7pt, weight: 600, fill: luma(107))[#it.body]\n  ]\n  // A skill\'s level, written in italics in the note, is a quiet aside on paper.\n  show emph: it => text(fill: luma(107), style: "normal")[#it.body]\n\n  set list(indent: 6pt, spacing: 0.4em, marker: [•])\n\n  block[\n    #grid(\n      columns: if data.photo != "" { (84pt, 1fr) } else { (1fr,) },\n      gutter: 12pt,\n      align: bottom,\n      ..(\n        if data.photo != "" {\n          (image(data.photo, width: 84pt, height: 84pt, fit: "cover"),)\n        } else { () }\n      ),\n      [\n        #set par(leading: 0.5em, spacing: 0.35em)\n        #condensed(size: 25.6pt)[#data.name]\n        #v(2pt)\n        #data.address\n        #if data.contact != "" [\\ #data.contact]\n      ],\n    )\n  ]\n\n  v(9pt)\n  body\n}\n'
      }
    ]
  },
  {
    name: "Standard",
    source: "examples/print/standard",
    frontmatter: {
      schreibstubePrintTemplate: true,
      schreibstubeEntry: "standard",
      schreibstubePage: { size: "a4" }
    },
    files: [
      {
        name: "template.md",
        text: "---\nschreibstubePrintTemplate: true\nschreibstubeEntry: standard\nschreibstubePage: { size: a4 }\n---\n\n# Standard\n\nDie Vorlage, mit der gedruckt wird, wenn nichts anderes verlangt ist: A4, die Überschriften der Notiz, die Seitenzahl unten, sobald es mehr als eine Seite ist. Sie ist in Schreibstube eingebaut und muss nicht im Vault liegen.\n\n## Anpassen\n\nDiese Kopie im Vault ersetzt die eingebaute, solange sie `Standard` heißt: Ändere hier die `template.typ`, und jede Notiz ohne eigene Vorlage wird so gedruckt. Soll wieder die eingebaute gelten, benenne diesen Ordner um oder lösche ihn.\n\nLege eine Schrift in `fonts/` und nenne sie in der `template.typ` bei `set text(font: …)`. Ohne eigene Schrift wird in der Standardschrift gesetzt, die das Plugin mit dem Satzteil lädt — Libertinus Serif, und DejaVu Sans Mono für Code.\n\n## Benutzen\n\nNichts. Eine Notiz ohne `schreibstubePrintTemplate` wird mit der Standardvorlage gedruckt, solange in den Druck-Einstellungen keine andere als Standard gewählt ist. Ausdrücklich verlangen lässt sie sich auch:\n\n```yaml\n---\nschreibstubePrintTemplate: Standard\n---\n```\n\n## Werte, die die Vorlage liest\n\n| Schlüssel | Woher                                   | Wofür                                         |\n| --------- | --------------------------------------- | --------------------------------------------- |\n| `title`   | erste Überschrift der Notiz, sonst Name | Titel des PDFs; Titelzeile, wenn keine da ist |\n| `lang`    | Sprache des Plugins                     | Silbentrennung                                |\n"
      },
      {
        name: "template.typ",
        text: '// The page a note is printed on when nothing else is asked for: A4, the\n// standard fonts, the note\'s own headings, and the page number at the foot\n// once there is more than one page.\n//\n// Nothing here needs a value from the note. `data.title` is the note\'s first\n// heading, or its file name when it has none, and names the PDF; `data.lang`\n// is the language the plugin speaks, so words break the way that language\n// breaks them.\n\n#let standard(body, data) = {\n  set document(title: data.title)\n  set page(\n    paper: "a4",\n    margin: (x: 25mm, top: 25mm, bottom: 30mm),\n    footer: context {\n      let total = counter(page).final().first()\n      if total > 1 {\n        align(center, text(size: 9pt, fill: luma(110), counter(page).display("1 / 1", both: true)))\n      }\n    },\n  )\n  set text(font: "Libertinus Serif", size: 11pt, lang: data.lang, hyphenate: true)\n  set par(justify: true, leading: 0.65em, spacing: 1.2em)\n\n  show heading: set block(above: 1.6em, below: 0.8em)\n  show heading.where(level: 1): set text(size: 20pt, weight: "semibold")\n  show heading.where(level: 2): set text(size: 15pt, weight: "semibold")\n  show heading.where(level: 3): set text(size: 12.5pt, weight: "semibold")\n  show heading: it => {\n    set par(justify: false)\n    it\n  }\n\n  show raw: set text(font: "DejaVu Sans Mono", size: 0.85em)\n  show link: it => text(fill: rgb("#2f5d8a"), it)\n  show footnote.entry: set text(size: 9pt)\n\n  // A note without a first heading still gets a title: its file name, set\n  // the way a heading would be, so the page does not begin mid-thought.\n  context if query(heading.where(level: 1)).len() == 0 {\n    block(below: 1em, text(size: 20pt, weight: "semibold", data.title))\n  }\n\n  body\n}\n'
      }
    ]
  }
];
