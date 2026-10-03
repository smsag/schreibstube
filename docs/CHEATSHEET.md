# Schreibstube cheatsheet for language models

Checked against Schreibstube 1.75.0

**For the person:** paste this whole file into a conversation with a language
model, then ask for what you need — a presentation, a letter, a mail, a cost
table. The model answers with a note you paste into Obsidian.

**For the model:** Schreibstube is an Obsidian plugin. Everything it reads is
plain Obsidian Markdown plus what this file lists. Write only what is here.

## 1. Rules

- Answer with one complete note in a single ` ```markdown ` fence: the
  frontmatter first, between `---` lines, then the body. After the fence, one
  short list may name the placeholders the person has to replace.
- Every key Schreibstube reads starts with `schreibstube`. Use only the keys
  in this file; never invent one. Keys the plugin writes itself are marked
  "written by the plugin" — leave them out.
- Pictures are files in the vault: `![Alt text](file.jpg)` or `![[file.jpg]]`.
  A web address does not print. When you do not know a file name, write a
  placeholder such as `objekt-aussen.jpg` and tell the person to replace it.
- A picture prints at the full text width. To make it smaller, end the alt
  text with a width in pixels, `![Grundriss | 300](grundriss.png)`; to place
  it, put `left`, `center` or `right` before the width or alone:
  `![Grundriss | center | 300](grundriss.png)`. Never the word after the width.
- Ask for facts you do not have — a recipient's address, a date, figures —
  or mark them clearly as `[TODO: …]` in the body. Never invent them.
- In the frontmatter, leave an unknown value out instead: a `[TODO: …]`
  there prints as written, on a title slide or in a letterhead.
- Comments `<!-- … -->` and Obsidian's `%% … %%` are hidden in every view and
  never printed, mailed or published. Schreibstube reads only the settings
  this file names from them.
- These do not reach a PDF: raw HTML (tags are dropped, words stay),
  embedded notes (`![[Another note]]`), and LaTeX math, which prints as its
  source in a code block.
- Write the language the person writes. German UI names are given in
  parentheses where the plugin shows them in German.

## 2. Frontmatter keys

| Key                           | Where          | Value                                                          |
| ----------------------------- | -------------- | -------------------------------------------------------------- |
| `schreibstubePrintTemplate`   | any note       | template name: `Standard`, `Brief`, `Lebenslauf`, `Folien`     |
| `schreibstubePrint`           | any note       | map of values the template reads (see 3–5)                     |
| `schreibstubeTo`              | mail note      | address or list of addresses                                   |
| `schreibstubeCc`              | mail note      | list of addresses                                              |
| `schreibstubeFrom`            | mail note      | optional sender, `Name <address>`                              |
| `schreibstubeSubject`         | mail note      | subject line                                                   |
| `schreibstubeSyncedFrom`      | synced note    | HTTPS address of a Markdown file                               |
| `schreibstubeSyncEvery`       | synced note    | `Alle 2 Tage`, `weekly`, `every 6 hours` or a cron line        |
| `schreibstubeGlossary`        | glossary note  | `true`                                                         |
| `schreibstubeLanguage`        | glossary note  | `de`, `en`, …                                                  |
| `schreibstubeDefaultSeverity` | glossary note  | `error`, `warning` or `suggestion`                             |
| `schreibstubeGlossaries`      | any note       | list of glossary notes that apply to it                        |
| `schreibstubeAvoid`           | term note      | list of words to flag, the note's term offered instead         |
| `schreibstubeIndex`           | any note       | `false` keeps it out of search by meaning                      |
| `schreibstubeTaskCount`       | any note       | `false` hides its task count in the Explorer                   |
| `schreibstubeReadingView`     | `.base` file   | `true` at the top: its notes open in Reading view              |
| `type: schreibstube-passages` | `.base` view   | callouts and highlights; `calloutTypes`, `show`, `readingView` |
| `published`                   | published note | `true` puts it on the website (see 9)                          |

Written by the plugin, never by you: `schreibstubeMessageId`, `schreibstubeSentAt`,
`schreibstubeSendUnconfirmed`, `schreibstubeMergedIds` (mail); `schreibstubeImage`,
`schreibstubeImageHash`, `schreibstubeImageSize`, `schreibstubeSummary`, `schreibstubeDescription`, `schreibstubeDescribedAt`,
`schreibstubeKeywords`, `schreibstubeSource`, `schreibstubeAuthor`, `schreibstubeFavorite`,
`schreibstubeArticles` (picture description notes); `publishedAt`, `publishedUrl` (publishing).

## 3. Presentations (template `Folien`)

Printed with **Print note** (`Notiz drucken`); one slide per page, 16:9 or 4:3.

### Skeleton

```markdown
---
schreibstubePrintTemplate: Folien
schreibstubePrint:
  subtitle: Quartalsbericht Vertrieb
  author: Vorname Nachname
  format: "16:9"
  align: center
