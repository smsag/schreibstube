# Schreibstube

A writing-focused Obsidian plugin: a sticky heading-stack overlay, a distraction-reducing focus mode, LLM-powered file renaming, and side-pane link opening.

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

### Rename file from content

| Setting | Description | Default |
|---|---|---|
| LLM provider | Anthropic or OpenAI | Anthropic |
| Model | Model for the selected provider | Claude Haiku 4.5 |
| Custom model ID | Optional override for a newer or unlisted model | — |
| Max image size | Maximum image dimension (px) sent to the model | 768 |
| API key | Stored in Obsidian's native secret storage | — |
| Minimum content length | Notes shorter than this are skipped | 50 chars |
| Maximum content sent to LLM | Characters from the note sent to the API | 4 000 chars |
| Maximum filename length | Generated name is truncated to this | 60 chars |

API keys are stored in Obsidian's built-in secret storage and are never written to the plugin data file.

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
