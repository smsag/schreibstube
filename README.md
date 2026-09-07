# Schreibstube

A writing-focused Obsidian plugin: a sticky heading-stack overlay, a distraction-reducing focus mode, LLM-powered file renaming, email send/query/merge over IMAP and SMTP, and side-pane link opening.

## Features

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

### Email (IMAP/SMTP)

Send notes as email and pull messages back into your vault — on desktop **and** mobile.

- **Send note as email** — recipients and subject come from the note's frontmatter; the body is the note with its frontmatter stripped. A confirmation dialog shows what is about to be sent.
- **Query mailbox** — search by sender, subject, full text or date, then insert the chosen message into the active note.
- **Fetch replies into note** — find replies to a note you sent and append the new ones. Re-running the command only ever adds what is new.

The note's frontmatter is the contract:

```yaml
---
to: kunde@example.com
cc: [innendienst@example.com]
subject: Angebot Objekt 4711
message_id: <7f3a…@your-domain.de>      # written on send
sent_at: 2026-09-07T10:12:00.000Z       # written on send
merged_ids: ["<reply-1@mail.kunde.de>"] # written on merge; keeps merging idempotent
---
```

`message_id` is what ties replies back to the note, so **Fetch replies** only works on notes that were sent from Obsidian.

#### The bridge

Obsidian on mobile runs in a WebView with no Node runtime and no raw sockets, so the plugin cannot speak IMAP or SMTP itself. Instead it talks HTTPS to a small self-hosted bridge that does — see [`bridge/README.md`](bridge/README.md) for the API, configuration, and Sliplane deployment steps.

Two consequences worth knowing:

- The plugin needs **no Node dependencies** and stays available on mobile.
- Your **mailbox password lives on the bridge**, not in the vault. The plugin only stores a bridge token, which you can rotate without touching the mailbox.

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

### Email

Requires a deployed bridge — see [`bridge/README.md`](bridge/README.md).

| Setting | Description | Default |
|---|---|---|
| Bridge URL | Base URL of your bridge. Must be `https://` unless it is localhost | — |
| Bridge token | The bridge's `BRIDGE_TOKEN`, stored in Obsidian's secret storage | — |
| From address | Optional override for the bridge's `MAIL_FROM` | — |
| Mailbox | IMAP mailbox searched by the query and reply commands | INBOX |
| Maximum results | How many messages a search returns (newest kept) | 25 |
| Merge heading | Heading that fetched replies are appended under | Correspondence |

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
