# Printing

A note becomes a PDF through a template, on every platform, with nothing
outside the vault. This document is the specification and the implementation
plan; it was written before the code, and the code has to keep it true.

## The decisions

Five were made, in this order, and each shapes what follows.

1. **Typst is the typesetter.** It produces the smallest files of the engines
   measured, compiles a four-page CV in a tenth of a second, has page-level
   layout that CSS lacks, and runs as WebAssembly inside a WebView. Templates
   are Typst files.
2. **No bridge.** The compiler runs in the plugin, on the device. Printing
   works offline, on a phone, without a token or a deployment. The bridge
   stays what it is: the thing that speaks protocols a WebView cannot.
3. **Diagrams are captured, always light.** Mermaid and Vizardry blocks are
   drawn by Obsidian and by the Vizardry plugin, so the plugin renders the note
   off-screen in a light theme, captures each diagram as a PNG, and hands it
   to Typst as an image. Paper is light whatever the vault's theme.
4. **Data lives in frontmatter.** A name, an address, a recipient, a subject:
   the note's frontmatter says it, the template's frontmatter holds defaults,
   and nothing has to be written into the body in a magic shape. An earlier
   draft lifted labelled paragraphs out of the body instead; frontmatter says
   the same thing without teaching anyone a convention.
5. **Size is a guardrail, not a goal.** Fonts are embedded as the template
   ships them, images are capped generously, and the caps exist to protect
   memory on a phone rather than to squeeze bytes.

### What the measurements said

The two sample documents, compiled through both candidates, with iA Writer's
own output for reference:

| Document           | iA Writer | Chromium        | Typst                                   |
| ------------------ | --------- | --------------- | --------------------------------------- |
| CV, 4 pages, photo | 196 KB    | 123 KB, 6 pages | 108 KB, 4 pages                         |
| Letter, 1 page     | 20 KB     | 38 KB           | 27 KB                                   |
| Engine footprint   | —         | ~300 MB         | 54 MB native, 28 MB wasm (10.8 MB gzip) |
| Compile time       | —         | 1 to 2 s        | 0.1 s native                            |

Each embedded font face costs roughly 14 KB after subsetting. The photo in
the CV was 140 KB of the original's 196 KB; at the same printed size as a
JPEG it is 6 KB.

## Architecture

Everything runs in the plugin. Decisions live in `src/services/` and are pure;
the controller wires them to Obsidian and to the compiler.

```
note + frontmatter
  │
  ├─ services/print-template.ts   discover templates, parse descriptor, validate
  ├─ services/print-data.ts       resolve data: note frontmatter → template defaults
  ├─ services/markdown-typst.ts   Markdown → Typst markup, pure, tested
  ├─ services/print-job.ts        main.typ, the job's files, the limits
  ├─ services/print-prelude.ts    the helpers a converted note calls
  ├─ services/typst-value.ts      values → Typst literals, never into source
  ├─ services/typst-runtime.ts    which bytes the compiler may be
  ├─ services/svg-capture.ts      how large a drawing is, and how to detach it
  │
  ├─ controllers/diagram-capture.ts
  │     draw each diagram off-screen in a light theme and capture it
  │
  ├─ controllers/print-commands.ts
  │     assemble the job: main.typ, template.typ, fonts, pictures
  │     hand the job over, write the PDF, say what was left out
  │
  └─ print/typst-compiler.ts      acquire the runtime, verify it, run it
     print/typst-worker.ts        the thread it runs on
```

### The compiler runtime

The wasm is 28 MB and cannot live in `main.js`, whose budget is a few hundred
kilobytes — `scripts/check-bundle.mjs` holds the figure and the reason it last
moved — and whose every byte is parsed on every start. It is fetched once per device:

- The release workflow runs `scripts/fetch-typst-runtime.mjs`, which downloads
  `@myriaddreamin/typst-ts-web-compiler` at the pinned version, checks both
  files against the hashes committed in `src/services/typst-runtime.ts`, and
  fails the release rather than publishing anything else. The two files are
  attached to every release and covered by its provenance attestation.
- On the first print the plugin fetches them with `requestUrl` from its own
  release tag, hashes them again, and writes them beside the plugin. The cache
  is hashed on every later start too, because it sits in a folder a person can
  open and "it worked yesterday" is not a reason to run what is there today.
- The compiler runs in a Web Worker built from a blob, so the interface stays
  responsive while a document is set. The module is compiled on the main thread
  and the `WebAssembly.Module` is posted across, which is what stops 28 MB from
  being copied. The worker gets the fonts and the job's files, and answers with
  PDF bytes.

### The standard fonts