---

# Titel des Vortrags
```

- `format`: `"16:9"` (default) or `"4:3"`. `align`: `center` (default) or
  `left`. Both only set where the print dialog starts.
- The date on the title slide is today's unless `date:` is given. Leave out
  `author:` or `subtitle:` when unknown; the title slide shows what is there.
- The title slide, every section divider and an agenda are slides too: count
  them when asked for a number of slides.

### How the outline becomes slides

| In the note                | On the slides                                                 |
| -------------------------- | ------------------------------------------------------------- |
| `#` or `##`                | a new slide, titled by the heading                            |
| `#` with nothing under it  | a section divider; as the very first heading, the title slide |
| `###`                      | one column, titled by the heading; 2 of them make 2 columns   |
| `####`, `#####`            | a sub-heading inside its column or slide                      |
| `---`                      | a new slide without a title, to continue a full one           |
| `> [!notes]` callout       | speaker notes, never shown on the slide                       |
| a heading inside a callout | belongs to the callout, starts nothing                        |

- Columns: as many as there are `###` under the slide heading, three side by
  side at most; a fourth `###` starts a second row. What stands before the
  first `###` spans the full width. Columns are equal unless a `columns:`
  comment (below) says otherwise.
- Centred slides move blocks, not lines: a paragraph or list stands in the
  middle as a whole, its lines left-aligned.

### Settings written as comments on the slide

Put them on the heading line, on a line of their own in the slide, or just
above the slide's heading. `%% … %%` works the same as `<!-- … -->`.

| Comment                        | Effect                                                      |
| ------------------------------ | ----------------------------------------------------------- |
| `<!-- columns: 1 2 -->`        | column widths as shares: a third and two thirds             |
| `<!-- columns: 2 1 1 -->`      | three columns: half, quarter, quarter                       |
| `<!-- layout: image-left -->`  | the slide's first picture on the left half, the rest right  |
| `<!-- layout: image-right -->` | the same, picture on the right                              |
| `<!-- agenda -->`              | lists the section dividers (or all other slide titles) here |

- `columns:` needs exactly as many numbers (2 or 3, each up to 12) as the
  slide has `###` columns; otherwise the columns stay equal and the print
  warns.
- For `image-left` / `image-right` the picture must stand on a line of its own.

### Pictures and diagrams

- A slide holding one picture and nothing else shows it as large as fits.
- The alt text is the caption: beside the picture on a full-width slide,
  beneath it in a column. `![](x.jpg)` has no caption.
  `![[x.jpg|300]]` is a width, not a caption.
- A ` ```mermaid ` or ` ```vizardry ` fence is drawn and placed as a picture.

### Writing good slides

- One idea per slide; at most about six bullets of a few words each.
- A slide that holds too much is shrunk until it fits, and a slide below 60 %
  of its size is named in a warning. Split it with `---` instead.
- Say it in `> [!notes]`, show it on the slide.

### Example deck

