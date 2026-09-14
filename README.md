# Schreibstube

A writing-focused Obsidian plugin: a proof-read review sidebar with glossary support, document sync from remote Markdown sources, email send/query/merge over IMAP and SMTP, a sticky heading-stack overlay, a distraction-reducing focus mode, a task summary ribbon with per-heading counts, LLM-powered file renaming, and side-pane link opening.

## Features

### Proof-read sidebar

Opens a side pane that reviews the active note and proposes changes one at a time. Nothing is written to the note until you accept a change.

- **Open proof-read sidebar** — show the panel
- **Proof-read note** — send the note for correction and fill the queue
- **Check note against glossary** — local glossary check, no API call

Each card shows the change as a word-level diff, with **Übernehmen**, **Verwerfen**, and **Anzeigen** to jump to the place in the note. **Alle übernehmen** applies the whole queue as a single undo step.

What the correction pass will not touch: frontmatter, fenced code blocks, tables, and math blocks are excluded entirely. Inline code, wikilinks, link targets, tags, and bare URLs are masked before the text is sent and restored afterwards; if a response comes back having lost one of them, that section is discarded rather than applied.

If you edit the note while the queue is open, cards whose text can no longer be located are marked _veraltet_ instead of being applied to the wrong words.

### Glossary

A glossary is an ordinary note with `schreibstubeGlossary: true` in its frontmatter and a term table. Glossary checks run locally and need no API key, so the panel is useful before any provider is configured. The selected glossary is also passed to the correction pass as a constraint, so a rewrite does not undo a term the glossary just enforced.

The term model follows TBX-Basic (ISO 30042): a concept groups several terms, and each term carries an administrative status.

| Status       | What the panel does                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `preferred`  | Offered as the replacement for other terms in the concept; flagged only when written in the wrong case |
| `admitted`   | Acceptable usage, never flagged                                                                        |
| `deprecated` | Flagged, with the preferred term offered when the concept has one                                      |
| `superseded` | Flagged, never auto-fixed, because whether the newer term applies is a judgement call                  |

The TBX picklist identifiers (`deprecatedTerm-admn-sts` and so on) and the informal `notRecommended` and `obsolete` spellings are accepted too, so an export from a termbase tool can be pasted in.

```markdown
---
schreibstubeGlossary: true
schreibstubeLanguage: de
schreibstubeDefaultSeverity: error
---

| Concept  | Term         | Status     | Match | Note                  |
| -------- | ------------ | ---------- | ----- | --------------------- |
| objekt   | Objekt       | preferred  | word  |                       |
| objekt   | Immobilie    | deprecated | word  | Hausbegriff seit 2024 |
| objekt   | Liegenschaft | admitted   |       |                       |
| makler   | Broker       | deprecated | word  |                       |
| courtage | Courtage     | superseded | word  | Vertragsabhängig      |
```

Every frontmatter key the plugin reads is prefixed with `schreibstube`, without exception, because Obsidian frontmatter is one flat namespace shared with other plugins and with your own properties.

German column headers (`Konzept`, `Benennung`, `Status`, `Treffer`, `Hinweis`) work as well. A malformed row is skipped and reported in the panel rather than failing the whole file.

`Match` controls how a term is found:

| Mode             | Behaviour                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `word` (default) | Whole word, case-insensitive, tolerating German inflection endings so _Immobilien_ matches _Immobilie_ |
| `exact`          | Case-sensitive, no inflection. Use when two spellings of one word are separate entries                 |
| `prefix`         | Matches inside a compound, so _Broker_ catches _Brokerbüro_                                            |

When a match is an inflected form, the card is marked _Beugung prüfen_, because the replacement is the base form and the ending may need fixing by hand.

**Which glossary applies** is decided by the first of these that yields anything, with no merging between them:

1. A `schreibstubeGlossaries` property in the note's own frontmatter
2. A folder rule from settings, deepest matching folder first
3. The pick in the sidebar header, which lasts for the session
4. The vault-wide default in settings

### Document sync

Binds a note to a remote Markdown file. The source is the single truth: incoming changes appear in the sidebar as cards you accept one by one, and nothing is ever pushed back. A bound note can live in any folder, since it is found by its frontmatter key rather than its location.

```markdown
---
schreibstubeSyncedFrom: https://github.com/org/repo/blob/main/docs/guide.md
---
```

A GitHub page URL is rewritten to its raw form automatically, so you can paste the link straight from the browser. Only HTTPS sources whose path ends in a Markdown extension are fetched.

**How often one note is checked.** A note may set its own interval, which replaces the vault-wide minimum for that note alone — a press release and a contract are not worth the same traffic:

```markdown
---
schreibstubeSyncedFrom: https://github.com/org/repo/blob/main/docs/guide.md
schreibstubeSyncEvery: Alle 2 Tage
---
```

Words are read in German and English — `Alle 2 Tage`, `Every 2 days`, `jede Woche`, `weekly`, `täglich`, `every 6 hours` — and mean _at most that often_, counted from the note's last check: a device that was asleep at the hour catches up at the next poll rather than waiting out another round. The review panel says the interval back as cron (`0 0 */2 * *`), so you can see how a phrase was understood.