The typesetter has no typeface of its own. In a browser there are no system
fonts for it to find, and a page set without a face is a blank page — which is
what every template without a `fonts/` folder printed, every example included,
until these were added. So the faces Typst itself defaults to travel with the
compiler: Libertinus Serif for text and DejaVu Sans Mono for code, regular,
italic, bold and bold italic, about 2 MB in all. Beside them travel the faces
the built-in Standard is set in, the Klartext theme's: Fira Sans (regular,
italic, semibold, bold, bold italic) and JetBrains Mono (regular, italic, bold,
bold italic), about 3.4 MB, and Fira Sans Condensed semibold and bold for the
Lebenslauf example's headings, about 1 MB. They are the full upstream files, not the Latin
subsets the theme embeds, so a subscript digit or an arrow in a note has a
glyph.

They are pinned exactly like the compiler. `services/typst-fonts.json` lists
four sets, each with its upstream at a tag or commit (`typst/typst-assets`,
`google/fonts`, `JetBrains/JetBrainsMono`) and a hash per file; the release
script reads the same file, fetches, checks, and attaches each font as
`typst-runtime-fonts-<set version>-<file>`, and a device fetches it once and
hashes it again from the cache. Static cuts, not the variable fonts upstream
also ships: Typst sets a variable font in its default instance whatever weight
is asked for. The worker receives them once, at start, and adds them to every
job beside the template's own. Typst picks by family, so a template that names
its font gets it; one that names none, or names one it did not bring, is set in
the standard face. The licences (OFL for Libertinus, Fira and JetBrains Mono,
and the Bitstream Vera licence for DejaVu) allow redistribution with the notice
each font carries in its own metadata.

Measured on this hardware: 226 ms to instantiate, 171 ms to set the letter,
433 ms to set the four-page CV with its photo and four font faces.

The runtime version is pinned in source and bumped deliberately; a template
written against Typst 0.14 keeps compiling until the pin moves.

### What the converter covers

`markdown-typst.ts` walks the same Markdown the vault shows and emits Typst. It
is hand-written: the bridge's site renderer uses markdown-it, but the bridge is
a server with room for a dependency tree, and this runs inside a bundle whose
budget is a few hundred kilobytes, parsed on every start.

Carried over: headings, paragraphs, emphasis, strong, strikethrough, highlight,
ordered and unordered lists with nesting and their start number, task lists,
links, wikilinks as their text,
images and embeds, tables with the alignment the delimiter row states, inline
and fenced code, blockquotes, callouts, footnotes placed where they are
referenced, `<br>` as a line break, and horizontal rules as an optional page
break.

Dropped, with a warning rather than in silence: raw HTML, embedded notes, and
a picture that cannot be read. Raw HTML means an element HTML knows — `<span>`,
`<kbd>`, `<div>` —, whose tags go and whose words stay; anything else between
angle brackets, such as the placeholder `<DOING SOMETHING>`, is text and prints
as text. HTML comments (`<!-- … -->`) never reach paper, like `%%…%%`.

Pictures: anything the device can decode is printed, drawn again at the size it
prints as a format Typst reads (`services/print-images.ts`). JPEG, PNG and WebP
stay what they are; GIF and BMP become PNG, since a canvas cannot write them;
AVIF and HEIC become JPEG, on a white ground where they were transparent. The
picture's name in the job ends in what the bytes now are — `IMG_2443.avif.jpg`
— because Typst tells a format by its extension. SVG goes to Typst as it is and
prints as lines. A picture in a format no print can carry is named as such; one
that is not in the vault is named as not found. A diagram that could not be drawn prints as its
own source in a code block — a missing diagram is a page that lies about what
the note says.

Not yet: LaTeX math. It is reported like the rest.

Every construct has a test, and both sample documents are fixtures.

A string test cannot say whether a string is Typst: every callout once failed
to print while its test passed. So CI also compiles. `scripts/check-print-compile.mjs`
builds a job for every case in `src/testing/print-fixtures.ts`, for both
example templates and two made in the script — one with no opinions, one that
replaces every helper — and runs it through the worker's own source on the
pinned runtime and fonts. A job fails when Typst refuses it, or when the note
has text and the PDF carries no font. Add a case with every converter fix.

```bash
node scripts/fetch-typst-runtime.mjs   # once: the pinned runtime and fonts, into dist/
npm run check:print
```

## The print dialog

"Doc drucken" opens `ui/print-dialog.ts` once the note has been read and its
diagrams drawn; "Doc drucken (ohne Dialog)" skips it and prints as the
template sets the page, unless the default-template setting says to ask.

The note is read, and every diagram drawn and captured, once — before the
dialog opens. A change in the dialog rebuilds the job and compiles it, which
is the cheap part; a template's files and each picture at a template's size
are read once per dialog too. The preview is that compile's PDF, drawn page by
page with the pdf.js Obsidian ships (`pdf/pdf-preview.ts`), and "Drucken"
writes the same bytes when nothing changed since it was set. A preview set for
older choices is thrown away.

