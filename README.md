# Schreibstube

A writing-focused Obsidian plugin: a proof-read review sidebar with glossary support, a sticky heading-stack overlay, a distraction-reducing focus mode, LLM-powered file renaming, and side-pane link opening.

## Features

### Proof-read sidebar

Opens a side pane that reviews the active note and proposes changes one at a time. Nothing is written to the note until you accept a change.

- **Open proof-read sidebar** — show the panel
- **Proof-read note** — send the note for correction and fill the queue
- **Check note against glossary** — local glossary check, no API call

Each card shows the change as a word-level diff, with **Übernehmen**, **Verwerfen**, and **Anzeigen** to jump to the place in the note. **Alle übernehmen** applies the whole queue as a single undo step.

What the correction pass will not touch: frontmatter, fenced code blocks, tables, and math blocks are excluded entirely. Inline code, wikilinks, link targets, tags, and bare URLs are masked before the text is sent and restored afterwards; if a response comes back having lost one of them, that section is discarded rather than applied.

If you edit the note while the queue is open, cards whose text can no longer be located are marked *veraltet* instead of being applied to the wrong words.

### Glossary

A glossary is an ordinary note with `schreibstube-glossary: true` in its frontmatter and a term table. Glossary checks run locally and need no API key, so the panel is useful before any provider is configured. The selected glossary is also passed to the correction pass as a constraint, so a rewrite does not undo a term the glossary just enforced.

The term model follows TBX-Basic (ISO 30042): a concept groups several terms, and each term carries an administrative status.

| Status | What the panel does |
|---|---|
| `preferred` | Offered as the replacement for other terms in the concept; flagged only when written in the wrong case |
| `admitted` | Acceptable usage, never flagged |
| `deprecated` | Flagged, with the preferred term offered when the concept has one |
| `superseded` | Flagged, never auto-fixed, because whether the newer term applies is a judgement call |

The TBX picklist identifiers (`deprecatedTerm-admn-sts` and so on) and the informal `notRecommended` and `obsolete` spellings are accepted too, so an export from a termbase tool can be pasted in.

```markdown
---
schreibstube-glossary: true
language: de
default-severity: error
---

| Concept   | Term         | Status     | Match | Note                    |
|-----------|--------------|------------|-------|-------------------------|
| objekt    | Objekt       | preferred  | word  |                         |
| objekt    | Immobilie    | deprecated | word  | Hausbegriff seit 2024   |
| objekt    | Liegenschaft | admitted   |       |                         |
| makler    | Broker       | deprecated | word  |                         |
| courtage  | Courtage     | superseded | word  | Vertragsabhängig        |
```

German column headers (`Konzept`, `Benennung`, `Status`, `Treffer`, `Hinweis`) work as well. A malformed row is skipped and reported in the panel rather than failing the whole file.

`Match` controls how a term is found:

| Mode | Behaviour |
|---|---|
| `word` (default) | Whole word, case-insensitive, tolerating German inflection endings so *Immobilien* matches *Immobilie* |
| `exact` | Case-sensitive, no inflection. Use when two spellings of one word are separate entries |
| `prefix` | Matches inside a compound, so *Broker* catches *Brokerbüro* |

When a match is an inflected form, the card is marked *Beugung prüfen*, because the replacement is the base form and the ending may need fixing by hand.

**Which glossary applies** is decided by the first of these that yields anything, with no merging between them:

1. A `glossary` property in the note's own frontmatter
2. A folder rule from settings, deepest matching folder first
3. The pick in the sidebar header, which lasts for the session
4. The vault-wide default in settings

### Heading stack overlay

Keeps a sticky, context-aware heading breadcrumb at the top of the active note as you scroll. Shows the ancestor headings above the current viewport position, so you always see where you are in the document's hierarchy. Click an ancestor to jump to that heading. The overlay can be turned off entirely in settings.

### Focus mode

Dims everything except the passage you are working on. Available as three commands:

- **Focus Mode: Sentence** — highlight only the current sentence
- **Focus Mode: Paragraph** — highlight only the current paragraph
- **Focus Mode: Disable** — turn focus mode off

The dim strength is configurable.

### Rename file from content

Assigns a filename to the active note or image based on its content:

- **Rename file from content** — the note's text is sent to an LLM and the file is renamed with the result.
- **Rename image from content** — the image (jpg, png, gif, webp; up to 10 MB) is resized and sent to a vision model, and the file is renamed.

The rename does nothing if the note is shorter than the configured minimum length, or if no API key has been set.

### Summarize selection

Select any text and run **Summarize selection** to send it to an LLM and replace the selection with the result. Built for turning raw text pasted from analytics and reporting tools into a running insight log: copy the numbers into a note, select them, summarize, and keep the distilled takeaway in place of the raw dump.

The summarize prompt is fully configurable in settings — a default tuned for the insight-log workflow is provided. The command uses the shared **AI models** configuration (provider, model, and API key).

### Link open modes

Control where internal links open, indicated in the status bar:

- **Open links to the left** / **Open links to the right** — open links in a reused side split pane
- **Open links normally** — restore default link behaviour

## Settings

### Heading stack

| Setting | Description | Default |
|---|---|---|
| Enable heading stack overlay | Show or hide the sticky ancestor breadcrumb | On |

### Focus mode

| Setting | Description | Default |
|---|---|---|
| Dim opacity | Opacity of out-of-focus lines (0.2 faint – 0.8 nearly full) | 0.4 |

### AI models

Provider, model, and API key are shared by every AI command (rename and summarize).

| Setting | Description | Default |
|---|---|---|
| LLM provider | Anthropic or OpenAI | Anthropic |
| Model | Model for the selected provider | Claude Haiku 4.5 |
| Custom model ID | Optional override for a newer or unlisted model | — |
| API key | Stored in Obsidian's native secret storage | — |

API keys are stored in Obsidian's built-in secret storage and are never written to the plugin data file.

### Rename file from content

| Setting | Description | Default |
|---|---|---|
| Max image size | Maximum image dimension (px) sent to the model | 768 |
| Minimum content length | Notes shorter than this are skipped | 50 chars |
| Maximum content sent to LLM | Characters from the note sent to the API | 4 000 chars |
| Maximum filename length | Generated name is truncated to this | 60 chars |

### Summarize selection

| Setting | Description | Default |
|---|---|---|
| Summarize prompt | System instruction telling the LLM how to summarize | Insight-log preset |
| Maximum response tokens | Upper bound on summary length (64–4096) | 512 |

### Proofreading

| Setting | Description | Default |
|---|---|---|
| Proofread prompt | System instruction for the correction pass | Correction-only German preset |
| Maximum response tokens | Upper bound per request (256–8192) | 2 048 |
| Characters per request | Prose sent per chunk (500–6000) | 2 000 |
| Parallel requests | Chunks in flight at once (1–4) | 2 |

### Glossary

| Setting | Description | Default |
|---|---|---|
| Default glossaries | Vault paths, one per line | — |
| Folder rules | One per line: `folder \| glossary.md, other.md` | — |
| Underline glossary hits in the editor | Marks error-severity terms while writing | Off |

### Diagnostics

| Setting | Description | Default |
|---|---|---|
| Debug logging | Log detailed diagnostics to the developer console (errors are always logged) | Off |

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