A five-field cron expression is taken as itself, for the schedules words cannot reach:

```markdown
schreibstubeSyncEvery: 0 9 * * 1-5
```

Such a note is due once a minute the expression named has gone by unchecked. A value that cannot be read is reported rather than guessed at, and the note keeps the vault-wide interval until it is fixed.

- **Check note source for updates** — fetch now and queue any differences

With **Check when a bound note opens** on, a bound note is also checked as you open it, no more often than the configured interval. Checks use a conditional request, so an unchanged source costs one small round trip and no download.

**Private repositories.** Set a GitHub token under **Document sync** and sources in a private repository are fetched normally, through GitHub's contents API rather than the raw host, which ignores tokens. The token is stored in Obsidian's secret storage and is only ever sent to GitHub, never to another host, whatever URL a note carries. It also raises GitHub's rate limit, which matters once you poll several notes. Without a token a private source reports as not found, and the message says a token is needed rather than claiming the file is gone.

**Background poll.** With **Poll all bound notes in the background** on, every bound note is checked on a schedule, not just the one you have open. Changes found are counted, and the next time you open that note the panel says how many are waiting; the summary notice tells you how many notes changed.

The schedule is a five-field cron expression in local time:

| Expression    | Meaning             |
| ------------- | ------------------- |
| `0 * * * *`   | hourly, on the hour |
| `0 */4 * * *` | every four hours    |
| `0 8 * * *`   | daily at 08:00      |
| `0 8 * * 1-5` | weekdays at 08:00   |

Lists, ranges and steps work (`0,30`, `9-17`, `*/15`), as do month and weekday names. When both day fields are restricted they are OR-ed, which is standard cron: `0 9 1 * 1` fires on the first of the month and on every Monday. The settings screen shows the next fire time as soon as the expression parses.

Obsidian has no scheduler of its own, so a poll only runs while the app is open. A schedule that came due while it was closed is caught up once shortly after the next start, so a daily poll still works on a machine that is not always on.

- **Check all bound notes for updates** — run the poll now, regardless of schedule

Two things are deliberately protected. The note's own frontmatter is never part of the diff, so accepting a card cannot touch the binding. The remote file's own frontmatter is stripped before comparison, which is what stops the first sync from overwriting the binding and orphaning the note.

The plugin remembers a hash of the note body as of the last sync. If the note still matches it, everything that differs from the source is genuinely incoming. If you edited a bound note, the panel says so and the cards are marked, because accepting them restores the source and discards your edit. That is what a mirror means here.

If the source is deleted or moved, the panel reports it and the note is left exactly as it is. It is never emptied.

### Heading stack overlay

Keeps a sticky, context-aware heading breadcrumb at the top of the active note as you scroll. Shows the ancestor headings above the current viewport position, so you always see where you are in the document's hierarchy. Click an ancestor to jump to that heading. The overlay can be turned off entirely in settings.

### Focus mode

Dims everything except the passage you are working on. Available as three commands:

- **Focus Mode: Sentence** — highlight only the current sentence
- **Focus Mode: Paragraph** — highlight only the current paragraph
- **Focus Mode: Disable** — turn focus mode off

The dim strength is configurable.

- **Focus: new note in its own window** — a blank note in a new window, in front of everything

That last command makes a new empty note where Obsidian's _Default location for new notes_ says, named the way Obsidian names one (**Untitled**, then **Untitled 1**, and so on; **Unbenannt** in German), opens it in a new window, brings that window to the front whatever windows and tabs are already open, and puts the cursor in the editor. A pop-out window has no sidebars, so the screen holds the note and nothing else. On a phone, which has no windows, the note opens in a new tab and both drawers close instead. Nothing about the vault differs from a note made the usual way.

### Rename file from content

Assigns a filename to the active note or image based on its content:

- **Rename file from content** — the note's text is sent to an LLM and the file is renamed with the result.
- **Rename image from content** — the image (jpg, png, gif, webp; up to 10 MB) is resized and sent to a vision model, and the file is renamed.

The rename does nothing if the note is shorter than the configured minimum length, or if no API key has been set.

The same thing is on the explorer's context menu, as one entry that follows the file: **Rename from the text…** on a note, **Rename from the picture…** on an image, and nothing at all on a file neither path can read. From the menu the proposed name is not applied outright — it opens the pane's rename dialog with the suggestion in the field, where it can be read, corrected or cancelled, because a menu acts on a row in a tree rather than on the note in front of you.

### Summarize selection

Select any text and run **Summarize selection** to send it to an LLM and replace the selection with the result. Built for turning raw text pasted from analytics and reporting tools into a running insight log: copy the numbers into a note, select them, summarize, and keep the distilled takeaway in place of the raw dump.

The summarize prompt is fully configurable in settings — a default tuned for the insight-log workflow is provided. The command uses the shared **AI models** configuration (provider, model, and API key).

### Email (IMAP/SMTP)

Send notes as email and pull messages back into your vault — on desktop **and** mobile.