Every page is in the preview, and only the pages near the view are drawn. A
drawn page is a canvas the panel's width at the screen's density — about 7 MB
for a slide on a phone — so drawing every page of a sixty-slide deck up front
would hold some 400 MB, which is why the preview used to stop at twelve. Now
each page stands as a placeholder of its own size, the first two are drawn
before the preview is shown, a page is drawn when it comes within a screen of
the view, and once eight are held the ones farthest from it are let go
(`services/preview-pages.ts`). Scrolled end to end in Chromium, a 61-page deck
never held more than eight.

What each choice means is `services/print-options.ts`:

| Choice                        | Effect                                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vorlage                       | The template; its page-break habit comes with it                                                                                                                                                                                    |
| Ränder                        | `standard` keeps the template's margin; `small` and `wide` set 15 and 35 mm through the page rule `main.typ` sets before the layout. A layout that sets its own margin (`layoutFixesMargin`) keeps it, and the choice is greyed out |
| Trennlinien als Seitenumbruch | The converter's `hrIsPageBreak`                                                                                                                                                                                                     |
| Eigenschaften drucken         | `frontmatterRows`: the note's properties without the `schreibstube…` keys, lists on one line, links as their names; placed after a leading `=` heading as `#schreibstube-properties(rows)`                                          |
| Ausrichtung                   | Offered for a slide template: the content centred (the default) or at the left edge; see "A note as slides"                                                                                                                         |
| Format                        | Offered for a slide template: 16:9 or 4:3; see "A note as slides". The page-break toggle is not offered then                                                                                                                        |
| Diashows                      | Offered when the note holds one. `layout` (the default, and what the quick print uses) or `stacked`; see below                                                                                                                      |
| Pythia-Fußnoten               | Offered when Pythia is on and the note links to a conversation. On by default then; see below                                                                                                                                       |

### Pythia's footnotes

Pythia links a passage of a note to a conversation or one of its chapters.
When Pythia is switched on and publishes its print API (version 1), the dialog
asks it how many such links the note holds, and offers two things when there
are any:

- **Pythia-Zusammenfassungen als Fußnoten**, on by default. The print converts
  Pythia's copy of the note, where each link is a highlighted passage with its
  conversation's summary as a footnote, numbered with the note's own. The quick
  print does the same whenever the note has links. The note is never changed.
- **Zusammenfassungen aktualisieren (n veraltet, m fehlen)**, shown only when
  a summary is outdated or missing. It asks Pythia once, on the press, because
  each summary is a model call; progress runs in the dialog's status line, the
  request is cancelled when the dialog closes and given three minutes, and the
  preview is rebuilt afterwards so it matches what prints.

Another plugin's answers are untrusted like any input
(`services/pythia-print.ts`): counts must be whole numbers under 100 000, the
copy must be text no more than a million characters longer than the note, and
a refresh answer must name what it refreshed and what failed. Anything else,
or Pythia throwing, prints the note as it is with a warning that the footnotes
were left out — never a failed print.

### Slideshows on paper

A ` ```schreibstube-slideshow ` block is read by the same `parseSlideshow` that
renders it, so a block the screen refuses prints as its source with the
screen's reason. `services/print-slideshow.ts` decides which pictures reach the
page and how wide each is; the prelude's `schreibstube-slideshow(kind, images,
columns:)` arranges them, and a template may replace it.

| Layout      | "Wie in der Notiz"                                                                                                                     | "Alle Bilder untereinander"                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slideshow` | the first picture, text width, description beneath                                                                                     | every picture of the block, one under another at the text's width, each with its description; a page break falls between pictures, never inside one |
| `filmstrip` | the first picture over every thumbnail, eight to a row                                                                                 | as above                                                                                                                                            |
| `feature`   | the scene (⅔) beside two details, 3:2                                                                                                  | as above                                                                                                                                            |
| `strip`     | equal 4:3 tiles in `stripColumns` columns                                                                                              | as above                                                                                                                                            |
| `masonry`   | three balanced columns at the pictures' own proportions, read down each column; a series taller than a page goes on in a further block | as above                                                                                                                                            |
| `compare`   | before and after side by side, each named                                                                                              | as above                                                                                                                                            |

Each picture is read only as large as it prints: the image request carries
the share of the text width it takes, and `pictureEdge` turns the template's
`maxPx` into the edge to resize to, never below 400 px. A strip tile a third
of the page wide is read at a third of the size, which keeps a long filmstrip
inside the job's picture budget. Picture paths are tried the way the screen
tries them (`linkpathCandidates`), so `my%20photo.png` is found. A picture
that is not in the vault is left out and named; the rest of the slideshow
prints.

### A note as slides

A template whose descriptor says `schreibstubeSlides: true` prints the note as
a deck, one slide to a page. The note is not rewritten for it; its outline is
the deck's. `services/print-slides.ts` decides the grouping from the
converter's top-level blocks, and the prelude's `schreibstube-slide` draws each
slide, which a template may replace.

