# Schreibstube

An Obsidian plugin with two writing-focused features: a sticky heading-stack overlay and an LLM-powered file rename command.

## Features

### Heading stack overlay

Keeps a sticky, context-aware heading breadcrumb at the top of the active note as you scroll. Shows the ancestor headings above the current viewport position. Click or hover an ancestor to expand its siblings and jump to any heading in the same level.

### Rename file from content

Assigns a filename to the active note based on its content. Trigger the command **Schreibstube: Rename file from content** via the command palette or a keyboard shortcut — the note's content is sent to an LLM and the file is renamed with the result.

The command does nothing if the note is shorter than the configured minimum length, or if no API key has been set.

## Settings

### Heading stack

| Setting | Description | Default |
|---|---|---|
| Max visible rows | Maximum rows shown in an expanded sibling list | 6 |

### Rename file from content

| Setting | Description | Default |
|---|---|---|
| LLM provider | Anthropic, OpenAI, or Google | Anthropic |
| Model | Model for the selected provider | Claude Haiku 4.5 |
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
