# Schreibstube

Schreibstube is an Obsidian plugin that keeps a sticky, context-aware heading stack at the top of the active note.

## Development

1. Install dependencies: `npm install`
2. Build once: `npm run build`
3. Watch mode: `npm run dev`
4. Run logic tests: `npm test`

Copy `main.js`, `manifest.json`, and `styles.css` into your vault plugin folder:

`<Vault>/.obsidian/plugins/schreibstube/`

## Manual QA

- Checklist: `docs/QA.md`
- Fixture note: `docs/fixtures/Long Structured Note.md`
- Architecture: `docs/ARCHITECTURE.md`
- Release checklist: `docs/RELEASE.md`
- Changelog: `CHANGELOG.md`

Use the checklist with the fixture note in both edit and reading modes, including touch behavior on mobile.