| In the note                | On the slides                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `#`, `##`                  | a new slide, titled by the heading                                                                        |
| `#` with nothing under it  | a section divider; when it opens the deck, the title slide                                                |
| `###`                      | a column, titled by the heading: a slide has as many columns as `###` headings, two or three side by side |
| `####` and deeper          | an ordinary heading inside its column                                                                     |
| `---`                      | a new, untitled slide, whatever `hrIsPageBreak` says; a rule with nothing after it leaves nothing         |
| a heading inside a callout | the callout's, never a slide's                                                                            |

What stands above a slide's first column heading runs across the full width;
a fourth `###` starts a second row rather than a fourth, narrower column.

**Column widths are a comment.** Columns are equal unless the slide says
otherwise, in a comment plain Markdown hides everywhere:
`## Zwei Wege <!-- columns: 1 2 -->` makes a third and two thirds, and the
comment may stand on a line of its own anywhere in the slide, or just above
its heading; Obsidian's `%% columns: 1 2 %%` is read the same. Two or three
shares, separated by spaces, commas or a colon, each above nought and at most
twelve (`parseWidths`). A comment that is not one of these, or holds a share
for a different number of columns than the slide has, leaves the columns equal
and is named in the warnings. Only a print as slides reads the comment
(`markSlideDirectives` lifts it out before comments are stripped, onto a line
of its own no note can write); a comment in a code fence is code, and every
other comment goes as it always has. It reaches the slide as `widths:`,
fractions one per column, or `none`.

**Picture layouts.** A slide that holds one picture and nothing else — no
columns, no other block — gives it all the room under its title, never
cropped, its caption beside it. `<!-- layout: image-left -->` or
`image-right`, written like the column widths, sets the slide's first
picture on its own line on one half, at the full height, caption beneath,
and fits everything else on the other half. A layout that is not one of the
two, or one asked for on a slide with no picture on a line of its own, is
named in the warnings and the slide stays as it is. The layout reaches the
slide as `layout:` (`"text"`, `"picture"`, `"image-left"`, `"image-right"`)
and the picture as `picture:`; `schreibstube-slide-area` lays out the part
under the title accordingly, and `schreibstube-slide-filled` draws a picture
that has a space of its own.

**Drawings on slides.** A captured Mermaid or Vizardry drawing is a slide
picture like any other, one per panel, so it takes the same captions and the
picture layouts. Its caption is the drawing's own name, not the heading above
it, which on a slide is the title standing right over it already. A
slideshow block keeps the arrangement the dialog chose.

**Speaker notes.** A `> [!notes]` callout is what the speaker says over the
slide it stands in, and no slide shows it; written above a slide's heading it
belongs to that slide. The dialog's **Sprechernotizen**, off by default, adds
pages after the last slide: each slide with notes, by its number and title,
then its notes. Each slide leaves its notes as metadata labelled
`<schreibstube-notes>` (`schreibstube-slide-note-mark`), and
`#schreibstube-slide-notes(heading:, slide:)` at the end of the body gathers
them. On a print that is not a deck, the callout prints as a callout.

**Agenda.** `<!-- agenda -->` on a slide lists the deck's section dividers
there, or every other titled slide when the deck has none, above whatever
else the slide holds.

**A slide never overflows.** `schreibstube-fit` in the prelude makes a slide's
body smaller until it fits the space left under the title, and never larger.
It sets the body wider and scales the whole down, so lines keep the width of
the slide and every size keeps its proportion to the others. Each measurement
sets the slide again, so the search is short: the square root of the space
over the natural height first, then the factor the curve through those two
heights (height ≈ natural · f^p) says fills the space. A slide that fits is
measured once, one that shrinks usually three times. Measured on a laptop, a
61-slide deck with a third of its slides overfull sets in 1.5 s, where six
halvings took 2.5 s. A body that does not get shorter when it is set
wider — a picture at the full width grows with it — is scaled as it stands
instead. Nothing is cut off and nothing runs onto a second page.

**A slide set too small is named.** Each fit leaves the scale it settled on,
with its page, as metadata labelled `<schreibstube-fit>`. After a compile
that made a PDF, the worker asks the same compiler for those
(`query(main, undefined, "<schreibstube-fit>", "value")`), which reuses the
compile and takes a few milliseconds, and hands the JSON back beside the
bytes. `readSlideFits` reads it as untrusted — at most 2 000 entries and
256 KB, a page a whole number and a scale between nought and one — and
`smallSlides` names every slide set below 60 %, each once at its smallest.
The warning stands under the preview and in the notice after printing:
"Folien 6, 9 tragen mehr, als passt, und stehen bis auf 42 % verkleinert —
besser teilen". A template that draws its own slide and keeps
`schreibstube-fit` keeps the report; the compile check fails when the
overfull fixture on a slide template reports nothing. The space is a
fraction of the page's flow (`block(height: 1fr)`), which is measured after
the slide's footnotes, so a footnote has its room at the foot.