```markdown
---
schreibstubePrintTemplate: Folien
schreibstubePrint:
  subtitle: Vermarktung Q3
  author: Team Vertrieb
---

# Objektvermarktung

## Agenda <!-- agenda -->

# Ausgangslage

## Wo wir stehen

- 42 aktive Objekte
- Vermarktungsdauer: **74 Tage**

> [!notes]
> Median, nicht Durchschnitt.

## Zwei Wege <!-- columns: 1 2 -->

### Portale

- schnell verfügbar

### Eigene Plattform

- volle Kontrolle über Daten
- höhere Anfangskosten

# Das Objekt

## Lage <!-- layout: image-left -->

![Blick auf die Straße](lage.jpg)

- 5 Minuten zur U-Bahn
- ruhige Seitenstraße

## Wohnzimmer

![Wohnzimmer nach der Renovierung](wohnzimmer.jpg)
```

Brand, set once in the template's own `template.md` under `schreibstubeData`
or per note under `schreibstubePrint`: `accent: "#8c1a33"` (colour of rules,
column heads, bullets), `font:` (a font in the template's `fonts/` folder),
`logo: logo.png` (a picture in the template's folder).

## 4. Printed documents

**Print note** (`Notiz drucken`) makes a PDF beside the note. The print dialog
chooses template, margins, whether properties print, and, for decks, format,
alignment and speaker notes.

- **Standard** — used when a note names no template. Headings, lists,
  tables, code, callouts, footnotes, pictures. `schreibstubePrint:
monospace: false` sets the text in Fira Sans instead of JetBrains Mono.
- A horizontal rule `---` is a page break in `Lebenslauf` and a new slide in
  `Folien`; elsewhere the print dialog decides, a line unless switched on.

### Letter (template `Brief`, DIN 5008)

The sender stands in the template; the note gives recipient and subject.

```markdown
---
schreibstubePrintTemplate: Brief
schreibstubePrint:
  recipient: "Frau Handan Ekinci\nHintere Marktstraße 83\n90441 Nürnberg"
  subject: Ihre Anfrage zum Objekt 4711
---

Sehr geehrte Frau Ekinci,

vielen Dank für Ihre Anfrage …
```

- Write the body only: salutation, text, thanks. Closing and signature come
  from the template (`signature`). `date` is today unless given.
- Lines in `recipient` are separated by `\n` inside double quotes.

### CV (template `Lebenslauf`)

Name, address, contact and photo stand in the template. The note:

```markdown
---
schreibstubePrintTemplate: Lebenslauf
---

### Berufserfahrung

#### Senior Product Manager

##### Beispiel GmbH · 2021–heute

- Verantwortung für …

### Ausbildung
```

- `###` section, `####` position, `#####` employer and period (grey).
- Italic is set grey and upright: `Linear — *Experte*`.
- Override one value per application: `schreibstubePrint: contact: …`.

## 5. Tables and totals

A formula alone in a cell works on the cells above it; the note keeps it.

```markdown
| Posten            |    Betrag |
| ----------------- | --------: |
| Kaufpreis         | 420.000 € |
| Grunderwerbsteuer |  25.200 € |
| Notar             |   6.300 € |
| **Summe**         |  **=sum** |
```

- `=sum`, `=avg`, `=median`, `=count`, `=min`, `=max`.
- `=sum(fixed)` is written down as `=sum(fixed: 451.500 €)` the first time the
  note is mailed, printed or published, and then stays.
- Amounts: `300 €`, `€ 20`, `1.234,50 €`, `20,-`, `-20 €`. An amount in
  quotes, `"300 €"`, is left out on purpose. Another formula above is not
  counted twice.
- Alignment comes from the delimiter row: `:--`, `:-:`, `--:`.
- A line ending in `=` shows its result: `Miete 1.240 € - 15% =`; Tab adds it.

## 6. Picture slideshows in a note

Not a presentation: two or more pictures in one block, shown in the note, in
the PDF and on the website. **Insert: slideshow** (`Einfügen: Diaschau`).

````markdown
```schreibstube-slideshow
layout: compare
![Vorher](kueche-vorher.jpg)
![Nachher](kueche-nachher.jpg)
```
````

| `layout:`   | Use it for                                                         |
| ----------- | ------------------------------------------------------------------ |
| `slideshow` | one picture at a time, the reader steps through (default)          |
| `filmstrip` | the same with thumbnails, for a longer series                      |
| `feature`   | one large picture beside two details (first three pictures)        |
| `strip`     | all pictures in a row of equal tiles, a series that says one thing |
| `masonry`   | all pictures at their own proportions, like a mood board           |
| `compare`   | before and after under a divider (first two pictures)              |

- One `![Alt](file)` per line, at least two; `![[…]]` is refused, `//` is a
  comment. `Foto (1).jpg` names work; a `"Title"` or `|300` size is ignored.

## 7. Other blocks and inline syntax

### Task summary

**Insert: task summary** (`Einfügen: Aufgaben-Zusammenfassung`).

````markdown
```schreibstube-tasks

```

## Besichtigung

- [ ] Termin bestätigen
- [x] Exposé senden
````

- The block shows "20 open of 21" for the whole note; each heading with
  tasks shows its own count. Group tasks under headings for that.
- `- [ ]` is open, any other mark is done. A done task folds its indented
  details away.

### Callouts

`> [!note] Title`, then `> text` lines. Every kind prints in one of four
styles, coloured by the template:

- note: `note`, `info`, `todo`, `abstract`, `summary`, `tldr`, `example`,
  `quote`, `cite`
- tip: `tip`, `hint`, `important`, `success`, `check`, `done`
- warning: `warning`, `caution`, `attention`, `question`, `help`, `faq`
- danger: `danger`, `error`, `bug`, `failure`, `fail`, `missing`
- `notes`: speaker notes in a deck; in any other print a note.

### Icons in the text

`:name:` is drawn as an icon in Obsidian and on the website, and stays the
word in a mail. Use only names you are sure of: `:home:`, `:building:`,
`:key:`, `:map-pin:`, `:phone:`, `:mail:`, `:calendar:`, `:folder:`,
`:star:`. Typing `:` and two letters in Obsidian lists all of them.

### Diagrams

` ```mermaid ` and ` ```vizardry ` fences are drawn by Obsidian and its
plugins, then printed and published as pictures. A diagram that cannot be
drawn prints as its source.

### Footnotes and links

- `Text[^1]` and `[^1]: Note` anywhere; printed at the foot of the page.
- `[[Note]]` prints as its name; `[Text](https://…)` as a link.
- `[[Bericht.pdf#page=12|↗]]` opens a PDF at a page (written by
  **Insert: summary from the attached PDF**).

## 8. Mail

**Send note as mail** (`Notiz als Mail senden`) sends the note as plain text
after a confirmation; **Fetch replies into note** (`Antworten ins Doc holen`)
appends answers.

```markdown
---
schreibstubeTo: kunde@example.com
schreibstubeCc: [innendienst@example.com]
schreibstubeSubject: Angebot Objekt 4711
---

Guten Tag Herr Beispiel,

anbei unser Angebot …
```

- The body is the mail: no title heading needed. Write the greeting and the
  closing yourself; nothing is added. Formatting becomes plain text, a table
  stays a table of text, and a formula is sent as its result. Embedded files
  cannot be attached.

## 9. Publishing

**Publish folder** (`Ordner veröffentlichen`) puts a folder on a website.
A note goes online only with `published: true`.

```markdown
---
published: true
title: Hallo Welt
date: 2026-09-12
description: Kurzfassung für Index und Suchmaschinen
slug: hallo-welt
---
```

- All but `published` are optional. Slideshows, diagrams and totals are
  carried over.
- Leave `description` out rather than guess: an empty one may be written by
  the AI when the note is published. Write one only when you know what the
  note says.

## 10. Document sync

A note bound to a remote Markdown file; changes arrive as cards to accept
(**Update note**, `Notiz aktualisieren`).

```markdown
---
schreibstubeSyncedFrom: https://github.com/org/repo/blob/main/docs/guide.md
schreibstubeSyncEvery: Alle 2 Tage
---
```

- HTTPS only, and the path must end in a Markdown extension.
- `schreibstubeSyncEvery` reads German or English words (`täglich`,
  `every 6 hours`) or a five-field cron line such as `0 9 * * 1-5`.

## 11. Glossary

A note of preferred and forbidden terms, checked by **Proof-read note**
(`Notiz korrigieren`).

```markdown
---
schreibstubeGlossary: true
schreibstubeLanguage: de
schreibstubeDefaultSeverity: error
---

| Concept | Term      | Status     | Match | Note                  |
| ------- | --------- | ---------- | ----- | --------------------- |
| objekt  | Objekt    | preferred  | word  |                       |
| objekt  | Immobilie | deprecated | word  | Hausbegriff seit 2024 |
```

- Status: `preferred`, `admitted`, `deprecated`, `superseded`.
- Match: `word` (default, tolerates German endings), `exact`, `prefix`.
- German headers work too (`Konzept`, `Benennung`, `Treffer`, `Hinweis`).

## 12. Bookmarks file

`bookmarks.md` feeds the bookmark list in Schreibstube Explorer.

```markdown
# Arbeit

- [CRM](https://crm.example.com)
- [Objekte](vault://Immobilien/Objekte)
- [[Wochenplan]]
```

- `#` and deeper headings are folders, nested by level; list items with a
  link are bookmarks; everything else is ignored.
- Schemes: `https://`, `obsidian://`, `vault://folder`, `note://path`.

## 13. Print templates of your own

A template is a folder in the vault with `template.md` and `template.typ`
(Typst). Only needed when the four built-in looks do not fit.

| Key in `template.md`        | Meaning                                          |
| --------------------------- | ------------------------------------------------ |
| `schreibstubePrintTemplate` | `true` marks the note as a template's descriptor |
| `schreibstubeEntry`         | the Typst function the layout applies            |
| `schreibstubePage`          | `{ size: a4, margin: "25mm" }`                   |
| `schreibstubeHrIsPageBreak` | `true`: a `---` starts a new page                |
| `schreibstubeImages`        | `{ maxPx: 1600, quality: 85 }`                   |
| `schreibstubeData`          | default values the layout reads                  |
| `schreibstubeSlides`        | `true`: the note is printed as a deck (see 3)    |

A value naming a picture (`logo.png`, `photo.jpg`) must be a file in the
template's folder; a missing one is left out with a warning.

## 14. Requests and what to produce

| The person asks                        | Produce                                                |
| -------------------------------------- | ------------------------------------------------------ |
| "Make a 10-slide deck from this note"  | a `Folien` note; 2–3 sections, notes for the details   |
| "Presentation for the owners' meeting" | `Folien`, agenda slide, one decision per slide         |
| "Before and after of the renovation"   | a `compare` slideshow block, or `image-left` slides    |
| "Letter to the tenant about …"         | a `Brief` note; ask for the address if you lack it     |
| "Offer by mail to …"                   | a mail note with `schreibstubeTo` and a subject        |
| "Cost overview with total"             | a table with `=sum`; `=sum(fixed)` if it goes out      |
| "Checklist for the handover"           | a `schreibstube-tasks` block, tasks under headings     |
| "Publish this as a blog post"          | the note with `published: true`, `description`, `slug` |
| "Our house terms"                      | a glossary note                                        |
| "My CV for this job ad"                | a `Lebenslauf` note in the `###`/`####`/`#####` levels |

## 15. Common mistakes

- `####` for columns — columns are `###`; the count makes the layout.
- Speaker text on the slide — put it in `> [!notes]`.
- HTML for layout (`<div>`, `<br>` grids) — use headings, columns and
  comments listed here.
- Invented keys (`schreibstubeTheme`, `schreibstubeFooter`) — ignored.
- A slideshow block with `![[…]]` lines — write `![Alt](file)` instead.
- `recipient:` or `subject:` at the top level of a letter — they belong
  under `schreibstubePrint:`.
- Writing plugin-written keys (`schreibstubeMessageId`, …) — leave them out.
