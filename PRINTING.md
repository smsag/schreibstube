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
   and nothing has to be written into the body in a magic shape.
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
  ├─ services/markdown-typst.ts   Markdown → Typst markup, pure, snapshot-tested
  ├─ services/print-assets.ts     images: bounds, hashing, file names inside the job
  │
  ├─ controllers/print-commands.ts
  │     render the note off-screen in a light theme
  │     capture Mermaid and Vizardry blocks as PNG
  │     assemble the job: main.typ, template.typ, fonts, images
  │     hand the job to the compiler, write the PDF beside the note
  │
  └─ print/compiler.ts            the Typst wasm, in a Web Worker
        acquire the runtime once, verify it, cache it in the plugin folder
```

### The compiler runtime

The wasm is 28 MB and cannot live in `main.js`, whose budget is 400 KB and
whose every byte is parsed on every start. It is fetched once per device:

- The release workflow downloads `@myriaddreamin/typst-ts-web-compiler` at the
  pinned version, verifies its SHA-256 against the value committed in
  `src/print/runtime-manifest.ts`, and attaches `typst-runtime-<version>.zip`
  (wasm plus its JavaScript glue) to the GitHub release.
- On the first print, the plugin fetches that asset with `requestUrl` from its
  own release tag, verifies the SHA-256 again, and writes it under the plugin's
  folder in the vault. A mismatch is refused and reported, never loaded.
- The compiler runs in a Web Worker built from a Blob URL, so a phone's UI
  stays responsive while a document compiles. The worker receives the fonts,
  the files and the main source as shadow files, and answers with PDF bytes.

The runtime version is pinned in source and bumped deliberately; a template
written against Typst 0.14 keeps compiling until the pin moves.

### What the converter covers

`markdown-typst.ts` walks the same Markdown the vault shows and emits Typst.
In scope for the first release: headings, paragraphs, emphasis and strong,
ordered and unordered lists with nesting, links, images and embeds, tables
with alignment, inline and fenced code, blockquotes, footnotes, `<br>`,
horizontal rules as an optional page break, callouts as styled blocks, and
Mermaid and Vizardry fences as captured images.

Not in the first release, and reported rather than dropped: LaTeX math,
arbitrary HTML, other plugins' code blocks. A block the converter cannot
handle prints as a code block with a warning the panel shows.

Every construct has a snapshot test against a fixture note. The two sample
documents are fixtures.

## The template contract

A template is a folder under a configurable root, default `Vorlagen/Druck/`:

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
#import "template.typ": letter
#show: letter.with(data: (senderName: "…", recipient: "…", date: "13.09.2026", …))
// the converted body follows
```

### Data resolution

For every key the template reads, the first of these wins:

1. The note's frontmatter under `schreibstubePrint:`, so a letter says its
   recipient and subject and a CV its title.
2. The template's `schreibstubeData`, so the sender is written once.
3. Built-ins: `date` is today in the note's language unless the note sets it,
   `title` is the note's title, `noteName` the file's basename.

A note picks its template with `schreibstubePrintTemplate: Brief`; without it,
the command asks and remembers the answer in the note. Keys are prefixed
`schreibstube`, as every frontmatter key this plugin reads.

### What a template may not do

The descriptor is validated before anything compiles, and a template that
fails validation is reported by name and reason:

- No `@preview` or `@local` package imports. The runtime is offline and the
  packages would be a network dependency at print time.
- No path outside the template folder. Every `image()` and `read()` resolves
  inside the job's shadow file system, which holds only the template's files
  and the note's captured assets.
- Limits: at most 12 font files and 8 MB of fonts, 40 images and 24 MB of
  images per job, 20 s of compile time, 30 MB of PDF. Each is a named
  `MAX_…` constant with a test.

## Diagrams

Mermaid and Vizardry cannot run in Typst. The plugin renders the note into a
detached container of the template's text width, with the light theme forced
by class, waits for the DOM to settle, and captures each diagram block:

- **Mermaid**: the SVG Obsidian produced, rasterised at double resolution to
  PNG through a canvas.
- **Vizardry**: through its export function when the plugin is installed and
  offers one (see the plan handed to that repository), otherwise through the
  same generic capture, which serialises the block's DOM into an SVG
  `foreignObject` and rasterises that. Interactive controls are hidden first.
- **Anything else**: the generic capture, best effort, warning on failure.

The image replaces the fence in the converted body with the template's
diagram rule: full text width, aspect kept, never split across pages, scaled
down to fit a page when taller, an optional caption from the heading above.

## Output

The PDF is written beside the note with the note's name, overwritten on
reprint, then revealed in the file pane. A settings option redirects output to
a fixed folder for vaults that keep exports apart.

## The plan

Each epic ends with `npm run check` green and the floors unchanged or higher.

### Epic 1: the decisions, pure

- `print-template.ts`: discovery by frontmatter flag, descriptor parsing with
  every field validated, the limits.
- `print-data.ts`: resolution order, built-ins, date formatting per language.
- `markdown-typst.ts`: the converter, with snapshot tests over both samples
  and one fixture per construct.
- `print-assets.ts`: image bounds through the existing `image-resize` service,
  content hashing, job file naming.

Done when: the two samples convert to Typst that compiles with the native
binary in CI and matches a committed snapshot.

### Epic 2: the compiler runtime

- `runtime-manifest.ts`: version and SHA-256 of the runtime asset.
- `scripts/fetch-typst-runtime.mjs`: used by the release workflow to build and
  verify the asset; the workflow attaches it.
- `print/compiler.ts`: acquire, verify, cache; worker lifecycle; the compile
  call with fonts and shadow files; diagnostics mapped to a notice.

Done when: a fresh vault on desktop and on a phone prints the letter fixture
after one download, and a tampered asset is refused.

### Epic 3: capture and the command

- Off-screen light-theme render, settle detection, Mermaid and generic
  capture, the Vizardry hook.
- `print-commands.ts`: the command, the template picker, progress, the
  written PDF, the reveal, gated availability like every other command.
- Settings section: templates root, output folder, image caps.

Done when: the diagram sample prints with both Mermaid diagrams and both
Vizardry canvases as light images on the pages the template puts them on.

### Epic 4: the two example templates

`examples/print/lebenslauf/` and `examples/print/brief/`, faithful to the two
samples, Fira Sans in the faces they use, documented in their `template.md`.

### Epic 5: documentation and release

This file becomes the reference; `README.md` gets a section and the
documentation table a row; the changelog entry; the release attaches the
runtime; the mobile checklist gains "print the letter example".

### Later

Page numbers and running headers as template options; LaTeX math through
Typst's own math; batch printing a folder; a template gallery.

## Non-functional requirements

- Deterministic: the same note, template, runtime and fonts produce the same
  PDF bytes on every device.
- Offline after the runtime's one download; no network at print time.
- Under 3 s from command to written PDF for a ten-page note on a current
  phone, excluding the first download.
- The plugin bundle stays within its budget; the runtime never enters it.
- Every failure names its cause in the language of the vault: which template,
  which line, which limit.

## Metrics

North star: PDFs printed per week with a template. Supporting: time from
first command to first PDF (activation, includes the download); p95 compile
time on mobile; print failure rate by cause; share of prints from mobile;
templates per vault.