**Where the content stands.** **Ausrichtung** in the dialog centres a slide's
content across the page — the default — or sets it at the left edge; it
starts at the note's `schreibstubePrint.align` (`center` or `left`). The choice
reaches every slide as its `horizontal` argument. It moves blocks, not lines:
the converter wraps every block of a slide — a paragraph, a list, a table, a
heading — in `#schreibstube-slide-block[…]`, which places the block by the
alignment and keeps its own lines flush left. Centred, a short paragraph or a
list stands in the middle as a whole, as wide as its longest line, and reads
like any text; a block as wide as the slide looks the same either way.

**Pictures carry their alt text.** On a slide a picture is
`#schreibstube-slide-image(path, alt)`, a figure whose caption is the alt text,
in a callout too; an embed's alias that is a width (`![[a.png|300]]`) is no
caption. Where the caption goes is the slide's: across the full width —
a slide without columns, or the part above them — it stands to the right of
the picture, level with its foot, and in a column it stands beneath
(`schreibstube-slide-pictures`). A picture without alt text stands alone.

The format is the dialog's: **Format** offers 16:9 and 4:3, which are Typst's
`presentation-16-9` and `presentation-4-3`, and replaces the paper the
descriptor names. It starts at the note's `schreibstubePrint.format` (`"16:9"`
or `"4:3"`), else the descriptor's paper when it is one of the two, else 16:9,
and it is kept when the template changes. A slide template has no page-break
toggle, since a rule starts a slide. The **Folien** example is a slide
template; speaker notes and a presenter view are not part of printing.

Nothing is remembered between prints. The built-in Standard sets its margins
in its descriptor rather than its layout, which is what lets the presets move
them; a vault template that wants the presets does the same.

## The built-in template

A note prints before the vault holds any template. The plugin carries one,
**Standard**, which is the Klartext theme on paper: A4, 25 mm margins, the text
in JetBrains Mono at 9 pt and ragged right, headings, table headers and callout
labels in Fira Sans, marks (dashes, bare numbers, quote bars, task boxes) in a
faint grey, one hairline colour for every rule, code between two hairlines
under a `</> language` header, links in the text's colour with a dotted rule,
footnotes at the foot of the page, and the note's title and page number once
there is more than one page. A note without a first heading gets its file name
as a title.

The print dialog's **Text font** (JetBrains Mono or Fira Sans) reaches the
layout as `data.monospace` (`"true"` or `"false"`). With Fira Sans the text and
the page foot are set in it at 10 pt; headings, tables and code do not change.
Like every choice in the dialog it holds for one print. It starts where the
note's `schreibstubePrint.monospace` says (`noteMonospace` in
`services/print-options.ts`), and is set after the note's data, so what the
dialog shows is what prints. The row is offered only for a layout that reads
`data.monospace` (`layoutReadsMonospace`), which in practice is Standard.

It is `examples/print/standard/`, carried like the other examples: the
generator writes its files and its parsed frontmatter into
`services/print-examples.ts`, and `services/print-builtin.ts` builds the
template from them, so the plugin needs no YAML parser. Its folder is
`:builtin/Standard`, a path no vault can hold, and it reads no file from the
vault. It belongs to the plugin, not the vault: always offered, never deleted
with a folder, and not among the examples "Vorlage anlegen" lays down
(`copyableExamples`), because a copy by the same name would only raise the
question which one prints.

Which template a note gets (`chooseTemplate` in `services/print-template.ts`):

1. The one it names in `schreibstubePrintTemplate`, by folder path or name.
   `Standard` always means the built-in one; a vault template of that name —
   a copy made when that was still possible — is reached by its folder path.
2. Otherwise the default from the setting `printDefaultTemplate`: empty for
   Standard (the default), a vault template's folder, or `:ask` for the picker.
   A default whose folder has gone is reported, and the picker is shown.

The template contract below holds for Standard exactly as for a vault template;
it only calls `data.title` and the built-in `data.lang`.

## The template contract

A template is a folder anywhere in the vault. What makes it one is the flag in its descriptor,
not where it sits; the configurable root, default `Vorlagen/Druck/`, is where a new one is
suggested and nothing more:

```
Vorlagen/Druck/Brief/
  template.md      the descriptor: frontmatter, and notes to its author
  template.typ     the layout: a function taking the body and the data
  fonts/*.ttf      embedded and subset by Typst; OTF works too
  logo.png         optional assets the layout may reference
```

`template.md`:

```yaml
---
schreibstubePrintTemplate: true
schreibstubePage: { size: a4, margin: "25mm" }
schreibstubeHrIsPageBreak: true
schreibstubeImages: { maxPx: 1600, quality: 85 }
schreibstubeData:
  senderName: Steffen Seitz
  senderAddress: "Schreinerstraße 21\n10247 Berlin"
  senderPhone: "+49 (0) 172 74 69 704"
  senderEmail: steffen@smsag.de
---
How to use this template, in prose, for whoever opens the folder.
```