- **Send note as email** — recipients and subject come from the note's frontmatter; the body is the note with its frontmatter stripped. A confirmation dialog shows what is about to be sent.
- **Query mailbox** — search by sender, subject, full text or date, then insert the chosen message into the active note.
- **Fetch replies into note** — find replies to a note you sent and append the new ones. Re-running the command only ever adds what is new.

The note's frontmatter is the contract:

```yaml
---
schreibstubeTo: kunde@example.com
schreibstubeCc: [innendienst@example.com]
schreibstubeSubject: Angebot Objekt 4711
schreibstubeMessageId: <7f3a…@your-domain.de> # written on send
schreibstubeSentAt: 2026-09-07T10:12:00.000Z # written on send
schreibstubeMergedIds: ["<reply-1@mail.kunde.de>"] # written on merge; keeps merging idempotent
---
```

`schreibstubeMessageId` is what ties replies back to the note, so **Fetch replies** only works on notes that were sent from Obsidian.

#### The bridge

Obsidian on mobile runs in a WebView with no Node runtime and no raw sockets, so the plugin cannot speak IMAP or SMTP itself. Instead it talks HTTPS to a small self-hosted bridge that does — see [`bridge/README.md`](bridge/README.md) for the API, configuration, and Sliplane deployment steps.

Two consequences worth knowing:

- The plugin needs **no Node dependencies** and stays available on mobile.
- Your **mailbox password lives on the bridge**, not in the vault. The plugin only stores a bridge token, which you can rotate without touching the mailbox.

### Publishing

Publishes a vault folder as a static website over SFTP, from desktop and from mobile.

- **Veröffentlichen** — collect the folder, show what will change, upload and publish
- **Veröffentlichung prüfen** — the same, stopping at the plan
- **Website öffnen** — open the published site

Publishing is opt-in per note. A note is published when its frontmatter says so, and taking the flag away removes the page on the next publish:

```yaml
---
published: true
title: Hallo Welt # default: the first heading, else the filename
date: 2026-09-12 # default: the file's creation date
description: Kurzfassung # optional; page head and index entry
slug: hallo-welt # default: from the filename
publishedAt: … # written back after publishing
publishedUrl: … # written back after publishing
---
```

**The key names are settings.** The defaults are the plain names most vaults already use. If yours calls these fields something else, or another plugin has claimed one of the names, map each role to the key you use under **Frontmatter-Felder** in the publish settings. A configured key replaces the default rather than adding to it, so notes still carrying the old name stop being recognised.

```yaml
---
veroeffentlicht: true
titel: Hallo Welt
datum: 2026-09-12
---
```

The site is one page per note plus an index sorted by date, newest first. Wikilinks between published notes become site links; a link to an unpublished note degrades to plain text rather than a dead link. Embedded images and video are uploaded under a content-addressed name, so a changed picture can never be served from a cache. Callouts, footnotes, tables, task lists, maths and Mermaid diagrams all render. A `theme.css` in the publish folder replaces the built-in stylesheet.

What the bridge does and the plugin does not: rendering the Markdown, holding the SFTP credentials, and deciding what may be deleted. Only files the bridge itself wrote are ever removed, and the hosting key never enters the vault. See [`bridge/README.md`](bridge/README.md).

### Printing

Turns the note you are looking at into a PDF, through a template you keep in the vault. It works on every platform Obsidian runs on — Windows, macOS, Linux, iOS, Android — offline, with no bridge and no account: Typst is compiled to WebAssembly and typesets on the device. A letter written on a train becomes a PDF on that train.

- **Drucken: diese Notiz als PDF** — print the active note
- **Drucken: Vorlage anlegen** — write an example template into a folder you choose

#### Switching it on

Printing is off until you turn it on, under **Einstellungen → Drucken**. That switch is what fetches the typesetter, which is 28 MB, so nothing is downloaded for a feature you have not asked for. Running the print command while it is off explains this and offers to turn it on.

Once on, the settings show whether the typesetter is on this device, with a button to fetch it now or to remove it again. Fetching it in advance means your first print is not also a download. It comes from this plugin's own GitHub release and is checked against a hash committed in the source, on download and on every later start; a mismatch is refused and reported rather than repaired quietly. After that, printing never touches the network.

#### Getting a template

Run **Drucken: Vorlage anlegen**. It asks which of the two examples you want and which folder to put it in — any folder in the vault, not only the templates folder — then writes it and opens its `template.md`. You do not need to leave the app, which on a phone you could not do anyway.

The same two templates are in [`examples/print/`](examples/print/) if you would rather copy them by hand.

A template is found wherever you keep it. What makes a folder a template is the flag in its `template.md`, not its location, so the templates folder setting only says where a new one is suggested — a template beside the notes that use it works exactly the same.

#### What a template is

A folder. That is the whole of it:

```
Vorlagen/Druck/Brief/
  template.md     the descriptor: what it needs, and how to use it
  template.typ    the layout: one function, body in, page out
  fonts/*.ttf     embedded and subset into the PDF; .otf works too
  logo.png        optional; anything the layout wants to place
```

The folder's name is the template's name, and a note asks for it by that name. Neither example carries a typeface, because fonts are licensed and a repository is no place to redistribute one. A template with no font still prints: Typst sets it in its own.

