# <img src="assets/logo.svg" alt="" width="28"> Schreibstube

A writing-focused Obsidian plugin: a proof-read review sidebar with glossary support, document sync from remote Markdown sources, email send/query/merge over IMAP and SMTP, a sticky heading-stack overlay, a distraction-reducing focus mode, property icons and one-click dates in the Properties view, a task summary ribbon with per-heading counts, LLM-powered file renaming, text-to-table conversion, image slideshows in six layouts, a Recommended panel of notes, pictures and conversations, and side-pane link opening.

## Features

### Proof-read sidebar

Opens a side pane that reviews the active note and proposes changes one at a time. Nothing is written to the note until you accept a change.

- **Open review sidebar** — show the panel
- **Proof-read note** — send the note for correction and fill the queue; the glossary is checked first, locally

The panel's **Check glossary** button runs the local glossary check on its own, without an API call.

Each card shows the change as a word-level diff, with **Übernehmen** and **Stelle zeigen**, which selects the place in the note the card is about and marks it for a moment — a tint over the passage and a bar beside its lines, or a mark at the point where an insertion goes; a proofreading card also has **Verwerfen**. A card that brings an update from a source has no Verwerfen: the choice there is to take the update or to leave the note as it is, and leaving it needs no button. **Alle übernehmen** applies the whole queue as a single undo step.

What the correction pass will not touch: frontmatter, fenced code blocks, tables, and math blocks are excluded entirely. Inline code, wikilinks, link targets, tags, and bare URLs are masked before the text is sent and restored afterwards; if a response comes back having lost one of them, that section is discarded rather than applied.

If you edit the note while the queue is open, cards whose text can no longer be located are marked _veraltet_ instead of being applied to the wrong words.

A correction that brings in code another plugin runs — a `dataviewjs` block, Dataview's inline `$=` JavaScript, a Templater `<% %>` command, a JS Engine, Datacore, Meta Bind or Buttons block — carries a **runs code** badge and is left out of **Alle übernehmen**, like such an update from a source. A model reads the whole note, and a note can quote somebody else's instructions; what it proposes that would run is read before it is accepted. If a paragraph's rewrite brought such code anywhere, every card from that paragraph is held back.

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

#### A term folder (Pythia's glossary)