`template.typ` receives the body as content and the data as a dictionary:

```typst
#let letter(body, data) = {
  set page(paper: "a4", margin: 25mm)
  set text(font: "Fira Sans", size: 12pt, lang: "de")
  align(right)[#data.senderName \ #data.senderAddress]
  v(2cm)
  data.recipient
  align(right, data.date)
  text(fill: blue, weight: 700, data.subject)
  body
}
```

The plugin generates `main.typ`:

```typst
#import "schreibstube.typ": *
#import "template.typ": *
#let data = (senderName: "…", recipient: "…", date: "13.09.2026", …)
#set page(paper: "a4", margin: 25mm)
#show: body => letter(body, data)
// the converted body follows
```

### The helpers a note calls

The converter never emits Typst's own primitives for the things a template
should own. It calls these instead, defined in `services/print-prelude.ts` and
placed in the job as `schreibstube.typ`. A template that wants a different look
defines any of them at the top level of `template.typ`, and its definition
wins: `main.typ` imports the prelude first and everything the layout defines
after it.

| Helper                                                         | Signature                                                                                            | Given                                                                                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schreibstube-image`                                           | `(path, alt)`                                                                                        | one embedded picture                                                                                                                                                                                |
| `schreibstube-diagram`                                         | `(paths, caption)`                                                                                   | **an array** of pictures, all from one fence, and one caption for the group                                                                                                                         |
| `schreibstube-code`                                            | `(source, language)`                                                                                 | a fence that is not a diagram, or one that could not be drawn                                                                                                                                       |
| `schreibstube-table`                                           | `(columns:, align:, ..cells)`                                                                        | a pipe table; the first argument among `cells` may be a `table.header`                                                                                                                              |
| `schreibstube-callout`                                         | `(kind, title, body)`                                                                                | an Obsidian callout, `kind` one of `note`, `tip`, `warning`, `danger`                                                                                                                               |
| `schreibstube-task`                                            | `(done)`                                                                                             | a task's box: the marker of a bulleted task, beside the number of a numbered one                                                                                                                    |
| `schreibstube-task-item`                                       | `(marker, body)`                                                                                     | a bulleted task, `marker` its box as `schreibstube-task` drew it; a list of one item, so the box stands where the bullet would                                                                      |
| `schreibstube-properties`                                      | `(rows)`                                                                                             | the note's properties, when the dialog prints them: an array of `(key, value)`                                                                                                                      |
| `schreibstube-slide`                                           | `(kind:, level:, horizontal:, title:, columns:, widths:, layout:, picture:, notes:, intro:, cells:)` | a slide, for a slide template: `kind` one of `title`, `section`, `content`; `horizontal` `center` or `left`; `title` content or `none`; `cells` an array of `(title, body)`; see "A note as slides" |
| `schreibstube-slide-image`                                     | `(path, alt)`                                                                                        | a picture on a slide: a figure of kind `"schreibstube-slide-image"` whose caption is the alt text, or none                                                                                          |
| `schreibstube-slide-block`                                     | `(body)`                                                                                             | one block of a slide, placed by the alignment in force with its own lines flush left                                                                                                                |
| `schreibstube-fit`, `-slide-align`, `-slide-pictures`          | `(body)`, `(horizontal, body)`, `(beside, body)`                                                     | not called by the note: shrink-to-fit, the alignment, and where captions go, for a template that draws its own slide, imported with `#import "schreibstube.typ": schreibstube-fit, …`               |
| `schreibstube-slide-area`, `-slide-filled`, `-slide-note-mark` | `(layout, picture, body)`, `(beside, body)`, `(title, notes)`                                        | not called by the note: the part under a slide's title, a picture with a space of its own, and a slide's speaker notes, for a template that draws its own slide                                     |
| `schreibstube-slide-notes`                                     | `(heading:, slide:)`                                                                                 | the speaker notes after the last slide, when the dialog asks for them                                                                                                                               |
| `schreibstube-slideshow`                                       | `(kind, images, columns: 1)`                                                                         | a slideshow: `kind` one of `single`, `filmstrip`, `feature`, `strip`, `masonry`, `compare`, `stacked`; `images` an array of `(path, description)`                                                   |

Because the layout is imported whole, a top-level name in it may shadow one the
prelude defines. That is the mechanism, so name private helpers of your own
without the `schreibstube-` prefix.

`schreibstube-diagram` takes an array rather than a single path because a fence
may draw more than one picture — a carousel's panels are one fence and several
canvases. A one-picture fence passes a one-element array, which in Typst needs
its trailing comma: `("a.png",)`. `typstArray` in `services/typst-value.ts`
writes it, and that comma is the reason the function exists.