#### Writing one

`template.md` is frontmatter and prose. The frontmatter says what the template is; the prose is for whoever opens the folder in six months.

```yaml
---
schreibstubePrintTemplate: true
schreibstubeEntry: letter
schreibstubePage: { size: a4, margin: "25mm" }
schreibstubeHrIsPageBreak: true
schreibstubeData:
  senderName: Vorname Nachname
  senderAddress: "Musterstraße 1\n12345 Musterstadt"
---
```

`schreibstubeEntry` names the function in `template.typ` that lays out the page. It takes the converted note as content and the resolved data as a dictionary, and returns the page:

```typst
#let letter(body, data) = {
  set page(paper: "a4", margin: 25mm)
  set text(font: "Fira Sans", size: 11pt, lang: "de")

  align(right)[#data.senderName \ #data.senderAddress]
  v(2cm)
  data.recipient
  align(right, data.date)
  v(1cm)
  text(weight: 700, data.subject)
  v(0.5cm)

  body
}
```

Everything Typst can do is available. What a layout may not do is reach outside its own folder or import a package, because printing happens on the device with no network — both are refused before anything compiles, along with a layout over 256 KB.

The converted note does not call Typst's own primitives for the four things a template should own. It calls these, and a template that wants a different look defines its own before the body is placed:

| Helper                                 | Given                                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| `schreibstube-image(path, alt)`        | one embedded picture                                          |
| `schreibstube-diagram(paths, caption)` | an **array** of pictures from one fence, and one caption      |
| `schreibstube-code(source, language)`  | a fence that is not a diagram, or one that could not be drawn |
| `schreibstube-callout(kind, title)`    | an Obsidian callout; returns `body => …`                      |

#### Where the words come from

Everything that is not prose — a sender, a recipient, a subject, a date — is frontmatter. For each key the template reads, the first of these wins:

1. The note's `schreibstubePrint:`, so a letter says its own recipient.
2. The template's `schreibstubeData:`, so a sender is typed once.
3. Built-ins: `date` is today in the note's language, `title` the note's title, `noteName` its file name.

```markdown
---
schreibstubePrintTemplate: Brief
schreibstubePrint:
  recipient: "Frau Handan Ekinci\nHintere Marktstraße 83\n90441 Nürnberg"
  subject: Kündigung Tanzkurs
---

Sehr geehrte Damen und Herren,
```

Without `schreibstubePrintTemplate` the command asks which template to use.

#### What carries over from the note

Headings, paragraphs, emphasis, strong, strikethrough, highlight, nested lists, links, wikilinks, images and embeds, tables with their alignment, inline and fenced code, blockquotes, callouts, footnotes, `<br>`, and horizontal rules as an optional page break.

Dropped with a warning rather than in silence: raw HTML, embedded notes, and a picture that cannot be read. LaTeX math is not converted yet and is reported like the rest.

#### Diagrams

Mermaid diagrams and other plugins' canvases cannot run inside a typesetter, so each fence is drawn off-screen under the light theme and captured as a picture. Paper is white whatever your vault is set to.

A plugin that offers its own export is asked to do the drawing rather than guessed at from outside, and asked for every canvas in the fence rather than the first, so a carousel prints all its panels instead of the one that happened to be visible. It is also told the drawing is for paper, which asks it not to go to the network: a print stays offline however it is made.

A diagram that cannot be drawn prints as its own source with a warning. One that drew several panels and captured only some keeps what it got and says how many are missing. A page that quietly lost a panel lies about what the note says, which is the one thing printing must not do.

#### Where the PDF goes

Beside the note, with the note's name, overwritten on reprint, then revealed in the file pane. A setting redirects output to a fixed folder for vaults that keep exports apart.

[`PRINTING.md`](PRINTING.md) is the whole contract, including the limits every job is held to and why the feature is shaped this way.

### Schreibstube Explorer

A file list of Schreibstube's own, opened from the ribbon icon in the left margin or with **Open Schreibstube Explorer**. It exists because three things cannot be done to Obsidian's explorer from a plugin without fighting it: an icon per item, a mark for sync state, and an order you can lift a file to the top of.

The pane has four sections, each one collapsible, each remembering whether it was open on that device: **Pinned**, **Bookmarks**, **Latest**, and **Files and folders**. Pinned is drawn only when something is pinned and opens closed. Closed, it keeps three rows on the sticky strip and its icon carries the number of pins there are, the badge a closed folder carries; open, the strip holds as many as fit in half the pane and the rest continue in the scrolling list. A filter opens it for as long as it is set.