Set **Term folder** in the settings to a folder of one note per term, such as the glossary folder [Pythia](https://github.com/smsag/pythia) writes, and set the same folder in both plugins. Pythia fills it while you discuss a topic; Schreibstube reads it. Setting the folder is the whole configuration: it joins the vault-wide default.

Each note in the folder is a concept whose preferred term is the note's term (its `term` property, or the file name). People and themes (`type: person`, `type: theme`) are left out. A note says nothing about which words to avoid, and nothing is flagged until you say so: the words listed under `schreibstubeAvoid` on a term note are flagged as deprecated, with the term offered instead.

```markdown
---
type: term
source: model
language: de
schreibstubeAvoid:
  - cartel law
  - Wettbewerbsrecht
---

Das Recht gegen Absprachen und Marktmacht, die den Wettbewerb beschränken.
```

The list is managed in the proofreading panel's **Terms** section: select the word in the note, press **Add rule**, pick the term. The dialog offers the term's recorded translations (Pythia's `term_en`, `term_it`, …) as words to avoid; a tap fills the field, and the word is added only when you press **Add**. A chip removes a word again, and the term's name opens its note. The panel writes `schreibstubeAvoid` and nothing else on the note.

- The note's `language` decides which inflection endings an avoided word tolerates; without one, German.
- The first paragraph of the body is shown on the card and handed to the correction pass, so the model knows which sense is meant. A definition Pythia's model wrote is marked as such.
- The term itself is never flagged, not even its capitalisation: a folder of model-written terms would otherwise flag every one at the start of a sentence.

**Table or term folder?** They are two ways to write the same kind of rule, for two ways of working. A glossary table is the house style guide: written in one go, edited as a whole, pasted from a termbase export, and able to say everything TBX-Basic can (admitted and superseded terms, match modes, a severity). The term folder is what you learn along the way: one term at a time, with its meaning beside it, and only one kind of rule — avoid this word, use the term. Put a rule where its term is defined. When both define the same word for a note, the panel says so under the glossary line, because both apply and the one loaded first would decide without telling you.

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

- **Update note** — fetch now and queue any differences

With **Check when a bound note opens** on, a bound note is also checked as you open it, no more often than the configured interval. Checks use a conditional request, so an unchanged source costs one small round trip and no download.

**Private repositories.** Set a GitHub token under **Document sync** and sources in a private repository are fetched normally, through GitHub's contents API rather than the raw host, which ignores tokens. The token is stored in Obsidian's secret storage and is only ever sent to GitHub, never to another host, whatever URL a note carries. It also raises GitHub's rate limit, which matters once you poll several notes. Without a token a private source reports as not found, and the message says a token is needed rather than claiming the file is gone. A fine-grained token is granted repositories one by one: one that was not granted the source's repository is answered by GitHub exactly like no token at all, and the message says so. Both the page link and the link behind GitHub's Raw button work, the `refs/heads/…` form included.

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

- **Update all notes** — run the poll now, regardless of schedule

Two things are deliberately protected. The note's own frontmatter is never part of the diff, so accepting a card cannot touch the binding. The remote file's own frontmatter is stripped before comparison, which is what stops the first sync from overwriting the binding and orphaning the note.

The plugin remembers a hash of the note body as of the last sync. If the note still matches it, everything that differs from the source is genuinely incoming. If you edited a bound note, the panel says so and the cards are marked, because accepting them restores the source and discards your edit. That is what a mirror means here.

If the source is deleted or moved, the panel reports it and the note is left exactly as it is. It is never emptied.

**What to know before binding a note.** A source is somebody else's text, and a binding is a standing request to their server.

- A mirrored note shows what the source writes, images included. A remote image is fetched from its host each time the note is shown, which tells whoever runs that host when the note was opened, and from where. An update that brings in code another plugin runs carries a **runs code** badge and is left out of **Alle übernehmen**, so it is read before it is accepted; a picture is not held back, because it is ordinary Markdown.
- The binding is a frontmatter key, and any note that reaches the vault can carry one: a note synced from another device, imported, or pasted in. With sync and the background poll on, the plugin then requests that URL on the schedule, so the URL's owner sees the requests. Nothing is written into the note without your accepting it.
- Obsidian's request API follows redirects. The checks that a source is HTTPS and ends in a Markdown extension apply to the URL the note names, not to wherever its server redirects the request. The GitHub token is attached only to requests the plugin addresses to `api.github.com`, whatever the note names.

### Heading stack overlay

Keeps a sticky, context-aware heading breadcrumb at the top of the active note as you scroll. Shows the ancestor headings above the current viewport position, so you always see where you are in the document's hierarchy. Click an ancestor to jump to that heading. The overlay can be turned off entirely in settings.

### Focus mode

Dims everything except the passage you are working on. Available as two commands, each of which turns focus mode off again when its mode is already on:

- **Focus: sentence** — highlight only the current sentence
- **Focus: paragraph** — highlight only the current paragraph

The dim strength is configurable.

- **Switch reading/editing** — from Live Preview to Reading view and back

Obsidian's own _Toggle reading view_ goes back to whichever editor was last in use, Source mode as often as Live Preview. This one has two ends only: from Live Preview it goes to Reading view, and from Reading view or Source mode it goes to Live Preview. The passage on screen stays on screen, and in the editor the cursor stays where it was. It has no key of its own; give it one, or put it on the phone's toolbar, in Obsidian's settings.

- **New note** — a blank note in a new window, in front of everything

That last command makes a new empty note where Obsidian's _Default location for new notes_ says, named the way Obsidian names one (**Untitled**, then **Untitled 1**, and so on; **Unbenannt** in German), opens it in a new window, brings that window to the front whatever windows and tabs are already open, and puts the cursor in the editor. A pop-out window has no sidebars, so the screen holds the note and nothing else. On a phone, which has no windows, the note opens in a new tab and both drawers close instead. Nothing about the vault differs from a note made the usual way.

While that window fills the screen, full screen or maximised, the note's lines are two thirds of the window wide, with Obsidian's _Readable line length_ on or off; make the window smaller and the usual width returns. Like the Recommended footer, which the new note opens without, this is for the first opening only: open the note again later and it looks like any other.

#### New note from outside Obsidian

An Obsidian hotkey works only while Obsidian is the app in front. To start a new note from anywhere, whether Obsidian is in front, behind other windows or not running, Schreibstube answers a link:

```
obsidian://schreibstube-new-doc?vault=Your%20Vault
```

Opening that link does exactly what the **New note** command does. If Obsidian is closed, it starts, loads the vault and then opens the note. The link carries nothing else: it cannot choose the folder, the name or the text, so no web page can put anything into your vault with it. It acts at most once every five seconds; a second call within that time is ignored, so a page that opens the link over and over cannot fill the vault with empty notes and the screen with windows.

**1. Get the link.** In Obsidian, open **Settings → Schreibstube**. Under **Focus mode**, **New note from outside Obsidian** has a **Copy link** button, which copies the link for the vault you are in. To write it by hand, put your vault's name after `vault=`, with a space as `%20` (`My Notes` becomes `vault=My%20Notes`). Leaving out `?vault=…` works too, but then Obsidian uses whichever vault was open last.

**2. Try it.** Paste the link into a browser's address bar and press Enter, or on a Mac run it in Terminal, with the quotes:

```bash
open "obsidian://schreibstube-new-doc?vault=Your%20Vault"
```

The first time, the browser may ask whether to open Obsidian; allow it. A new window with an empty note should appear in front.

**3. Put it on a shortcut.** Pick what you have:

- **macOS, Shortcuts app** (built in):
  1. Open **Shortcuts** and create a new shortcut (**+**).
  2. Add the action **Open URLs** and paste the link into it.
  3. Name the shortcut, for example _New doc_.
  4. Open the shortcut's details (the **ⓘ** button) and choose **Add Keyboard Shortcut**, then press the keys you want, for example **⌃⌥⌘N**. Pick a combination no other app uses.
  5. Press the keys once. macOS may ask whether Shortcuts may open Obsidian; allow it.

  The shortcut also works from the menu bar or Spotlight, if you switch those on in the same details.

- **macOS, Raycast**: run **Create Quicklink**, paste the link as the address and save it. Then assign a hotkey to it under **Raycast Settings → Extensions → Quicklinks**.
- **macOS, Alfred** (Powerpack): create a workflow with a **Hotkey** trigger connected to an **Open URL** action that holds the link.
- **iPhone and iPad**: in **Shortcuts**, make a shortcut with **Open URLs** and the link, as above. Then put it where it is quickest to reach: **Add to Home Screen** from the shortcut's share menu, the **Action Button** (**Settings → Action Button → Shortcut**), or **Back Tap** (**Settings → Accessibility → Touch → Back Tap**). On a phone the note opens in a new tab, since there are no windows.
- **Windows**: right-click the desktop and choose **New → Shortcut**. Paste the link as the location and name it _New doc_. Then open the shortcut's **Properties**, click into **Shortcut key** and press the keys you want; Windows makes it **Ctrl + Alt + …**. The shortcut file must stay on the desktop or in the Start menu for the keys to work.
- **Linux**: in your desktop's keyboard settings, add a custom shortcut whose command is `xdg-open "obsidian://schreibstube-new-doc?vault=Your%20Vault"`.

**If nothing happens:** check that Schreibstube is enabled in the vault the link names, and that the name after `vault=` matches the vault's name exactly, spaces as `%20`. **Copy link** avoids both mistakes. A link to a vault Obsidian does not know opens Obsidian's vault picker instead.

### Properties

Two additions to Obsidian's Properties view in live preview. Both live in a property's own menu — click its icon, or tap it on a phone:

- **Choose icon…** — pick an icon from the same set the explorer uses. It replaces the type icon for that key in every note, in live preview, the reading view and the properties sidebar alike. The type can still be changed from the same menu, and **Remove icon** in the picker brings the type icon back.
- **Enter today** — sets the property to today's date. A date property gets `YYYY-MM-DD`, a date-and-time property today at the current time, a list property gains the date as one more entry, and a text property gets the format from the settings. Not offered for numbers, checkboxes and tags.

**Insert: today's date** puts the date at the cursor instead: in the property field being typed in, or in the note's text otherwise. Give it a hotkey to have the date one keystroke away.

These entries hook into a menu Obsidian builds for itself, since there is no API for it. If an Obsidian update changes that menu, the entries disappear and a warning goes to the console; the command and the icons are not affected.

#### Property sets

Obsidian's **Add property** adds one key. A property set adds all the keys a job needs in one step: Mail needs a recipient, a copy and a subject, and a key typed by hand is a key that can be misspelt.

Schreibstube's own features come as sets, built from the keys each one reads, so a set cannot fall behind the feature:

| Set                      | Keys                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Mail                     | `schreibstubeTo`, `schreibstubeCc`, `schreibstubeSubject`                                 |
| Document sync            | `schreibstubeSyncedFrom`, `schreibstubeSyncEvery`                                         |
| Print                    | `schreibstubePrintTemplate`                                                               |
| Glossary note            | `schreibstubeGlossary: true`, `schreibstubeLanguage`, `schreibstubeDefaultSeverity`       |
| Glossaries for this note | `schreibstubeGlossaries`                                                                  |
| Publish                  | `published: false`, `title`, `date`, `description`, `slug`, `publishedAt`, `publishedUrl` |

The Publish set adds every key publishing uses, under the names mapped under **Frontmatter-Felder** in the publish settings, so it adds `veroeffentlicht` where that is what your notes carry. The flag starts unticked: the set prepares the note, and ticking the flag is what puts it on the website at the next **Ordner veröffentlichen**. `publishedAt` and `publishedUrl` start empty and are filled in by the publish run.

For everything else, set **Property set folder** in the settings. Every note in that folder is a set, named after its file: its frontmatter keys and values are added, its body is not. An existing template folder works as it is.

**Templater templates** are supported. A value such as `created: <% tp.date.now() %>` is rendered by Templater for the note it goes into, so the note gets the date, not the code. Only the template's frontmatter is run, never its body. Without Templater, or if it fails, the key is still added, left empty, and the notice says which keys that happened to.

A set is offered four ways:

- **Add property set…** in a property's own menu, and **Add set** beside Obsidian's **Add property** at the foot of the Properties view
- **Insert: frontmatter property set** in the command palette, or type `/frontmatter` in a note when Obsidian's Slash commands plugin is on
- **When Mail finds its keys missing**: the notice that says a recipient or subject is needed offers **Add mail fields**
- **When you add a key by hand** that belongs to a set, a notice offers the rest of that set, once per note and set. For Publish only the flag does: `title` and `date` are keys many notes carry for other reasons

A set never overwrites. A key the note already has, empty or not and in any letter case, stays exactly as it is; only missing keys are added, and the notice says how many of each. A set adds text, numbers, yes/no and lists; a nested value in a set note is left out and named.

The **Add set** control is placed beside a control Obsidian draws for itself, so it depends on Obsidian's markup. If an update changes it, the control is simply missing; the menu entry, the command and the offers keep working.

#### Tag suggestions

**Suggest tags** beside **Add set**, or **Insert: suggested tags** in the command palette, opens a list of tags the note could carry. The dialog opens at once and fills in as the related notes are read. The control can be switched off in the settings if you'd rather keep the Properties view to two lines. Tick the ones you want and press **Add**: they are added to the note's `tags`, and every tag already there stays as it was. Nothing is ticked to begin with, and nothing is written until you press the button.

The suggestions come from three places, each in its own section:

- **From related notes** — the tags the notes in **Recommended** carry and this one does not. A tag needs two related notes agreeing on it, or one note linked with this one. A tag carried by half the vault counts for less than one only a few notes carry.
- **Stated by the note** — the keywords a paper names itself: a `Keywords:` line under the abstract, IEEE's `Index Terms—`, a keywords heading, Springer's keywords separated by middle dots, German `Schlüsselwörter:` and `Schlagwörter:`, or a `keywords` key a reference manager wrote into the frontmatter. A paragraph of ordinary prose under a keywords heading gives nothing, rather than its clauses.
- **From the content** — press **Ask AI** and the model from the AI settings reads the beginning of the note, up to 12,000 characters, and suggests tags. The vault's tags go with it, so it answers with tags the vault already uses where one fits. This is the only section that sends anything away, and only when you press the button.

Every suggestion is written in the vault's words. `Machine Learning`, `machine_learning` and `machine-learnings` all become the `machine-learning` the vault already uses. A tag nothing in the vault resembles is marked **new**, since ticking it adds a word to the vault's vocabulary. New tags are written in lower case when most of the vault's tags are. A note tagged `projekt/alpha` is not offered `projekt`, because it already is one. Spellings are matched regardless of case, hyphens and underscores, and an English plural `s`; German plural endings are not matched, so `Methode` and `Methoden` stay two tags.

### Rename file from content

Assigns a filename to the active note or image based on its content, with one command that follows the file that is open:

- **Rename note with AI** — on a note, its text is sent to an LLM and the file is renamed with the result; on an image (jpg, png, gif, webp; up to 10 MB), the picture is resized and sent to a vision model, and the file is renamed.

The rename does nothing if the note is shorter than the configured minimum length, or if no API key has been set. The proposed name is cleaned before it is used: characters a filesystem or a link refuses, control characters and invisible formatting characters (a right-to-left override can make `gpj.exe` read as `exe.jpg`) are taken out, and it is cut to fit the filesystem in bytes, not characters. A name that is still not one a file can have — `CON` or `NUL`, which Windows keeps for devices, among them — is refused with a notice instead of being used.

The same thing is on the explorer's context menu, as one entry that follows the file: **Rename from the text…** on a note, **Rename from the picture…** on an image, and nothing at all on a file neither path can read. From the menu the proposed name is not applied outright — it opens the pane's rename dialog with the suggestion in the field, where it can be read, corrected or cancelled, because a menu acts on a row in a tree rather than on the note in front of you.

### Picture descriptions

A photo can only be found by its file name, and `IMG_4711.jpg` says nothing about what it shows. Switch on **Describe pictures** in the settings, then right-click a picture in Schreibstube Explorer (long-press on a phone) and choose **Describe picture**: the configured model looks at it and writes a title, a one-line summary, a short description, keywords and any text it can read into a note of its own, in the folder the settings name (`Bildbeschreibungen` unless you choose another). The note embeds the picture first, so opening it from a search shows the picture at once, and it is an ordinary note: Obsidian's search, the Explorer search and any other plugin find the picture through it, and it stays if Schreibstube goes.

**A line for a card.** The summary says what the picture is for in at most 100 characters, like a headline: for a chart its finding with the number that matters (`Rekord bei Aktienrückkauf-Genehmigungen im Russell 3000: 1,33 Bio. $ bis Ende September 2026`), for a photo what it shows. It is kept in `schreibstubeSummary` and as the first line under the picture, so a base that shows description notes as cards can put it under each one. Pictures described before this have no summary until they are described again.

**Your own properties stay.** Describing a picture again replaces the description, its keywords and the other `schreibstube…` keys, but any property you added to the note yourself — a rating, a project, a status a base filters by — is kept as you wrote it. So is `tags`, unless **Keywords as tags** is on and Schreibstube writes it. Text you wrote below the description is not kept: the body is the description's.

**One language.** Title, summary, description and keywords come in the language the settings choose, also when the picture's own text is in another: a chart with English labels is described in German when German is chosen. Only the visible text is copied as it stands.

**Where it came from.** A picture is often a chart from a study or a framework someone drew. The model then also names the work, `schreibstubeSource` (a Business Model Canvas, a chart from a named report), and who made it, `schreibstubeAuthor`, from what the picture shows and what it knows of the work, and the note says it in a line of its own: `Quelle: Business Model Canvas, von Alexander Osterwalder`. Both are written only when the model recognises the work with confidence; most photos get neither key. The author is the work's, never someone in the picture: the model is told not to name or guess who a person shown in a picture is.

**From the picture in a note.** In Live Preview, Obsidian shows a small bar over a picture when you point at it, with its zoom and **Edit block** buttons. Schreibstube adds two in front of them. ✨ **Open description** opens the picture's note (in a new tab with Cmd/Ctrl); a picture without one shows **Describe picture** instead, while **Describe pictures** is on. ☆ **Mark as favourite** sets `schreibstubeFavorite: true` in the description note, and pressing it again sets `false`; it appears once the picture has a description, since the star is kept there, and describing the picture again keeps it. The bar is Obsidian's own and has no API: if an update changes it, the two buttons are simply missing, and everything else works as before. A slideshow has no such bar, so it carries the same two buttons itself: beside the fullscreen control for the picture on its stage or in front in the feature layout, following the picture as you step through, and in the fullscreen view of every layout, which is where the strip, the masonry and the comparison show them.

**Your starred pictures, leading back to their articles.** The star is kept in the description note, so a base of starred pictures lists description notes, and what you want back from one is the article the picture was in. Schreibstube writes that into every description note: `schreibstubeArticles` lists links to the notes the picture appears in, and a base shows it like any other property, in any of Obsidian's layouts. Cards take the picture as their cover and the article as a line under it; a table shows the article as a column and the picture through `image()`:

```yaml
filters:
  and:
    - schreibstubeFavorite == true
formulas:
  bild: image(schreibstubeImage)
views:
  - type: cards
    name: Favoriten
    image: note.schreibstubeImage
    order:
      - note.schreibstubeArticles
    sort:
      - property: note.schreibstubeDescribedAt
        direction: DESC
  - type: table
    name: Tabelle
    order:
      - formula.bild
      - note.schreibstubeArticles
```

A note counts as an article when it embeds or links the picture; the description itself does not, nor another description, a canvas or an Excalidraw drawing. The list follows the vault: a few seconds after an article starts or stops showing the picture, or is renamed or deleted, the description says so. It is sorted by path and written only when it changes, so editing an article does not rewrite its pictures' descriptions, and two devices write the same list. A picture in no article has an empty list. Describing the picture again keeps the list, and the key is the plugin's: an edit to it is corrected at the next pass.

**Reading, not editing.** Each base says for itself whether the notes opened from it open in Reading view. Right-click the base's file in the file list, or its tab, and tick **Open notes in Reading view** (`Notizen in Leseansicht öffnen`), or run **Base: open notes in Reading view (on/off)** while the base is open. A note opened from that base — a table row, a card, a list entry, or a link in one, such as the article under a starred picture — then opens in Reading view rather than in your default mode, in every layout, and also where the base is embedded in a note with `![[Favoriten.base]]`. Back returns to the base. The choice is kept in the base's file, as `schreibstubeReadingView: true` on its first line, so it travels with the base to other devices and into copies, and can be written by hand; Obsidian keeps the line when it saves the base after an edit in its own interface. A base written as a `base` code block inside a note has no file to say it in, and opens its notes as any link does. Obsidian says when a note opens but not from where, so Schreibstube notices the press in a base's results and switches the note that opens right after it; the results are found by Obsidian's own markup, which has no API, and if an update changes it, notes simply open as they do without the setting.

**Callouts and highlights.** A base can show what is inside its notes rather than their properties: choose **Callouts & highlights** (`Callouts & Markierungen`) as its layout. Every callout in the notes the base lists becomes a card of its own, and each note's `==highlights==` one card with every highlighted line, all drawn by Obsidian's own renderer, so they look as they do in the note, in your theme. Which notes, in what order and grouping, is the base's filter, sort and grouping, as for any layout — folder, tags, properties. The layout's settings add three of its own, kept in the `.base` file under the view: **Callout types** (`calloutTypes`, say `warning` and `tip`; none listed shows every type), **Show** (`show`: callouts and highlights, only callouts or only highlights) and **Open notes in Reading view** (`readingView`). A press on a callout or a highlighted line opens its note at that line; the title of a foldable callout folds it, as in the note. Callouts and highlights in code, in comments and in the properties do not count, a callout inside a callout is part of the outer one, and one inside a list item stays the item's. The layout reads the notes' text, kept between drawings and read again only when a note changes; it reads at most 500 notes and draws at most 1,000 cards, and says so when a base lists more.

```yaml
filters:
  and:
    - file.inFolder("Projekte")
views:
  - type: schreibstube-passages
    name: Warnungen
    calloutTypes:
      - warning
    show: callouts
```

In Schreibstube Explorer a described picture stays one row. Its description note is kept out of the tree, the search and the folder counts, and the picture itself is found by the note's words: its title, its keywords and its description, a hit in the description counting for a little less than a keyword. A folder holding nothing but such notes is hidden with them. The note is reached from the picture: its mark on the picture's row opens it. Neither the search nor Recommended ever lists a description note — not even one whose picture is gone, which describes nothing anyone looked for; the tree still shows such an orphan, so it can be seen and repaired. What makes a note a description is the `schreibstubeImage` link in its frontmatter, not the folder it sits in: a note moved elsewhere keeps describing its picture, and a note you write yourself in the description folder is left alone.

A description note follows its picture. Rename or move the picture, in Schreibstube Explorer or anywhere else, and a moment later the note points at the new place and is renamed to match, whether or not Obsidian's **Automatically update internal links** is on; a note you renamed yourself keeps your name. Delete the picture from Schreibstube Explorer and its note goes to the trash with it, and one undo brings both back. Deleted elsewhere, the note follows it to the trash ten seconds later, unless the picture is back by then or the note's link finds it again, which is what a sync that moves a file as a delete and a create looks like.

A picture renamed outside Obsidian, or deleted while Obsidian was closed, leaves its note pointing at nothing. Shortly after the vault opens, Schreibstube looks for the picture by its content: the note recorded the picture's size and a fingerprint of its bytes when it was written, so only pictures of exactly that size are read, at most a hundred per run. When exactly one picture matches, and no other orphaned note claims it, the note is re-linked and renamed as if it had followed the picture. Anything less certain is left alone. **Explorer: orphaned picture descriptions** (`Explorer: verwaiste Bildbeschreibungen`) runs the same search on demand and lists the notes still without a picture, to open one and set its link by hand. An orphaned note is never removed.

**A whole folder at once:** right-click a folder, in Schreibstube Explorer or in Obsidian's own file list, and choose **Describe pictures** (`Bilder beschreiben`). Every picture under it, subfolders included, that has no description gets one. Orphaned notes are matched first, as described above, so a picture that was only renamed gets its old description back instead of a new request. What is left is shown before anything is sent — how many pictures, and to which provider — and nothing leaves the vault until you confirm. The pictures go one after another; a notice counts along and has **Stop**, which ends the run after the picture in progress. A run describes at most 100 pictures and skips any over 10 MB; the confirmation says how many were left out, and running it again takes the rest.

Describing a picture again replaces its note in place. The note records the picture's path, size and a fingerprint of its bytes, so a picture that changed can be told from one that did not. Keywords are written as a property and as plain text in the note; as Obsidian tags only if you switch that on, because many pictures with several keywords each fill the tag pane.

What is sent and what is not: the picture is resized to the size set under **Rename file from content** before it leaves the device, and resizing drops its EXIF data, the location included. The model is asked not to say who a person is and not to read out licence plates, house numbers or other personal data. Nothing is sent while the setting is off. The answer is checked before anything is written: a reply without a title or a description writes nothing, every field has a length limit, links and images are reduced to their words, so no picture is fetched when the note opens, and tags, headings, frontmatter fences, HTML, comments and code — backticks, fences and Templater tags, which another plugin could run — are taken out of it.

### Summarize selection

Select any text and run **Insert: AI summary of the selection** to send it to an LLM and replace the selection with the result. Built for turning raw text pasted from analytics and reporting tools into a running insight log: copy the numbers into a note, select them, summarize, and keep the distilled takeaway in place of the raw dump.

The summarize prompt is fully configurable in settings — a default tuned for the insight-log workflow is provided. The command uses the shared **AI models** configuration (provider, model, and API key).

The summary is the model's text, written into your note. If it holds code another plugin runs — a `dataviewjs` or other executing block, an inline `$=` span, a Templater `<% %>` command — that the selection did not already hold word for word, that code is inserted so it does not run: a block is relabelled `text`, an inline span and a Templater tag lose the character that opens them to an HTML entity, and a notice says what was found. The same goes for **AI table**, cell by cell.

### Table from selection

Select several lines and turn them into a Markdown table, from the editor's context menu or the palette:

- **Insert: table from the selection** (menu: **Convert to table**) — for text that already has columns: tab-, semicolon- or comma-separated lines (the first line becomes the header), or a `key: value` list. Colour lists such as `Blue: RGB(84,190,247) #54BEF7` get separate RGB and Hex columns, but only when no other text would be dropped. Runs locally; nothing is sent anywhere. The menu offers it only when the selection has such columns.
- **Insert: AI table from the selection** (menu: **Convert to table with AI**) — for text without clear separators. The selection is sent to the shared **AI models** configuration, which chooses the columns and is told to use only information from the text and never to fill in missing values. Up to 8 000 characters.

The selection is widened to whole lines, blank lines are added around the table where it needs them to render, hex values are set as code so they are not read as tags, and one undo restores the original text. If the text changes while the AI request runs, nothing is replaced.

### Sums and formulas

Amounts in a note add up without leaving it.

**The selection.** Select lines with amounts and the status bar shows their total, `∑ 320 € · 2 amounts`; click it to copy the total. Each line counts once, with the amount that carries a currency, or else the last number on it — so `2 × Milch 1,50 €` costs 1,50 €. Selected table rows are lines too; a table's header row is not. A number without a currency counts only where a figure stands, at the end of its line or cell — `Groceries 300` — so selected prose with a year or a chapter number in it shows no total. **Sum selection** counts every number, since you asked. On a phone, which has no status bar, run **Sum selection**, or pick **Copy sum** from the editor's menu.

**Formulas in a table.** Write a formula alone in a cell and it shows its result, worked out from the cells above it in the same column, back to the header:

```markdown
| Item      | Amount |
| --------- | ------ |
| Groceries | 300 €  |
| Car       | 20 €   |
| **Total** | =sum   |
```

`=sum`, `=avg`, `=median`, `=count` (cells with an amount), `=min` and `=max`. The note keeps the formula; Reading view shows the result, with the formula a hover away, and a mailed, published or printed note carries the result in place of the formula. Another formula above is not counted, so a subtotal row does not count twice. A cell whose text has no amount is left out and the result says so — `(1 cell skipped)` — and an amount in quotes, `"300 €"`, is left out on purpose and not reported.

**Fixed results.** `=sum(fixed)` works like `=sum` until the note first leaves the vault — mailed, published or printed. Then the result is written into the cell, `=sum(fixed: 320 €)`, and stays: the number the recipient got, whatever the amounts or the rates are afterwards. The value written is the one in the copy that left, even when the note was edited while the upload or the PDF was being made; if the formulas themselves changed in between, nothing is written and a notice says so. If the amounts change later, Reading view says what it would be now beside the fixed number — not when only the rates' day moved, or converting was switched on or off. **Freeze note totals** fixes them earlier by hand. Nothing is written while a note is only being looked at. To let a fixed result move again, delete the part after `fixed`; to make it live for good, write `=sum`.

**Numbers.** `300 €`, `€ 20`, `1.234,50 €`, `20,-` and `-20 €` are all read. Whether `1.234` is a thousand or a little more than one is the one thing a number cannot say about itself; the **Number format** setting decides that case, and nothing else — `1.234,50` and `20.50` read the same whatever it says. Results are written in the same format.

**Currencies.** Amounts in one currency are added; a number without one joins it. Several currencies are given per currency, `300 € + 20 $`, and an average of several says the currencies are mixed. With a **Default currency** and **Convert currencies** on, they are converted instead, at the European Central Bank's daily reference rates, and the result carries the day: `≈ 316,00 € · ECB 26.09.2026`. The rates are fetched from `ecb.europa.eu` only when a total needs them, at most twice a day, and kept between sessions; nothing about your notes is sent. Offline, the last rates are used, and without any the total is given per currency.

**Not yet in Live Preview.** A formula's result shows in Reading view and in what leaves the vault. In the editor the cell shows the formula.

**Calculation lines.** A line that ends in `=` shows its result beside it, in the editor and in Reading view: `12,5 * 8 + 3 =` → `103`, `Miete 1.240 € - 15% =` → `1.054,00 €`, `10% von 200 =` → `20`, `3 km in m =` → `3.000`, `72 F in C =` → `22,22`. A label may stand before the calculation, and a list, task, heading or quote marker is fine. Press Tab at the end of the line, or click the result, to write it into the note (`= 103`); until then the note holds only what you wrote, and so does a mailed, printed or published copy. Amounts in one currency are worked out in it; a number without one joins it. Mixed currencies are converted into the default currency only when **Convert currencies** is on, and the result says whose rates: `≈ 320,00 € · ECB 26.09.2026`. Code blocks, frontmatter, math and comments are left alone, and **Calculate lines ending in =** in the settings switches it off.

The same lines give the same results, to the character, in a native quick-note app that writes into the same vault (which does not convert currencies). The rule both follow is [`contracts/CALCULATOR.md`](contracts/CALCULATOR.md), and the examples both test against are [`contracts/calculator-cases.json`](contracts/calculator-cases.json): a change to either is a change to both apps.

### Slideshow

Two or more images in one block, shown the way the passage needs them:

````markdown
```schreibstube-slideshow
layout: feature
![Jetty](jetty.png)
![Grass](grass.png)
![Horizon](horizon.png)
```
````

One Markdown image per line, at least two, at most a hundred. The path may be a file name, which is found wherever it sits in the vault, and may spell spaces as `%20` or sit in angle brackets, as Markdown links do; only images in the vault are shown. Blank lines and `//` comments are ignored, so a block can be annotated. Any other line — a wikilink such as `![[photo.png]]`, a stray word, a misspelt layout — is reported with its number rather than dropped. **Insert: slideshow** drops an empty block at the cursor.

The only text a block shows is an image's alt text, in the header row above the pictures, beside the controls. Both keep out of the way: they appear while the pointer is over the block or a control has the keyboard focus, and on a phone a tap on a picture or on the row shows them and the next tap, or a swipe, hides them again. The row keeps its height, so the note does not shift. `layout:` picks the arrangement; without the line it is `slideshow`.

- **`slideshow`** — one stage, one image on it, with its alt text in the header. Previous and next, the arrow keys, a swipe on a phone; a double-click or the expand control opens the fullscreen view. Good for a walk through a place in six pictures, where the reader sets the pace.
- **`filmstrip`** — the same stage with every image as a thumbnail underneath. Press a thumbnail to put it on the stage; the strip scrolls to keep the current one in view. Good for a longer series the reader wants to jump around in.
- **`feature`** — one image large, the next two beside it as tiles. It uses the block's first three images; any further lines are left out. Press a tile and it comes forward, its alt text in the header. The images are cropped to fill their tiles. Good for a picture essay, a room, a plate, an outfit.
- **`strip`** — every image at once in a row of equal tiles, cropped alike. A strip longer than four wraps to rows of three. Good for morning, noon and evening — a series that makes one statement together.
- **`masonry`** — every image at once at its own proportions, packed into columns like a mood board. Good for pictures that lose too much when cropped.
- **`compare`** — two pictures of one thing in a single frame, the first laid over the second under a divider. Drag the divider, press anywhere on the picture to send it there, or use the arrow keys; Home and End put it on an edge to see one picture whole. It uses the block's first two images; any further lines are left out. Both sides are cropped to the frame, which takes the proportions of the first picture the vault has, so the two stay aligned. The alt texts label the sides rather than the header — `![Before](…)` and `![After](…)` name themselves. Good for a renovation, a retouch, a before and an after.

In `strip` and `masonry` the header names the image under the pointer or the keyboard focus, and a tile opens the fullscreen view at its place. The fullscreen view has a counter, the arrow keys, a swipe, and Esc to leave.

The controls are icons standing on the page, drawn from the plugin's own icon font, with no fill behind them in any state. On a phone the scene stacks, its details side by side under it, and the strip settles on two columns. A swipe across the stage or the scene turns the page in the note itself, not only in the fullscreen view, and the block keeps that swipe to itself: it does not scroll the note and it does not slide a sidebar in.

A published note keeps its slideshows: the site shows the same layout, with the alt text, the controls, the arrow keys and the fullscreen view, from a small script of its own. Where scripts do not run the pictures still read — the stage swipes, the tiles stand in a grid, a comparison sets its two pictures side by side. Only pictures that were published are shown, and a block with a mistake in it is left off the page rather than printed as code.

### Icons in the text

Type a colon and the first two letters of an icon's name — `:fo` — and a picker lists the icons that match, glyph beside name; Enter writes `:folder: ` and you keep typing. In Live Preview and Reading view the shortcode is drawn as the glyph, sized to the text and sitting on its baseline; put the cursor on it and it shows its colons again for editing. Any of the plugin's icons can be written this way, the same set the Explorer's icon picker offers.

What goes into the note is the name between colons, never the glyph itself. The icons are a font that only this plugin installs, so a glyph pasted into a mail or read on a device without the plugin would be an empty box; `:folder:` reads as a word that says what was meant, and the bridge can draw it when publishing. A colon after a word — "Beispiel: der Fall" — never opens the picker, and a shortcode inside code, a link or a URL stays text.

If another plugin already uses the colon for emoji, switch this off under **Settings → Schreibstube → Icons in the text**; the shortcodes already in your notes then read as text.

### Email (IMAP/SMTP)

Send notes as email and pull messages back into your vault — on desktop **and** mobile.

- **Send note as mail** — recipients and subject come from the note's frontmatter; the body is the note as plain text. A confirmation dialog shows the sender, the recipients and the text exactly as they will be sent, and warns when there is no To recipient.
- **Search mailbox** — search by sender, subject, full text or date, then insert the chosen message into the active note. Tick **Include attachments** to bring its pictures, PDFs and Office files along: they are saved to your attachment folder (**Settings → Files and links**) and embedded or linked under the quoted mail. Signature logos are left out, a file imported before is linked rather than copied, and anything not imported is named under the mail. Needs bridge protocol 7.
- **Fetch replies into note** — find replies to a note you sent and append the new ones. Re-running the command only ever adds what is new.

The note's frontmatter is the contract:

```yaml
---
schreibstubeTo: kunde@example.com
schreibstubeCc: [innendienst@example.com]
schreibstubeFrom: Büro <buero@your-domain.de> # optional: this note's sender
schreibstubeSubject: Angebot Objekt 4711
schreibstubeMessageId: <7f3a…@your-domain.de> # written on send
schreibstubeSentAt: 2026-09-07T10:12:00.000Z # written on send
schreibstubeSendUnconfirmed: 2026-09-07T10:12:00.000Z # written when a send's outcome is unknown
schreibstubeMergedIds: ["<reply-1@mail.kunde.de>"] # written on merge; keeps merging idempotent
---
```

`schreibstubeMessageId` is what ties replies back to the note, so **Fetch replies** only works on notes that were sent from Obsidian, and only with a value shaped like a Message-ID: a fragment such as `<` would match every reply in the mailbox and is ignored. One fetch takes the newest replies up to **Maximum results**; a bridge from 3.0.0 skips the ones the note already holds, so when more cite the note than one fetch takes, a notice says so and running the command again reaches the older ones. `schreibstubeMergedIds` keeps the newest 500.

`schreibstubeFrom` sends one note under another address, such as an alias of your mailbox. Without it the note goes out under **Settings → Schreibstube → From**, and without that under the bridge's `MAIL_FROM`; the confirmation dialog names the sender either way. From bridge 3.0.0 the alias must be one the bridge allows — `MAIL_FROM` itself, or an address or `@domain` in its `MAIL_FROM_ALLOWED` — and any other is refused with the bridge's reason rather than sent. The alias sets only the `From` line: the mail is still sent through, and bounces return to, the bridge's mailbox. Replies go to the alias, so **Fetch replies** finds them only if the alias delivers into that mailbox. An address on a domain your mail provider does not send for, a freemail address for instance, is likely to be filed as spam or refused by the recipient's server.

The body is sent the way the rendered note reads, as plain text: emphasis without its asterisks, headings as their text, a link as its text with the address after it, a wikilink as its name, tasks as ☐ and ☑. Comments — `%%…%%` and `<!-- … -->` — are never sent. An embedded file cannot travel in a text mail, so its name stands in its place. Code keeps its characters.

The note is read again when **Send** is pressed. If it changed since the dialog opened — a property still being saved, an edit from sync — the dialog shows the note as it is now instead of sending, and a second press sends that.

When the bridge or the connection gives up before the mail server has answered, the mail may have gone out anyway. That is reported as unconfirmed rather than failed, the note gets `schreibstubeSendUnconfirmed`, and the next send warns you to look in Sent first. A confirmed send removes the mark.

If the mail server turns down some of the recipients, the send still succeeds for the others, and a notice that stays until dismissed names the ones that will not receive it.

#### The bridge

Obsidian on mobile runs in a WebView with no Node runtime and no raw sockets, so the plugin cannot speak IMAP or SMTP itself. Instead it talks HTTPS to a small self-hosted bridge that does — see [`bridge/README.md`](bridge/README.md) for the API, configuration, and Sliplane deployment steps.

Two consequences worth knowing:

- The plugin needs **no Node dependencies** and stays available on mobile.
- Your **mailbox password lives on the bridge**, not in the vault. The plugin only stores a bridge token, which you can rotate without touching the mailbox.

### Publishing

Publishes a vault folder as a static website over SFTP, from desktop and from mobile.

- **Ordner veröffentlichen** — collect the folder, show what will change and ask before uploading and publishing

**Website öffnen** in the publishing settings opens the published site.

Publishing is opt-in per note. A note is published when its frontmatter says so, and taking the flag away removes the page on the next publish:

```yaml
---
published: true
title: Hallo Welt # default: the first heading, else the filename
date: 2026-09-12 # default: the file's creation date
description: Kurzfassung # optional; page head and index entry; written by the AI when empty
slug: hallo-welt # default: from the filename
publishedAt: … # written back after publishing
publishedUrl: … # written back after publishing
---
```

**A missing description is written by the AI.** When a note is published with no `description`, or an empty one, the AI provider from the AI settings writes a sentence or two about it, the page goes out with it, and it is written into the note, where you can change it. A description with anything in it, a single space included, is yours: it is published as it is and the AI is never asked, so `description: " "` publishes a page without one. The descriptions are written after you confirm the plan, a few at a time; a note the AI does not answer for within 20 seconds is published without one, the notice says how many, and the next publish asks again. Each account can switch this off under **Fehlende Beschreibungen per KI schreiben**; without an AI key nothing is asked.

**The key names are settings.** The defaults are the plain names most vaults already use. If yours calls these fields something else, or another plugin has claimed one of the names, map each role to the key you use under **Frontmatter-Felder** in the publish settings. A configured key replaces the default rather than adding to it, so notes still carrying the old name stop being recognised.

```yaml
---
veroeffentlicht: true
titel: Hallo Welt
datum: 2026-09-12
---
```

The site is one page per note plus an index sorted by date, newest first. Wikilinks between published notes become site links; a link to an unpublished note degrades to plain text rather than a dead link. Embedded images and video are uploaded under a content-addressed name, so a changed picture can never be served from a cache. Callouts, footnotes, tables, task lists, maths and Mermaid diagrams all render. A `theme.css` in the publish folder replaces the built-in stylesheet. Up to three **header tags** per connection, set in its settings, are linked on the right of every page's header, each to a page listing the notes that carry it; nested tags count (`projekt` also lists `projekt/alpha`), a tag no published note carries is left out, and only which of those three tags a note carries is sent to the bridge — a note's other tags stay in the vault.

What the bridge does and the plugin does not: rendering the Markdown, holding the SFTP credentials, and deciding what may be deleted. Only files the bridge itself wrote are ever removed, and the hosting key never enters the vault. See [`bridge/README.md`](bridge/README.md).

### Printing

Turns the note you are looking at into a PDF, through the built-in **Standard** template or one you keep in the vault. It works on every platform Obsidian runs on — Windows, macOS, Linux, iOS, Android — offline, with no bridge and no account: Typst is compiled to WebAssembly and typesets on the device. A letter written on a train becomes a PDF on that train.

- **Notiz drucken** — print the active note, through the print dialog
- **Notiz drucken (ohne Dialog)** — print it straight away, as its template sets it
- **Auswahl drucken** — print only what is marked in the editor, through the print dialog; also in the editor's right-click menu

#### Printing a selection

Mark a passage — the CV inside a long application, one chapter of a manuscript — and run **Auswahl drucken**. The dialog opens on the marked text alone, with the note's template, its `schreibstubePrint` values and its properties; choose another template there if the passage wants one, such as **Lebenslauf**. Footnotes the passage uses are printed even when they are defined further down the note. The PDF gets a name of its own, the note's name and the passage's first heading — `Bewerbung – Lebenslauf.pdf` — so it never replaces the PDF of the whole note. A `=sum(fixed)` total in the passage prints its value and is not written back into the note; that happens when the whole note is printed.

#### The print dialog

**Notiz drucken** opens a dialog with four choices beside a preview of the pages they make:

- **Vorlage** — the template, starting with the one the note or the settings choose.
- **Ränder** — Schmal (15 mm), Standard (the template's own) or Breit (35 mm). A template that sets its own margins, such as the letter, keeps them; the choice is then greyed out.
- **Trennlinien als Seitenumbruch** — a horizontal rule starts a new page, starting from the template's own habit.
- **Eigenschaften drucken** — the note's properties as a short list under its title, leaving out the plugin's own `schreibstube…` keys.
- **Diashows** — only when the note holds a slideshow: **Wie in der Notiz** prints each one as it stands on screen before anybody steps through it (a stage its first picture, a filmstrip its first picture over the thumbnails, a feature, strip, masonry or comparison as arranged); **Alle Bilder untereinander** prints every picture of every slideshow at the text's width, each with its description.

The preview is the document itself, set again after each change and drawn by the same PDF viewer Obsidian uses; **Drucken** writes those very pages. Nothing is remembered: every print starts from the template.

**Page breaks from the preview.** Click a paragraph, heading, list or table in the preview and it starts on a new page; a dashed line marks where, and hovering shows where a click would put one. Click the block again to take the break away, or press **Seitenumbrüche entfernen** beside the hint. The breaks belong to this print only and are not written into the note. A deck has none: every slide starts its own page.

**Vorlage anlegen** in the print settings writes an example template into a folder you choose.

#### Switching it on

Printing is off until you turn it on, under **Einstellungen → Drucken**. That switch is what fetches the typesetter and its fonts, about 35 MB, so nothing is downloaded for a feature you have not asked for. Running the print command while it is off explains this and offers to turn it on.

Once on, the settings show whether the typesetter is on this device, with a button to fetch it now or to remove it again. Fetching it in advance means your first print is not also a download. It comes from this plugin's own GitHub release and is checked against a hash committed in the source, on download and on every later start; a mismatch is refused and reported rather than repaired quietly. After that, printing never touches the network.

#### Getting a template

You don't need one to start: a note that names no template is printed with **Standard**, which the plugin carries: the Klartext theme on paper — A4, the note's own headings in Fira Sans, the text in JetBrains Mono, the title and page number at the foot. **Standardvorlage** in the print settings chooses another default, or asks every time; a note picks its own with `schreibstubePrintTemplate` in its frontmatter. Standard is part of the plugin: it is always there, cannot be deleted and is not a folder in the vault. The print dialog's **Schrift des Textes** sets its text in JetBrains Mono or Fira Sans for that print; a note that wants Fira Sans every time says `schreibstubePrint: { monospace: false }`.

To change how pages look, press **Vorlage anlegen** under **Einstellungen → Drucken**. It asks which of the two examples you want (a letter or a CV) and which folder to put it in — any folder in the vault, not only the templates folder — then writes it and opens its `template.md`. You do not need to leave the app, which on a phone you could not do anyway.

The same three templates are in [`examples/print/`](examples/print/) if you would rather copy them by hand.

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

The converted note does not call Typst's own primitives for the things a template should own. It calls these, and a template that wants a different look defines its own before the body is placed:

| Helper                                         | Given                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `schreibstube-image(path, alt)`                | one embedded picture                                                 |
| `schreibstube-placement(width:, align:)[body]` | a picture the note sized or aligned, `body` its `schreibstube-image` |
| `schreibstube-diagram(paths, caption)`         | an **array** of pictures from one fence, and one caption             |
| `schreibstube-code(source, language)`          | a fence that is not a diagram, or one that could not be drawn        |
| `schreibstube-callout(kind, title)`            | an Obsidian callout; returns `body => …`                             |

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

A file list of Schreibstube's own, opened from the ribbon icon in the left margin or with **Open explorer**. It exists because three things cannot be done to Obsidian's explorer from a plugin without fighting it: an icon per item, a mark for sync state, and an order you can lift a file to the top of.

The pane has four sections, each one collapsible, each remembering whether it was open on that device: **Pinned**, **Bookmarks**, **Updated externally**, and **Files and folders**. Updated externally is drawn only while Document sync is turned on. Pinned is drawn only when something is pinned and opens closed. Closed, it keeps three rows on the sticky strip and its icon carries the number of pins there are, the badge a closed folder carries; open, the strip holds as many as fit in half the pane and the rest continue in the scrolling list. A search opens it for as long as it is set, and so it opens Bookmarks and Updated externally, showing the rows that match; a section with no match stays out of the results.

- **Icons.** Right-click, or long-press on a phone, and pick from some four hundred icons grouped by what they are for — documents, folders, revision, numbers and letters, story and characters, moods, places, research, media, real estate, business, economy and finance, status. The set is a subsetted [Tabler](https://tabler.io/icons) webfont carried inside the bundle, so it works offline and on mobile, with no request to a CDN. A row without a chosen icon is drawn by its kind: a note as text, a PDF with its own mark, an Excalidraw drawing as a scribble, a base as a table, pictures and recordings as a picture, anything else as a blank sheet.
- **Names.** Every file is shown without its extension — `Plan.md`, `Plan.svg`, `Plan.excalidraw.md`, `Plan.base` and `Plan.png` all read **Plan**, and the icon tells them apart. Switch on **Show file extensions** in the settings to see whole names instead; it is off by default, and worth switching on if a folder holds `photo.png` beside `photo.jpg`. **Rename** edits the name without its extension, and keeps the rest, whichever way rows are drawn, so a drawing stays a drawing.
- **Search.** The box above the tree searches what a file is _called_, in every sense a vault gives the word: its name, the `title` in its frontmatter, its aliases, its tags, the folders above it and, more faintly, the words in its text. A hit in the name counts for most and a hit in a folder for least, since every file in a folder shares it; and every word typed is weighed by how rare it is in the vault, so a word most files carry barely moves a result while a word one file holds decides it. German compounds are found by the word at their end — _Vertrag_ offers _Mietvertrag_ — and a longer form finds a shorter one. A prefix narrows the search to one dimension, and the words after it are matched only there:

  | Prefix  | Also accepted                 | Searches                                                                                                                    |
  | ------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
  | `tag:`  | `tags:`                       | tags only                                                                                                                   |
  | `pfad:` | `path:`, `ordner:`, `folder:` | the folders above a file                                                                                                    |
  | `name:` | `datei:`, `file:`             | file names only                                                                                                             |
  | `text:` | `inhalt:`, `body:`            | the text of notes only                                                                                                      |
  | `sync:` | `synced:`, `synchron:`        | only notes bound to a source, however old; alone it lists all of them, folder by folder — `sync: angebot` narrows that list |
  | `alle:` | `all:`                        | everything, the same as no prefix                                                                                           |

  A prefix is read at the start of the box. After `sync:` a second one may follow, so `sync: pfad:Kunden` lists the synced notes in that folder and `sync: #offen` those carrying the tag. Any other word before a colon is ordinary text, so a note called `todo: Angebot` is still searched for by typing it. While the box has text the tree steps aside for a flat list of the matches, best first, each row carrying the folder it came from; a tree is the right shape for browsing and the wrong one for searching, and drawn as one the ranking is invisible. Clearing the box brings the tree back as it was. When more match than the list can draw, it keeps the best and says how many it is holding. A search is read up to its first dozen words, which is well past anything anyone types and is what keeps a pasted paragraph from being scored against every file in the vault. The words in a note's text are searched too, but count well below a hit in a name, title, alias or tag, so a file called what you typed still comes first; `text:` searches the text alone. It is still not a replacement for Obsidian's own search, which reads note bodies in full and has the operators for that.

- **Search by meaning.** With **Search by meaning** switched on, the search also finds notes by what they are about. After a short pause in typing, the notes whose content answers the words — a note about the bright kitchen with the lake view, typed as `küche mit seeblick`, whatever its name — join the list, and a row found only this way says so when the pointer rests on it. The two rankings are merged by place, not by score, and the file named exactly for what was typed keeps first place, so `Objekt 12` still finds `Objekt 12`. A described picture is found as the picture, through its description note. A `tag:`, `pfad:` or `name:` prefix leaves meaning out, since it asked for one dimension. The keyword rows never wait for it.
- **Other plugins' items.** A plugin that hands its own items to search by meaning — Pythia's conversations, for one — has them found too, under a heading of their own below the files: by the words of their title, and by meaning, up to ten from each plugin. Pressing one opens it in that plugin. A `tag:`, `pfad:` or `name:` prefix leaves them out. Each such plugin asks in a notice, with **Allow** and **Not now**, and nothing of it is read until you allow it; **Settings → Search by meaning → Other plugins' sources** lists them, each with a switch, and **Forget** clears the answer for one no longer installed. Refusing one also deletes what it had indexed. See [Search by meaning](#search-by-meaning) for how the index is built and kept.
- **Getting to the search.** **Explorer: search** (`Explorer: suchen`) in the command palette, or on a hotkey of your own, puts the cursor in the box, opening the pane first if it is shut, and selects whatever was typed last time so the first key replaces it.
- **Following the open note.** Whichever way a note is opened — a link, the quick switcher, a search — the pane opens the folders above it and brings its row into view, scrolling only when the row is off screen. Nothing else is collapsed. A collapsed sidebar stays collapsed; the row is in view when it is next opened. A note in a popped-out window is not followed: the pane is not where you are looking, and focusing that window leaves the tree exactly as you left it. A note pressed in one of the pane's own lists — pinned, recent or bookmarked — opens its folders but does not scroll the tree, because you are already looking at its row.
- **Updated externally.** The notes whose Document sync source changed and that still wait to be looked at, newest first, every one of them, with no heading of their own inside the section. The section's icon carries the sync mark while one of them is new to this device. It is there only while Document sync is turned on.
- **Properties on a mirrored note.** A check keeps two of the note's own properties: `title`, taken from the document's first heading and written only once — a title already in the file is yours and is never overwritten — and `updatedAt`, stamped whenever the source has actually changed, not merely been checked. Properties only: a check never writes the body, which still waits in the review panel.
- **Sync marks.** A note bound to a source shows what its mirror is doing: in sync, changes waiting from the poll, never checked, or a source that cannot be fetched. Shape carries the state and colour only reinforces it. Nothing is shown while document sync is off.
- **Keeping a file at the top of its folder.** Some files in a folder matter more than the rest, and **Keep at top of folder** holds them above their siblings, folders included, first in the order they were marked. Drag one onto another held in the same folder to change that order: the upper half of the row puts it before, the lower half after, and on a folder only the top and bottom edges do, since its middle still moves the row into it. Everything below keeps Obsidian's own arrangement: folders first, then files, numeric-aware so `Objekt 2` precedes `Objekt 10`. The row carries a pin glyph, which is what explains why it is where it is.
- **Pinning.** Everything pinned appears in a **Pinned** section at the top of the pane, in the order it was pinned, wherever in the vault it lives, and the block can be dragged into any order. A pinned note is drawn by the `title` in its own frontmatter when it has one, because a pinned row is a shortlist entry to be recognised rather than a path to be read — the file itself is untouched, and its path is still on the row's tooltip. The tree below keeps filenames, which is where a file is looked for by name. Pinning is a separate mark from the one above: "wherever I am, I want this row" is a different wish from "inside this folder, this one first", and answering one no longer answers the other. A file can carry both, either, or neither.

- **Pinning a tag.** A tag can sit in the Pinned block beside the files, and its row adds up the tasks of every note carrying it: `3 / 12` is three open out of twelve across all of them. Pin one with **Pin tag**, or from a note's menu with **Pin a tag of this note…**, which offers only that note's tags — Obsidian's own tag list gives a plugin no menu to add to. A note counts as tagged the way Obsidian's tag search sees it: the tag written in its frontmatter or anywhere in its text, every task in the note counting, tags nested underneath included (`#projekt` counts `#projekt/alpha`), and case ignored. A note is counted once per row however often it writes the tag, and a note carrying two pinned tags counts in both rows — each row answers its own question, and nothing adds the rows together. The figure is drawn whether or not **Task counts** is on, because it is what a tag is pinned for. Press the row and the right sidebar lists the tagged notes as cards, the most open tasks first and then the most recently changed; a card shows the note's title, its folder and its own count, a press opens the note, and a press with Cmd or Ctrl opens it in a new tab — with Alt as well beside it, with Alt and Shift in a new window. The sidebar keeps one list at a time, so pressing the next tag replaces it, and it follows the vault as you tick tasks off. Right-click a pinned tag, or long-press it, to list its notes or remove the pin; it can be dragged into place like any pinned row.
- **How much a closed folder holds.** A small figure on the folder's icon, counting every file underneath it and its subfolders, drawn only while the folder is shut — open, the answer is on screen. Empty folders carry nothing, and past ninety-nine it says `99+`.
- **Moving.** A row is dragged onto a folder to move into it — onto the folder itself or onto any row inside it, since the whole block a folder occupies is its target — and onto the "Files and folders" header to move out to the vault root. A finger drags as a mouse does: the press that opens the context menu at half a second also arms the drag, so holding still and letting go gives the menu, while holding and then moving gives the drag, and the menu steps aside as soon as the row starts moving. The list scrolls while a drag rests near its top or bottom edge, so a folder off screen can still be reached. **Move to…** on the menu does the same thing from a list of folders, for when the target is nowhere near. Whether a move is allowed is decided away from the pointer: a folder cannot go into itself or its own subtree, a name already taken is refused rather than overwritten, and a refusal says which it was. The move goes through Obsidian's own rename, so links follow.
- **Several at once.** ⌘-click adds a row to the selection, ⇧-click takes every row between the last plain click and this one, and ⇧-arrow grows the range a row at a time; Escape lets it go. Obsidian's other two chords still open a note from the tree: ⌘⌥-click beside the open one, ⌘⌥⇧-click in a new window. In the recent lists and the pinned block, which select nothing, a press follows Obsidian throughout: ⌘ for a new tab, ⌘⌥ for a split, ⌘⌥⇧ for a new window. Right-click any selected row, or press the menu key on it, and the menu is for all of them: move them to a folder every one of them can go to, or delete them after one question.
- **Undo.** The notice after a move or a delete carries **Undo** for thirty seconds; ⌘Z in the pane and the command **Explorer: undo the last move or delete** do the same. A move is moved back. A delete is lifted out of the vault's own `.trash` folder — so it works when Obsidian is set to use that, and the notice says so when it is set to use the system trash instead, which the pane cannot reach into.
- **Files from the desktop.** Drop files from Finder or Explorer onto a folder, onto any row inside it, or onto the "Files and folders" header for the root. A name already taken gets the next free one, `Scan 1.pdf` beside `Scan.pdf`. A folder dropped from the desktop is refused rather than imported as an empty file, and a file over 200 MB or the fifty-first in one drop is left out and named in the notice.
- **The menu.** A row carries no buttons. Right-click it, or long-press on a phone, and the menu opens with everything a row can be told to do. Deleting is on that menu and never happens on the spot: it opens a confirmation, and what it confirms is a move to the vault's trash.
- **Task counts.** With **Task counts** switched on in the settings, a note that holds tasks shows `1 / 7` after its name, open over total, at the row's right edge; a note without tasks shows nothing. The figure comes from Obsidian's own metadata, so a large vault costs no extra reads, and a box with a space in it is open while any other marker counts as done, the same rule the task ribbon uses. A note whose boxes are not work — a reading list, a packing list — can decline its figure with `schreibstubeTaskCount: false` in its frontmatter: its row shows no count, and its tasks stay out of a pinned tag's sum too, though it is still listed under the tag.

A footer along the bottom names the vault and holds the two ways out of a pane that is not behaving: help, and the plugin's settings.

The context menu is the pane's own, in a fixed order: open (in place, in a new tab, or on the desktop in a new window), icon and the two marks, sync, create, move, rename, rename from content and delete. Items other plugins contribute land behind one **More actions** entry at the end rather than in blocks between the actions — the pane fires Obsidian's `file-menu` event, so a plugin that adds to the file explorer's menu adds to this one without knowing the pane exists.

The sync actions are why the menu is worth owning:

| On a note             | Does                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| Bind to a source      | Validates the URL and writes `schreibstubeSyncedFrom` into the note's frontmatter |
| Check source now      | Fetches that one note, whether or not it is open, ignoring the minimum interval   |
| Open source           | Opens the raw Markdown the note mirrors                                           |
| Remove source binding | Drops the frontmatter key and the stored baseline                                 |

On a folder, **Copy path for Schreibstube** puts its `vault://` URL on the clipboard, which is how a folder bookmark is written without typing a path out by hand.

On a folder, **Check every bound note here** refreshes the mirrors under it, which is the difference between refreshing one project and polling a vault of a thousand notes.

#### Image tiles

A folder of pictures is a list of names in the tree, and the name of a picture says almost nothing. Right-click a folder that holds pictures (long-press on a phone) and choose **Images as tiles**: a tab opens in the main area with the folder's own pictures as a grid — its own, not its subfolders', so a photo archive with a folder per year shows one year at a time. While the tab is open it follows the pane: press another folder in the tree and the grid shows that one, without taking the focus from the tree. Close the tab and the following stops. **Explorer: this note's folder as tiles** does the same for the folder of the note in front of you.

A tile opens its picture in the tiles tab itself, so the Back arrow returns to the grid; a modifier click (Cmd or Ctrl) opens it in a new tab instead, for the two side by side. A right-click or long press on a tile gives the file's own menu, so a picture can be renamed from what it shows, moved or deleted without first finding it in the tree. The grid draws up to 400 pictures and says how many more there are; pictures are loaded as they scroll into view, so a large folder opens at once.

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

| Line                   | Meaning                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `# Heading`            | A folder                                                        |
| `## Heading` and below | A folder inside the one above it, at any depth                  |
| `- [Name](url)`        | A bookmark                                                      |
| `- [[Note]]`           | A bookmark to a note, with an optional `#Heading` and `\|label` |
| `- [ ] [Name](url)`    | A bookmark too: the task box is left out                        |
| Anything else          | Ignored                                                         |

| Scheme                | Opens                                              |
| --------------------- | -------------------------------------------------- |
| `https://`, `http://` | The page in the default browser                    |
| `obsidian://`         | The Obsidian URI                                   |
| `vault://path`        | Reveals that folder in this pane, ancestors opened |
| `note://linkpath`     | The note                                           |
| No scheme             | The note, as in `[Name](Folder/My%20Note.md)`      |
| `www.`                | The page, as if it began with `https://`           |

A bookmark wears one of three icons, all in grey: the globe for a web link; for an `obsidian://` link that calls a plugin, such as `obsidian://pythia?…`, that plugin's icon, the one on its ribbon button or else the one its commands carry; and for everything else — a note, a folder, a link Obsidian answers itself such as `obsidian://open`, a plugin without an icon — Obsidian's library icon. A link without a scheme is what Obsidian writes for a note when wikilinks are turned off, and it is read relative to the bookmarks file, as Obsidian reads it. Any other scheme is dropped while the file is read, so a `javascript:` line pasted into a synced file never becomes a row that can be tapped. A link to a heading or a block — `[[Note#Goals]]`, `[Goals](Note.md#Goals)` — opens the note there. The file is read within a budget: the first 256 KB, lines of up to 4,096 characters and 2,000 bookmarks; past that the pane shows what it read and leaves a warning in the developer console.

Right-click a folder anywhere in Obsidian and choose **Copy path for Schreibstube** to get its `vault://` URL, ready to paste into the file. **Open bookmark** searches the list by name, folder or URL from the command palette, in the order the file has them.

#### Updated externally

The notes whose Document sync source changed and whose update is still to be taken, newest first, all of them: no update is held back by a count. A note created or edited in the vault is not listed: Obsidian's own recent files already show that, and what the pane can say that nothing else does is that something outside the vault moved a note. The section has no settings of its own; it appears when **Document sync** is turned on in the settings and is gone when it is off.

Icons and the two marks live in `explorer.json` inside the plugin folder, deliberately not in `data.json`: that file is rewritten whole on every save, so a second device would clobber it. Each entry carries its own timestamp and every write re-reads and merges per entry, so two devices editing different files both keep their change. The pane also watches the file for writes delivered by iCloud, Obsidian Sync or Git while it is open. A file that moves keeps its icon; one that disappears keeps it for thirty days, in case it turns up somewhere else under the same name.

### Search by meaning

A small language model (multilingual MiniLM, the same one Pythia uses) runs on the device and reads each note once into an index kept in the plugin's folder; no note and no query leaves the device, and the model itself is downloaded the first time, about 120 MB on a desktop and 75 MB on a phone, where a Latin-script cut of it is used. Switch it on under **Search by meaning** in the settings. The first build starts when the Explorer search is first used, or with **Build now**, and takes a few minutes on a desktop; the status line there says how far it is. **Most notes to index** caps it at the newest notes, 5 000 by default.

Two downloads happen the first time, and nothing else is fetched. The runtime that runs the model, a 14 MB WebAssembly file, comes from this plugin's own GitHub release, the same release you installed. It is kept beside the plugin and checked against the hash this version expects, after the download and at every start; a file that does not match is not used. The model itself comes from Hugging Face ([Xenova/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) on a desktop, its Latin-script cut [smsag007/paraphrase-multilingual-MiniLM-L12-v2-latin](https://huggingface.co/smsag007/paraphrase-multilingual-MiniLM-L12-v2-latin) on a phone) and is kept in Obsidian's browser cache. The model is fetched at one fixed commit of its repository, and every file is checked against the length and hash this version of the plugin expects before it is used; a file that does not match is not used, and the status line says so. `SECURITY.md` has the details.

After that the index follows the vault: an edited, created, moved or deleted note is read again on its own, a couple of seconds after the vault goes quiet. The note being written is held back until you leave it — on a desktop, also once you have stopped typing for half a minute — so a phone does not re-read it on every autosave, nor load the model for every pause. A desktop catches up at launch with what changed while it was closed, including edits synced from a phone. A note with `schreibstubeIndex: false` in its frontmatter is left out.

#### On a phone

iOS ends Obsidian when it holds more than about 2 GB, and it does so without a message: the app simply restarts, and if the cause comes back at every start, it restarts every few seconds. The language model is the largest thing Schreibstube loads, so on a phone it is kept to what you ask for:

- **The phone reads the desktop's index; it does not build one.** The desktop embeds the vault and the index reaches the phone by sync. **Build now** on a phone adds a limited number of notes and stops.
- **The phone embeds only what you wrote on it.** A note you typed into is read again when you move on to another note. A note that changed any other way — synced from the desktop, changed by another plugin — is left to the desktop, whose row arrives with the next sync.
- **Nothing loads the model at launch.** It loads when you search by meaning, focus the Explorer search, or leave a note you edited — never while Obsidian is starting.
- **One model at a time.** While another plugin that runs a language model of its own is switched on — today that is **Similarity** — search by meaning pauses on the phone, and the settings name that plugin. Two models together pass the 2 GB. Switch the other plugin off on the phone to search by meaning there; on a desktop both run side by side. Pythia asks Schreibstube for its model and loads none of its own, so it does not count. Any other plugin that loads a model of its own has to be added to Schreibstube's list (`src/services/semantic/model-plugins.ts`); until it is, the two together will restart Obsidian on a phone.
- **Two restarts, then a pause.** If iOS ends Obsidian twice in a row while the model is working, the phone stops using the model on its own: searches find by words only, and edits wait for the desktop. The settings say so, and **Build now** tries again.

Recommended is not affected by any of this: it compares vectors already in the index and never loads the model.

If Obsidian on a phone restarts over and over, switch **Search by meaning** off in the Schreibstube settings as soon as it is up, and look for another plugin that runs a model of its own.

### Recommended

The notes, pictures and conversations that belong with the one in front of you, opened with **Recommended** in the palette or from a note's menu in Schreibstube Explorer. **Recommended** in the Explorer settings puts them in the right sidebar (the default) or under the note, where it ends — while editing and in Reading view alike, following the note when it switches between the two. From the palette it follows whatever note is open, so the answer is already on screen by the time the question occurs to you; asked for from a note's menu it stays on that note instead.

The links answer at once, and nothing is downloaded or sent anywhere for them. A vault is a graph somebody built by hand, and every link, tag and folder is a person having already said that two notes belong together — so the ranking reads the link graph Obsidian has already resolved and costs no file reads at all. It works the same on a phone as on a desktop.

Five signals, in the order they are worth anything:

| Signal            | What it means                                               |
| ----------------- | ----------------------------------------------------------- |
| A link either way | Somebody wrote it deliberately, about these two notes       |
| A shared link     | Both notes point at the same third note                     |
| Co-citation       | The same third note points at both — how siblings are found |
| A shared tag      | A deliberate label, but about a group rather than this note |
| The same folder   | The weakest, and only ever a tiebreak                       |

A picture's [description note](#picture-descriptions) counts as the picture here: its links and tags relate the picture, and the list shows the picture's card, never the note beside it.

With [Search by meaning](#search-by-meaning) switched on, a moment later the list gains what reads alike: notes nobody linked, marked **similar in meaning**, pictures whose descriptions are about the same thing, and conversations from Pythia about it. They come from vectors already stored, so no model is loaded to draw them, and the two answers are merged by rank, with a note you linked keeping its place above one that merely sounds similar. A note not yet in the index has only its links to offer.

What reads alike is read from where you are in the note, not from its opening. In the sidebar it follows the section the cursor is in: move to another section and rest there for a moment, and the list is ranked for that part of the note, while each section's list is kept for as long as the note is open. Under the note it is ranked from the note's end, where it is read. In Reading view the sidebar ranks from the note's opening, as there is no cursor to follow. This costs a phone nothing more: the same number of passages is compared either way, and no model is loaded for it. Pressing a conversation opens it in Pythia.

Notes, pictures and conversations are one list, most relevant first, without a heading per kind: a conversation that is the best answer comes first, and a picture sits where its relevance puts it, as a card with its thumbnail. **Number of recommendations** in the Explorer settings sets how long the list is, 7 unless you choose between 1 and 30.

Every shared thing is weighted by how rare it is, which is the whole difference between this working and not. An index note linking to four hundred notes would otherwise make all four hundred related to each other and answer every question with the same five rows; a note linked by exactly two says a great deal about those two.

Each entry leads with what it is — the icon the Explorer gives the file, Pythia's mark for a conversation — and says why it is on the list, because a related note nobody can explain is one nobody trusts. The order is the ranking, so the entries carry no numbers. A press opens the note, a press with Cmd or Ctrl opens it in a new tab — with Alt as well beside it, with Alt and Shift in a new window — and a right-click or long press gives the pane's own menu. At its end, three bars say how relevant the entry is; they stand in one column down the list, and a picture's thumbnail comes after them, at the far end. Under the pointer an entry also offers two buttons just before its bars: one copies its Obsidian URL (for a conversation, Pythia's link to it), the other opens a file in a pane to the right. On a phone they are always shown. They lie over the end of a long title rather than take room from it, and the title fades out beneath them. Under a note the heading counts the list in the same pill the Explorer counts tasks in, and a press on it folds the list away until the next note. A note nothing links, tags or files beside anything else gets an empty list saying so, rather than one padded with the rest of its folder.

### Link open modes

Control where internal links open, indicated in the status bar:

- **Links: switch side** — moves from normal to left to right and back to normal; left and right open links in a reused side split pane

Clicking the indicator in the status bar moves on the same way.

### Task summary

Turns a long note with checkboxes into a progress view without any extra state in the tasks themselves.

- **Insert: task summary** — inserts a ` ```schreibstube-tasks ` block at the cursor. The block renders as a one-line ribbon, e.g. **20** open of **21**, counting every task in the note.
- While the note contains the ribbon block, every heading that owns tasks shows a muted badge such as `3 of 3 open`. A heading counts only the tasks directly beneath it, up to the next heading of any level; tasks under a sub-heading belong to that sub-heading.
- Ribbon and badges update as soon as a checkbox is toggled. Badges stay visible when a heading is folded.
- `[ ]` is open; any other marker (`[x]`, `[-]`, `[~]`, …) counts as done. Tasks inside fenced code blocks are ignored.
- **Tidy up done tasks** — clears the done tasks of the open note out of the way, the way **Done tasks** in the settings says: to the end of their list, under a `## Archive` section at the end of the note, or out of the note. Here only `[x]` and `[-]` count as done. A task moves with everything indented under it, and a done task with a sub-task still open stays where it is. In archive mode a done sub-task stays with its open parent. The notice afterwards offers **Undo**, and the editor's own undo takes the change back in one step.

The badges appear in Live Preview and Source mode. The ribbon also renders in Reading view.

A task can carry more than its first line: a paragraph typed with Shift+Enter, a note under it, sub-items — anything indented deeper than the task's own marker. While the task is open that text stays in view. Tick the task and it folds away, leaving the first line; untick it and it comes back. In the editor this is an ordinary fold, so the fold indicator opens a done task by hand and it stays open until its state changes again. Tasks that are already done when a note opens are folded from the start. In Reading view there is no folding, so the body is hidden instead. This works in every note, with or without the ribbon.

#### Summarising an attached PDF

A note that embeds or links a PDF can be summarised from it. Run **Insert: summary from the attached PDF**: the PDF's text is read, its passages are offered in document order, and the ones you tick are written at the cursor. Each one ends with a small mark — `↗` — which opens the PDF at the page that passage came from, the way a footnote leads to its source.

```markdown
Die Auswertung zeigt einen Rückgang von 12 % [[Bericht.pdf#page=12&selection=4,0,6,31|↗]]
```

The mark is an ordinary Obsidian link, written in whatever form the vault is set to use. Nothing renders it and nothing has to be installed for it to work: it survives sync, works in Reading view, and still opens the right page in a vault where this plugin is switched off.

Two things are worth knowing. The page is the physical page, counted from the front, which a document with roman-numbered front matter will not agree with what is printed on the paper. And the precise part of the mark — the `selection` — belongs to the file as it was read; replace the PDF with a fresh export and the mark still opens the right page, but the sentence it highlights may have moved.

A scanned PDF has no text layer, so there is nothing to read and the command says so rather than opening an empty list. Documents longer than 200 pages are read up to that point, and the notice says how much was covered.

### Commands

Commands are named after what they act on, so related ones sort together in the palette: `Notiz …` for the note in front of you (`Notiz korrigieren`, `Notiz drucken`, `Notiz aktualisieren`), `Einfügen: …` for what goes into it, `Fokus: …`, `Explorer: …` and `Links: …` for the view. Things done once or rarely — adding a print template, opening the published site — are buttons in their settings section rather than commands. Each settings section names the commands its feature brings on the line under what it does, so switching something on and learning what to type is one page rather than two; a section whose feature asks the AI carries a **KI** pill.

A command that cannot do anything where you are is not offered at all: the image rename without a picture open, `Notiz aktualisieren` on a note bound to nothing, `Einfügen: KI-Zusammenfassung der Auswahl` with nothing selected, `Explorer: Ordner zuklappen` with the pane closed. Only conditions visible on screen hide anything — a command that needs a setting filled in stays listed and says so when it is run, because a command missing for a reason three tabs away reads as a plugin that broke.

## Settings

### Heading stack

| Setting                      | Description                                 | Default |
| ---------------------------- | ------------------------------------------- | ------- |
| Enable heading stack overlay | Show or hide the sticky ancestor breadcrumb | On      |

### Focus mode

| Setting                        | Description                                                                                                                                     | Default |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Dim opacity                    | Opacity of out-of-focus lines (0.2 faint – 0.8 nearly full)                                                                                     | 0.4     |
| New note from outside Obsidian | **Copy link** copies this vault's `obsidian://schreibstube-new-doc` link; see [New note from outside Obsidian](#new-note-from-outside-obsidian) | —       |

### Icons in the text

- **Draw :folder: as the icon** — on by default. Off, the picker stays closed and shortcodes read as text.

### Properties

| Setting                          | Description                                                                                            | Default      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| Date format                      | How today's date is written into text: `YYYY`, `MM`, `DD`, `MMMM` (month), `dddd` (weekday), `[text]`  | `YYYY-MM-DD` |
| Suggest tags beside Add property | Show the **Suggest tags** control at the foot of every note's properties; the command works either way | On           |

### Sums and formulas

| Setting            | Description                                                                        | Default   |
| ------------------ | ---------------------------------------------------------------------------------- | --------- |
| Number format      | How an ambiguous number such as `1.234` is read, and how results are written       | Automatic |
| Default currency   | The currency numbers without one count in, and mixed currencies are converted into | None      |
| Convert currencies | Convert mixed currencies at the ECB's daily rates, fetched when a total needs them | Off       |
| Exchange rates     | The day of the rates kept, and a button to fetch today's                           | —         |

Automatic follows Obsidian's language — `1.234,56` for German, `1,234.56` for English, `1 234,56` for French.

### Schreibstube Explorer

| Setting                  | Description                                                                   | Default             |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------- |
| Items from other plugins | Where contributed menu items go: behind "More actions", inline, or not at all | Behind More actions |
| Bookmarks section        | Show the bookmarks list above the file tree                                   | On                  |
| Bookmarks file           | Vault path of the Markdown file the bookmarks are read from                   | `bookmarks.md`      |
| Icon set                 | Which icon set is bundled, and how many icons it holds                        | Tabler Icons (MIT)  |

### Search by meaning

| Setting             | Description                                                    | Default |
| ------------------- | -------------------------------------------------------------- | ------- |
| Search by meaning   | Let the Explorer search also find notes by what they are about | Off     |
| Most notes to index | How many of the newest notes are read, between 100 and 20 000  | 5 000   |
| Status              | Where the index stands; **Build now** finishes or updates it   | —       |
| Rebuild             | Read every note again from scratch                             | —       |

### AI models

Provider, model, and API key are shared by every AI command (rename, summarize, and AI table).

Without a key the AI is left out everywhere rather than refusing when asked: the AI commands are not in the palette, the right-click entries for an AI table, for renaming from the content and for describing pictures are not on the menus, the picture bar offers no description to write, and **Read correction** in the review panel is greyed out with a line saying where the key goes — the glossary check beside it works without one. The settings that need the AI stay visible but greyed, and the AI section says what comes back once a key is chosen. Choosing one brings everything back at once; a command already placed in the mobile toolbar stays there and does nothing until then.

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
| Term folder                           | One note per term; see _A term folder_ above    | —       |
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
| AI descriptions    | Have the AI write a note's empty description at publish, into the note                                | On              |
| Frontmatter fields | Which key carries which meaning — published, title, date, description, slug, and the two written back | the plain names |

The token is deliberately separate from the mail token, so a leaked publish token cannot reach the mailbox. **Verbindung testen** proves the token, the target, the SSH login, the host key and the web root in one request, without writing anything.

The bridge URLs sync with the vault; the tokens stay on the device. Each device remembers, outside the vault, the bridge it sent each token to, and asks before sending it to any other — the first time, and whenever the settings name a new address. Someone who can edit a shared vault can change the URL, but not where your device sends its token without you agreeing.

What is uploaded of a note is what the site shows: its frontmatter and its `%%comments%%` stay in the vault, since the bridge keeps a copy of every note it renders. A plan that would overwrite a file on the web host that Schreibstube did not write lists it and publishes nothing; remove the file or let the bridge take it over (`PUBLISH_<TARGET>_ADOPT_EXISTING`).

### Printing

| Setting          | What it does                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Enable printing  | Off until you switch it on. Switching it on is what fetches the ~35 MB typesetter.          |
| Default template | What a note that names none is printed with: Standard (built in), a vault template, or ask. |
| Templates folder | Where a new template is suggested. Templates are found anywhere. Default `Vorlagen/Druck`.  |
| Output folder    | Where a PDF is written. Empty means beside the note it came from.                           |
| The typesetter   | Whether it is on this device, with a button to fetch or remove it.                          |

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

To check that the files are the ones this repository's release workflow built
from the tagged commit, before you copy them:

```bash
gh attestation verify main.js -R smsag/schreibstube
```

The build is reproducible too: `npm ci --ignore-scripts && npm run build` at
the release's tag gives a `main.js` with the same SHA-256. See
[`SECURITY.md`](SECURITY.md#how-a-release-is-made-and-how-to-check-one).

## Development

```bash
npm run setup     # the plugin's dependencies and the bridge's
npm run build     # production build
npm run dev       # watch mode
npm test          # run tests, plugin and bridge
npm run check     # the whole gate: lint, format, tests with coverage, build
```

The suite covers the bridge, which keeps its own dependency tree, so `npm install`
on its own leaves `npm test` unable to run. `npm run setup` installs both.

The icon font is generated, not hand-edited. Add a name to `scripts/icon-set.mjs` and run:

```bash
npm install --no-save @tabler/icons-webfont
pip install fonttools brotli picosvg
npm run build:icons
```

That subsets the font to the names in the list, adds our own glyphs (the Schreibstube and Pythia logos, from `assets/`) and writes `src/ui/icon-font.generated.ts`, which is committed — a normal build needs neither the font package nor Python. Icons are stored by name, never by codepoint, so a font upgrade that moves a glyph changes the generated map instead of every vault's icons.

Tabler Icons is MIT licensed; see `LICENSE` in `@tabler/icons-webfont` for the notice.