A value that names a picture — it ends in `.png`, `.jpg`, `.webp`, `.gif` or
`.svg`, as a CV's `photo` or a deck's `logo` does — must name a file in the
template's folder. One that does not is made empty before the layout reads
it, and the print names the file (`withoutMissingPictures` in
`services/print-data.ts`): the compiler would otherwise refuse the whole
document over one picture, and every template already draws nothing for an
empty value.

### Data resolution

For every key the template reads, the first of these wins:

1. The note's frontmatter under `schreibstubePrint:`, so a letter says its
   recipient and subject and a CV its title.
2. The template's `schreibstubeData`, so the sender is written once.
3. Built-ins: `date` is today in the note's language unless the note sets it,
   `title` is the note's title, `noteName` the file's basename, `lang` the
   plugin's language (`de` or `en`), for a template to hyphenate by.

A note picks its template with `schreibstubePrintTemplate: Brief`; without it,
the default template from the settings is used — Standard unless somebody chose
another — and the picker only when the setting asks for it. Keys are prefixed
`schreibstube`, as every frontmatter key this plugin reads.

### What a template may not do

The descriptor is validated before anything compiles, and a template that
fails validation is reported by name and reason:

- No `@preview` or `@local` package imports. The runtime is offline and the
  packages would be a network dependency at print time.
- No path outside the template folder. Every `image()` and `read()` resolves
  inside the job's shadow file system, which holds only the template's files
  and the note's captured assets.
- Limits: at most 12 font files and 8 MB of fonts, 120 images and 24 MB of
  images per job, 30 MB of PDF. Each is a named `MAX_…` constant with a
  test.
- A compile deadline that grows with the job: 20 s, plus 60 ms per kilobyte
  of text and 300 ms per megabyte of pictures and fonts, at most 3 minutes.
  The costs are ten times what the laptop measured in `compileDeadline`
  (`services/print-job.ts`), for the slowest phone. A long document says in
  its notice how long it may take; one that overruns is stopped and says so.

## Diagrams

Mermaid and the canvas plugins cannot run inside Typst, so each diagram is
drawn by whoever draws it and captured as a picture.

Each fence is rendered **on its own**, into an off-screen container, rather
than found in a rendering of the whole note. A note may hold four diagrams from
two plugins, and matching them back up by position is a guess; rendered one at a
time there is nothing to match.

That container carries three classes, all of them the stylesheet's rather than
an inline style, so a theme can see what printing does instead of fighting it:

| Class                      | Why                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schreibstube-print-stage` | Off-screen but laid out, 900 px wide, on white. Not `display: none`: a diagram measures itself while it draws, and a box with no width draws nothing.                                                                                                                                                                                                                      |
| `theme-light`              | Obsidian's own. A canvas resolves its colours from the variables in scope while it renders, so rendering under this class bakes the light ones in — which paper needs, whatever the vault is set to.                                                                                                                                                                       |
| `vizardry-no-enrich`       | Asks a canvas plugin to skip the enrichment it would otherwise fetch from the network. Printing is meant to work offline, and this is what keeps that true when a plugin would rather call out. The plugin may publish its own name for this class on its API, and that name wins; the one here is the fallback, pinned because a class cannot be imported across plugins. |

### Mermaid

Mermaid is not captured from the note. Obsidian draws it with the app's theme
and with most labels — every flowchart's — as HTML inside `<foreignObject>`,
and a browser refuses to let a canvas that has drawn one be read back
(`Tainted canvases may not be exported`): the diagram went to paper as its
source. So printing asks Obsidian's Mermaid (`loadMermaid()`) for a drawing of
its own, with the diagram's text changed by `printableMermaid` in
`services/print-mermaid.ts`:

- `%%{init: {"theme": "default", "darkMode": false}}%%` first — after a
  frontmatter block, never before one — and only when the diagram names no
  theme itself, in its frontmatter or a directive of its own;
- `%%{init: {"htmlLabels": false, …}}%%` last, so labels are SVG text whatever
  the diagram says.

Mermaid applies a render's directives to that render only; Obsidian's own
diagrams are untouched. It draws inside the print stage, since a Gantt chart
takes its width from where it is drawn. The SVG is then captured as below.
Checked in Chromium against Mermaid 11: flowchart, sequence, class, state,
ER, mindmap, pie and Gantt all capture, where flowcharts used to fail.

What is captured, in order, for every other fence:

1. **The plugin's own export**, when the block's language names a plugin that
   offers one at or above the contract version this plugin knows
   (`canvasExportApi` in `services/workspace-internals.ts`). A plugin knows
   which part of its canvas is the drawing and which is a control, which panel
   of a carousel is hidden, and what its colours mean; from out here each of
   those is a guess. Vizardry is the first such plugin.

   The plugin is asked for **every** canvas under the container, not the first:
   a fence may hold a carousel, whose other panels are hidden on screen and
   would otherwise be dropped from the document silently, which is the worst
   thing a print can do — nothing in the page says a panel is missing. Each
   canvas is then waited on until the plugin says it has stopped moving, and
   captured. A canvas that fails is skipped and logged by the code the contract
   rejects with; it never ends the print.

2. **The SVG it drew**, serialised, made standalone — namespace stated, size in
   pixels rather than percent, a white ground so a light stroke is not lost —
   and rasterised to PNG at twice the page's resolution.
3. **Nothing**, which prints the fence's source with a warning.

A fence that captured some of its drawings and not others keeps the ones it got
and says how many are missing. That notice is the only thing standing between a
reader and a page that quietly holds three of four panels, so it is raised where
the fence is drawn rather than left to the converter, which by then can only see
that something arrived.

The pictures replace the fence through the template's own diagram rule, which
is given all of them at once: each full text width, aspect kept, none split
across a page, and one caption placed under
the last picture — the heading above the fence, or failing that what the plugin
calls the drawing and inside the same unbreakable block so a page break cannot
separate them.

## Output

The PDF is written beside the note with the note's name, through the vault so
it is in the file pane at once. A settings option redirects output to a fixed
folder for vaults that keep exports apart; the folder is made if it is missing.

A reprint replaces the previous print without asking. Any other PDF of that
name — a scan, a download, a signed copy — is asked about first, and kept on a
no. What counts as a previous print is a PDF whose creator is Typst
(`isTypesetPdf` in `services/print-job.ts`). A document over 30 MB is refused
rather than written.

## The plan

Each epic ends with `npm run check` green and the floors unchanged or higher.

### Epic 1: the decisions, pure — done

`print-template.ts`, `print-data.ts`, `markdown-typst.ts`, `print-job.ts`,
`print-prelude.ts`, `typst-value.ts`. Both samples were converted and compiled
with the native Typst binary during development: the letter came out on one
page, the CV on the same four the original has.

### Epic 2: the compiler runtime — done

`services/typst-runtime.ts` pins it, `scripts/fetch-typst-runtime.mjs` builds
and verifies the release assets, `print/typst-compiler.ts` acquires and runs
it. Both samples compile through the WebAssembly build.

Still to confirm on a device: the first download, and the worker. Neither can
be exercised here — see the mobile checklist in `CONTRIBUTING.md`.

### Epic 3: capture and the command — done

`controllers/print-commands.ts`, `ui/print-modals.ts`, `settings/print.ts`, and
the messages in both languages. The command is gated like every other: offered
on a Markdown note, and saying what it needs when it is run without a template.

Still to confirm on a device: that Mermaid and a Vizardry canvas both come out
light and complete. Vizardry's export API is agreed, frozen at version 1, and
released in Vizardry 0.65.0; this plugin is written against it.

The tests here prove this plugin's half against a contract they cannot run, so
three things need running on a device with both plugins installed and cannot be
proven anywhere else:

1. A wide canvas — a Wardley map or a story map — at `maxEdge: 4000`. Capture
   expands to the full scroll width, so this is the path where the scale comes
   back **below** 1. A picture is what should arrive, not a `too-large`
   rejection and a source block.
2. `header: false`, which should leave the canvas's own title row out while
   keeping the drawing's own column headers. A doubled title means it did not.
3. The class that asks the plugin to skip its network enrichment, checked by
   printing with the device offline and seeing a complete drawing.

### Epic 4: the two example templates — done

`examples/print/brief/` and `examples/print/lebenslauf/` (and, later, the built-in
`examples/print/standard/`), each documented in
its own `template.md`, with `examples/print/README.md` on installing one and
on fonts. Neither ships a typeface of its own choosing: they ask for Fira Sans
by name, and without it they are set in the standard fonts the plugin fetches
with the compiler.

### Epic 5: documentation and release — done

This file, a `README.md` section, the changelog, the release step that builds
and attaches the runtime, and a mobile checklist that gains a print.

### Later

Page numbers and running headers as template options; LaTeX math through
Typst's own math; batch printing a folder; a template gallery.

## Non-functional requirements

- Deterministic: the same note, template, runtime and fonts produce the same
  PDF bytes on every device.
- Offline after the runtime's one download; no network at print time.
- Under 3 s from command to written PDF for a ten-page note on a current
  phone, excluding the first download. Measured on a laptop: 0.6 s for the
  letter, 0.9 s for the CV, both including instantiating the module.
- The plugin bundle stays within its budget; the runtime never enters it.
- Every failure names its cause in the language of the vault: which template,
  which line, which limit.

## Metrics

North star: PDFs printed per week with a template. Supporting: time from
first command to first PDF (activation, includes the download); p95 compile
time on mobile; print failure rate by cause; share of prints from mobile;
templates per vault.