- **Icons.** Right-click, or long-press on a phone, and pick from 172 icons grouped by what they are for — documents, folders, property, business, status. The set is a subsetted [Tabler](https://tabler.io/icons) webfont carried inside the bundle, so it works offline and on mobile, with no request to a CDN.
- **Latest.** Three lists, each as long as the count in the settings: the notes whose source last changed, then the most recently created, then the most recently changed. Each note appears in only one of them, the first that claims it, so the section never says the same thing three times. The first list carries the sync mark, so it doubles as what is waiting to be looked at.
- **Properties on a mirrored note.** A check keeps two of the note's own properties: `title`, taken from the document's first heading and written only once — a title already in the file is yours and is never overwritten — and `updatedAt`, stamped whenever the source has actually changed, not merely been checked. Properties only: a check never writes the body, which still waits in the review panel.
- **Sync marks.** A note bound to a source shows what its mirror is doing: in sync, changes waiting from the poll, never checked, or a source that cannot be fetched. Shape carries the state and colour only reinforces it. Nothing is shown while document sync is off.
- **Keeping a file at the top of its folder.** Some files in a folder matter more than the rest, and **Keep at top of folder** holds them above their siblings, in the order they were marked, folders included. Everything below keeps Obsidian's own arrangement: folders first, then files, numeric-aware so `Objekt 2` precedes `Objekt 10`. The row carries a pin glyph, which is what explains why it is where it is.
- **Pinning.** Everything pinned appears in a **Pinned** section at the top of the pane, in the order it was pinned, wherever in the vault it lives, and the block can be dragged into any order. A pinned note is drawn by the `title` in its own frontmatter when it has one, because a pinned row is a shortlist entry to be recognised rather than a path to be read — the file itself is untouched, and its path is still on the row's tooltip. The tree below keeps filenames, which is where a file is looked for by name. Pinning is a separate mark from the one above: "wherever I am, I want this row" is a different wish from "inside this folder, this one first", and answering one no longer answers the other. A file can carry both, either, or neither.

- **How much a closed folder holds.** A small figure on the folder's icon, counting every file underneath it and its subfolders, drawn only while the folder is shut — open, the answer is on screen. Empty folders carry nothing, and past ninety-nine it says `99+`.
- **Moving.** A row is dragged onto a folder to move into it — onto the folder itself or onto any row inside it, since the whole block a folder occupies is its target — and onto the "Files and folders" header to move out to the vault root. A finger drags as a mouse does: the press that opens the context menu at half a second also arms the drag, so holding still and letting go gives the menu, while holding and then moving gives the drag, and the menu steps aside as soon as the row starts moving. The list scrolls while a drag rests near its top or bottom edge, so a folder off screen can still be reached. **Move to…** on the menu does the same thing from a list of folders, for when the target is nowhere near. Whether a move is allowed is decided away from the pointer: a folder cannot go into itself or its own subtree, a name already taken is refused rather than overwritten, and a refusal says which it was. The move goes through Obsidian's own rename, so links follow.
- **The menu.** A row carries no buttons. Right-click it, or long-press on a phone, and the menu opens with everything a row can be told to do. Deleting is on that menu and never happens on the spot: it opens a confirmation, and what it confirms is a move to the vault's trash.
- **Task counts.** With **Task counts** switched on in the settings, a note that holds tasks shows `1 / 7` after its name, open over total, at the row's right edge; a note without tasks shows nothing. The figure comes from Obsidian's own metadata, so a large vault costs no extra reads, and a box with a space in it is open while any other marker counts as done, the same rule the task ribbon uses.

A footer along the bottom names the vault and holds the two ways out of a pane that is not behaving: help, and the plugin's settings.

The context menu is the pane's own, in a fixed order: open, icon and the two marks, sync, create, move, rename, rename from content and delete. Items other plugins contribute land behind one **More actions** entry at the end rather than in blocks between the actions — the pane fires Obsidian's `file-menu` event, so a plugin that adds to the file explorer's menu adds to this one without knowing the pane exists.

The sync actions are why the menu is worth owning:

| On a note             | Does                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| Bind to a source      | Validates the URL and writes `schreibstubeSyncedFrom` into the note's frontmatter |
| Check source now      | Fetches that one note, whether or not it is open, ignoring the minimum interval   |
| Open source           | Opens the raw Markdown the note mirrors                                           |
| Remove source binding | Drops the frontmatter key and the stored baseline                                 |

On a folder, **Copy path for Schreibstube** puts its `vault://` URL on the clipboard, which is how a folder bookmark is written without typing a path out by hand.

On a folder, **Check every bound note here** refreshes the mirrors under it, which is the difference between refreshing one project and polling a vault of a thousand notes.

#### Bookmarks

A list of links the tree cannot hold: a web page, an Obsidian URI, a vault folder, a note. Obsidian's own bookmarks cover the last two and have no room for the first two, which is the reason this section exists.

They are read from a Markdown file in the vault, `bookmarks.md` unless a setting says otherwise. The pane never writes it. Links are added by editing the file, which is also what makes the list survivable: it can be read, fixed, versioned and merged like any other note, and two devices editing it conflict the way two devices editing a note conflict, rather than through a mechanism of its own.

```markdown
# Work

- [Linear](https://linear.app/team)
- [Objekte](vault://Immobilien/Objekte)

## Design

- [[Design Brief]]
```

| Line            | Meaning                                          |
| --------------- | ------------------------------------------------ |
| `# Heading`     | A folder                                         |
| `## Heading`    | A subfolder, one level only                      |
| `- [Name](url)` | A bookmark                                       |
| `- [[Note]]`    | A bookmark to a note, with an optional `\|label` |
| Anything else   | Ignored                                          |

| Scheme                | Opens                                              |
| --------------------- | -------------------------------------------------- |
| `https://`, `http://` | The page in the default browser                    |
| `obsidian://`         | The Obsidian URI                                   |
| `vault://path`        | Reveals that folder in this pane, ancestors opened |
| `note://linkpath`     | The note                                           |

Anything else is dropped while the file is read, so a `javascript:` line pasted into a synced file never becomes a row that can be tapped.

Right-click a folder anywhere in Obsidian and choose **Copy path for Schreibstube** to get its `vault://` URL, ready to paste into the file. **Open bookmark** searches the list by name, folder or URL from the command palette, offering what was opened most recently on that device first.

#### Latest

Two short lists: the notes created most recently, and those changed most recently. A note shown as created is not repeated as changed, because in a young vault the two lists are otherwise the same list twice. Only Markdown counts, so an attachment written by a paste never takes the top row. The bookmarks file is always excluded, and further paths can be.

Icons and the two marks live in `explorer.json` inside the plugin folder, deliberately not in `data.json`: that file is rewritten whole on every save, so a second device would clobber it. Each entry carries its own timestamp and every write re-reads and merges per entry, so two devices editing different files both keep their change. The pane also watches the file for writes delivered by iCloud, Obsidian Sync or Git while it is open. A file that moves keeps its icon; one that disappears keeps it for thirty days, in case it turns up somewhere else under the same name.

### Link open modes

Control where internal links open, indicated in the status bar:

- **Open links to the left** / **Open links to the right** — open links in a reused side split pane
- **Open links normally** — restore default link behaviour

### Task summary

Turns a long note with checkboxes into a progress view without any extra state in the tasks themselves.

- **Tasks: insert the summary ribbon** — inserts a ` ```schreibstube-tasks ` block at the cursor. The block renders as a one-line ribbon, e.g. **20** open of **21**, counting every task in the note.
- While the note contains the ribbon block, every heading that owns tasks shows a muted badge such as `3 of 3 open`. A heading counts only the tasks directly beneath it, up to the next heading of any level; tasks under a sub-heading belong to that sub-heading.
- Ribbon and badges update as soon as a checkbox is toggled. Badges stay visible when a heading is folded.
- `[ ]` is open; any other marker (`[x]`, `[-]`, `[~]`, …) counts as done. Tasks inside fenced code blocks are ignored.

The badges appear in Live Preview and Source mode. The ribbon also renders in Reading view.

A task can carry more than its first line: a paragraph typed with Shift+Enter, a note under it, sub-items — anything indented deeper than the task's own marker. While the task is open that text stays in view. Tick the task and it folds away, leaving the first line; untick it and it comes back. In the editor this is an ordinary fold, so the fold indicator opens a done task by hand and it stays open until its state changes again. Tasks that are already done when a note opens are folded from the start. In Reading view there is no folding, so the body is hidden instead. This works in every note, with or without the ribbon.

#### Sending a task to Erinnerungen

On macOS and iOS a task can be handed to Apple's Reminders. Put the cursor on the task and run **Tasks: send to Erinnerungen**, or right-click the line (long-press on a phone) and choose **Send to Erinnerungen**. The task's line becomes the reminder's title, tags included, and the text indented under it becomes the note. The command is offered only when the cursor is on a task; switch the feature on under **Settings → Schreibstube → Erinnerungen** first.

Obsidian cannot talk to Reminders directly, so the work is done by a Shortcut you build once in the Shortcuts app, named as in the settings (**Schreibstube Reminder** by default):

1. Create a shortcut that accepts **Text** as input.
2. Add **Get Dictionary from Input**.
3. Add **Add New Reminder** with Title from the dictionary's `title`, Notes from `notes`, and the list from `list`. If the list field will not take a variable, choose the list inside the Shortcut instead.

The plugin sends one JSON object: `title`, `notes`, `list`, `link` and `note` (the note's title). `notes` already holds the body, a line `↩ Note title`, and the link, so the simplest Shortcut needs only `title` and `notes`.

The link is `obsidian://schreibstube?task=<id>`. The command writes the same link onto the task line, as a Markdown link at its end:

```markdown
- [ ] Bank anrufen #geld [⏰](obsidian://schreibstube?task=ab12cd)
```

In Obsidian that link shows as a small Reminders-style mark after the task, in Live Preview and in Reading view; put the cursor on the line and the source is there as usual. Anywhere else the clock stands in. Following the link from the reminder opens the vault, the note and the task's line, however the note has been renamed or moved since, because the plugin looks for the line that carries the same link. Delete the link from the line and the reminder can no longer find its way back.

What does not carry over: Reminders' own tags. There is no way to set one from outside, so `#tag` stays as text in the title, visible and searchable but not coloured. Editing a reminder after it is created is not part of this.

#### Done in Erinnerungen, ticked in the note

A reminder completed on the phone can tick its task in the note. The plugin cannot ask Reminders, so a second Shortcut does, named as in the settings (**Schreibstube Reminder Status** by default):

1. Create a shortcut that accepts **Text** as input.
2. Add **Find Reminders** with _Is Completed_ true, the list you use, and _Notes contains_ `schreibstube?task=`.
3. Add **Get Details of Reminders** for the **Notes**, then **Combine Text** with new lines, and end with that text as the output.

Two commands run it. **Tasks: check this note against Erinnerungen** asks about the sent tasks of the open note and is offered only when the note has one. **Tasks: fetch done tasks from Erinnerungen** asks about every completed reminder in the list. Both open the Shortcut through `x-callback-url`; Shortcuts hands its output back to the plugin, which ticks every open task the output names, in whichever note it lives. A task already done, whatever its marker, is left alone.

Without running anything: add **Save File** to the same shortcut, overwriting the **Report file** from the settings (`schreibstube-reminders.txt` in the vault root by default), and run the shortcut from an automation, on iOS for example every hour. The plugin looks at the file every twenty seconds, reads it when it has changed, and ticks the tasks it names. macOS Shortcuts has no time-based automations, but a file written by the phone reaches the Mac through the vault's own sync, and the two commands work everywhere.

The Shortcut's output can be any text that contains the reminders' links; the plugin picks the ids out of it and ignores the rest.

### Commands

Every command is prefixed with the part of the plugin it belongs to — `Fokus:`, `KI:`, `Explorer:`, `Korrektur:`, `Sync:`, `Mail:`, `Veröffentlichen:`, `Links:` — so typing the area into the palette narrows two dozen entries to three. Each settings section also lists the commands its feature brings, so switching something on and learning what to type is one page rather than two.

A command that cannot do anything where you are is not offered at all: the image rename without a picture open, `Sync: Quelle dieser Notiz prüfen` on a note bound to nothing, `KI: Auswahl zusammenfassen` with nothing selected, `Explorer: alle Ordner zuklappen` with the pane closed. Only conditions visible on screen hide anything — a command that needs a setting filled in stays listed and says so when it is run, because a command missing for a reason three tabs away reads as a plugin that broke.

## Settings

### Heading stack

| Setting                      | Description                                 | Default |
| ---------------------------- | ------------------------------------------- | ------- |
| Enable heading stack overlay | Show or hide the sticky ancestor breadcrumb | On      |

### Focus mode

| Setting     | Description                                                 | Default |
| ----------- | ----------------------------------------------------------- | ------- |
| Dim opacity | Opacity of out-of-focus lines (0.2 faint – 0.8 nearly full) | 0.4     |

### Schreibstube Explorer

| Setting                  | Description                                                                   | Default             |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------- |
| Items from other plugins | Where contributed menu items go: behind "More actions", inline, or not at all | Behind More actions |
| Bookmarks section        | Show the bookmarks list above the file tree                                   | On                  |
| Bookmarks file           | Vault path of the Markdown file the bookmarks are read from                   | `bookmarks.md`      |
| Latest section           | Show the recently created and recently changed notes                          | On                  |
| Notes per list           | How many notes each of the two lists shows                                    | 5                   |
| Never show these         | Vault paths kept out of both lists, by comma or line break                    | empty               |
| Icon set                 | Which icon set is bundled, and how many icons it holds                        | Tabler Icons (MIT)  |

### AI models

Provider, model, and API key are shared by every AI command (rename and summarize).

| Setting         | Description                                     | Default          |
| --------------- | ----------------------------------------------- | ---------------- |
| LLM provider    | Anthropic or OpenAI                             | Anthropic        |
| Model           | Model for the selected provider                 | Claude Haiku 4.5 |
| Custom model ID | Optional override for a newer or unlisted model | —                |
| API key         | Stored in Obsidian's native secret storage      | —                |

API keys are stored in Obsidian's built-in secret storage and are never written to the plugin data file.

### Rename file from content

| Setting                     | Description                                    | Default     |
| --------------------------- | ---------------------------------------------- | ----------- |
| Max image size              | Maximum image dimension (px) sent to the model | 768         |
| Minimum content length      | Notes shorter than this are skipped            | 50 chars    |
| Maximum content sent to LLM | Characters from the note sent to the API       | 4 000 chars |
| Maximum filename length     | Generated name is truncated to this            | 60 chars    |

### Summarize selection

| Setting                 | Description                                         | Default            |
| ----------------------- | --------------------------------------------------- | ------------------ |
| Summarize prompt        | System instruction telling the LLM how to summarize | Insight-log preset |
| Maximum response tokens | Upper bound on summary length (64–4096)             | 512                |

### Proofreading

| Setting                 | Description                                | Default                       |
| ----------------------- | ------------------------------------------ | ----------------------------- |
| Proofread prompt        | System instruction for the correction pass | Correction-only German preset |
| Maximum response tokens | Upper bound per request (256–8192)         | 2 048                         |
| Characters per request  | Prose sent per chunk (500–6000)            | 2 000                         |
| Parallel requests       | Chunks in flight at once (1–4)             | 2                             |

### Glossary

| Setting                               | Description                                     | Default |
| ------------------------------------- | ----------------------------------------------- | ------- |
| Default glossaries                    | Vault paths, one per line                       | —       |
| Folder rules                          | One per line: `folder \| glossary.md, other.md` | —       |
| Underline glossary hits in the editor | Marks error-severity terms while writing        | Off     |

### Document sync

| Setting                                  | Description                                                          | Default     |
| ---------------------------------------- | -------------------------------------------------------------------- | ----------- |
| Enable document sync                     | Bound notes are ignored entirely until this is on                    | Off         |
| Check when a bound note opens            | Also check automatically on open                                     | On          |
| Minimum minutes between automatic checks | Per note. Zero checks on every open; a manual check always runs      | 10          |
| GitHub token                             | Optional. Needed for private repositories, and raises the rate limit | —           |
| Poll all bound notes in the background   | Check every bound note on a schedule                                 | Off         |
| Schedule                                 | Five-field cron expression, local time                               | `0 * * * *` |

### Email

Requires a deployed bridge — see [`bridge/README.md`](bridge/README.md).

| Setting         | Description                                                        | Default        |
| --------------- | ------------------------------------------------------------------ | -------------- |
| Bridge URL      | Base URL of your bridge. Must be `https://` unless it is localhost | —              |
| Bridge token    | The bridge's `MAIL_TOKEN`, stored in Obsidian's secret storage     | —              |
| From address    | Optional override for the bridge's `MAIL_FROM`                     | —              |
| Mailbox         | IMAP mailbox searched by the query and reply commands              | INBOX          |
| Maximum results | How many messages a search returns (newest kept)                   | 25             |
| Merge heading   | Heading that fetched replies are appended under                    | Correspondence |

### Publishing

Requires a bridge with the publish capability configured — see [`bridge/README.md`](bridge/README.md).

| Setting            | Description                                                                                           | Default         |
| ------------------ | ----------------------------------------------------------------------------------------------------- | --------------- |
| Bridge URL         | Leave empty to use the mail bridge's URL                                                              | —               |
| Publish token      | The bridge's `PUBLISH_TOKEN`, stored in Obsidian's secret storage                                     | —               |
| Accounts           | Site name, vault folder, and the name of a target the bridge knows                                    | —               |
| Write-back         | Record the publish time and URL in each note's frontmatter                                            | On              |
| Frontmatter fields | Which key carries which meaning — published, title, date, description, slug, and the two written back | the plain names |

The token is deliberately separate from the mail token, so a leaked publish token cannot reach the mailbox. **Verbindung testen** proves the token, the target, the SSH login, the host key and the web root in one request, without writing anything.

### Printing

| Setting          | What it does                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Enable printing  | Off until you switch it on. Switching it on is what fetches the 28 MB typesetter.          |
| Templates folder | Where a new template is suggested. Templates are found anywhere. Default `Vorlagen/Druck`. |
| Output folder    | Where a PDF is written. Empty means beside the note it came from.                          |
| The typesetter   | Whether it is on this device, with a button to fetch or remove it.                         |

Only the switch shows while printing is off: there is nothing to configure for a feature with no typesetter on the device and no print to aim anywhere.

Everything else about a printed page — paper, margins, fonts, the sender's name — belongs to the template, which is a folder you can open. A setting for any of it here would be a second place to look.

### Diagnostics

| Setting       | Description                                                                  | Default |
| ------------- | ---------------------------------------------------------------------------- | ------- |
| Debug logging | Log detailed diagnostics to the developer console (errors are always logged) | Off     |

## Documentation

| Document                               | What is in it                                                     |
| -------------------------------------- | ----------------------------------------------------------------- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)   | What runs in the vault, what runs on the bridge, and what crosses |
| [`PUBLISHING.md`](PUBLISHING.md)       | Why publishing is shaped this way                                 |
| [`PRINTING.md`](PRINTING.md)           | Printing a note to PDF through a Typst template: the plan         |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)   | Setup, the checks, the mobile checklist, releasing                |
| [`bridge/README.md`](bridge/README.md) | The bridge's API, configuration and deployment                    |
| [`SECURITY.md`](SECURITY.md)           | What holds a secret, the perimeter, how to report                 |
| [`QUALITY.md`](QUALITY.md)             | The codebase graded by attribute, and what the guards protect     |
| [`CLAUDE.md`](CLAUDE.md)               | The three principles every change is measured against             |
| [`examples/blog/`](examples/blog/)     | A publish folder to copy into a vault                             |

## Installation

Copy `main.js`, `manifest.json`, and `styles.css` into your vault plugin folder:

```
<Vault>/.obsidian/plugins/schreibstube/
```

## Development

```bash
npm install       # install dependencies
npm run build     # production build
npm run dev       # watch mode
npm test          # run tests
```

The icon font is generated, not hand-edited. Add a name to `scripts/icon-set.mjs` and run:

```bash
npm install --no-save @tabler/icons-webfont
pip install fonttools brotli
npm run build:icons
```

That subsets the font to the names in the list and writes `src/ui/icon-font.generated.ts`, which is committed — a normal build needs neither the font package nor Python. Icons are stored by name, never by codepoint, so a font upgrade that moves a glyph changes the generated map instead of every vault's icons.

Tabler Icons is MIT licensed; see `LICENSE` in `@tabler/icons-webfont` for the notice.
