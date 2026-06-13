# Changelog

All notable changes to this project will be documented in this file.

## 1.1.10 - 2026-06-13

### Fixed

- **Rename file from content** command is now visible in reading mode, when a side panel has focus, and on mobile. It previously used `editorCallback` which only registers the command while an editor is focused; it now uses `callback` like the image rename command.

## 1.1.9 - 2026-06-12

### Fixed

- **Directional link-open now works in Live Preview (edit mode).** In Live Preview, CodeMirror renders links as span decorations and calls `workspace.openLinkText()` directly, bypassing the DOM click handler that covered Reading mode. The plugin now also patches `openLinkText` at load time so both view modes are intercepted correctly.

## 1.1.8 - 2026-06-12

### Added

- **Directional link-open commands** — three new commands for focused reading sessions:
  - **Open links to the left** — while active, every internal link you click opens in a vertical split to the left; focus returns to your reading pane automatically.
  - **Open links to the right** — same, but right.
  - **Open links normally** — restores Obsidian's default behaviour.
  - The side pane is reused for subsequent clicks (no pane accumulation). Links with heading or block subpaths (`[[Note#heading]]`, `[[Note^block]]`) scroll to the correct position.
  - A status-bar chip (`← links` / `links →`) shows which mode is active.

## 1.1.7 - 2026-06-12

### Fixed

- **API errors now show the actual provider message.** Previously, any 4xx/5xx response from Anthropic, OpenAI, or Google was surfaced as a generic "could not reach the LLM API" notice. The response body is now included so the real reason (wrong key, quota exhausted, unsupported model, etc.) is visible in Obsidian.

### Improved

- Removed dead code left over from the stack-only overlay refactor (1.0.1): unused interaction state interfaces, no-op collapse reducers, `isTouchDevice()`, the global `pointerdown` listener, and the `overlayMaxVisibleRows` setting that controlled sibling lists that no longer exist.

## 1.1.6 - 2026-06-12

### Added

- **Rename image from content** command — works the same as the existing text rename, but for images open in Obsidian. The image is resized to a configurable maximum dimension (default 768 px) before being sent to the LLM, keeping costs low. All vault links to the file are updated automatically.
- New **Max image size** setting (256–2048 px) under _Rename file from content_ in Settings.
- Supported formats: jpg, png, gif, webp. SVG and BMP are not supported by vision APIs and show a notice.

## 1.1.5 - 2026-06-12

### Fixed

- **Dim opacity setting had no effect.** The settings tab was missing the **Dim opacity** slider entirely, leaving `focusDimOpacity` stuck at its default (0.4) with no way to change it through the UI. The slider is now present under the overlay settings.

## 1.1.4 - 2026-06-09

### Fixed

- Focus mode commands (**Focus Mode: Sentence**, **Focus Mode: Paragraph**, **Focus Mode: Disable**) were missing from the command palette — restored after being dropped during the 1.1.1 merge rewrite.

## 1.1.3 - 2026-06-09

### Fixed

- API key is now configured using Obsidian's native `SecretComponent`. The settings field shows a proper secret picker — users select or create a named secret rather than pasting a raw key. The plugin stores only the secret name; the actual value is retrieved from `SecretStorage` at runtime and never exposed in the UI.
- `minAppVersion` bumped to `1.11.4` (minimum required for `SecretComponent`).

## 1.1.2 - 2026-06-09

### Improved

- API key settings UI overhauled: when a key is stored it shows a status indicator with **Replace** and **Clear** buttons — the actual key value is never displayed. When no key is stored a plain password input appears; saving happens on blur and the view refreshes automatically.
- Stale `feat/llm-rename-file` and `schreibstube-main` remote branches removed.

## 1.1.1 - 2026-06-09

### Fixed

- Paragraph focus mode no longer treats an entire Markdown list as one block. Each list item is now its own focus unit, so sibling items are dimmed correctly.

## 1.1.0 - 2026-06-09

### Added

- **Rename file from content** command: trigger via command palette or keyboard shortcut to have an LLM generate a filename from the active note's content and rename the file in-place.
- Supports Anthropic (Claude Haiku 4.5, Claude Sonnet 4.6), OpenAI (GPT-4o mini, GPT-4o), and Google (Gemini 1.5 Flash, Gemini 1.5 Pro) as LLM providers.
- API keys stored in Obsidian's native SecretStorage — never written to plugin data.
- Configurable minimum content length (default 50 chars), maximum content sent to LLM (default 4 000 chars), and maximum filename length (default 60 chars).
- All failure paths (no key, API error, empty result) surface a Notice.

### Improved

- Settings: number inputs now save on blur instead of on every keystroke.
- `focus-settings.test.ts` moved to `src/services/` to match co-location convention.
- Added 23 unit tests covering `sanitizeFilename` and `normalizeSettings`.
- README rewritten to document both plugin features with a settings reference table.
- `.gitignore` extended to cover `*.map`, `Thumbs.db`, and `.claude/`.

## 1.0.2 - 2026-06-02

### Fixed

- Paragraph focus mode no longer treats an entire Markdown list as one block. Each list item is now its own focus unit, so sibling items are dimmed correctly.

## 1.0.1 - 2026-06-02

### Changed

- Restored deterministic stack-only headline overlay behavior in Live Edit.
- Removed hover and sibling expansion behavior; click/tap now navigates directly.
- Aligned overlay host mounting with the original Headway implementation for reliable Live Edit rendering.
- Improved iOS behavior with safe-area notch padding for the top stack row.
- Updated local docs for current stack-only behavior and release flow.

### Fixes

- Fixed cases where no heading stack appeared in Live Edit after reopening/re-activating the plugin.
- Fixed iOS regressions causing stuck/flickering scroll behavior.

### Release

- BRAT-ready release artifacts: `main.js`, `manifest.json`, `styles.css`.

## 1.0.0 - 2026-06-02

### Changed

- Plugin identity renamed from Headway to Schreibstube.
- Focus mode naming aligned to sentence and paragraph semantics.
- iOS-focused behavior fixes and styling updates for overlay and focus visuals.
- Repository hardened for distribution with docs excluded from Git tracking.

### Release

- First stable public release for BRAT installation.

## 0.1.1 - 2026-06-01

### Added

- MIT license file (`LICENSE`).

### Changed

- Release metadata bumped from `0.1.0` to `0.1.1` in manifest and package metadata.
- Added `0.1.1` compatibility mapping in `versions.json`.

## 0.1.0 - 2026-06-01

### Added

- Initial Obsidian plugin scaffold with TypeScript + esbuild build pipeline.
- Sticky heading ancestor overlay for active Markdown notes.
- Edit mode and reading mode integration.
- Click/tap navigation to headings from overlay rows.
- Desktop hover expansion for ancestor levels.
- Touch interaction model:
  - first tap expands
  - second tap navigates
  - outside tap collapses
- Parent-scoped sibling resolution with configurable row cap.
- Theme-aware overlay styling.
- Settings tab with `overlayMaxVisibleRows` (3-20).

### Architecture

- Extracted runtime bootstrap registration, scheduler, overlay coordinator, reading navigator, and pure interaction reducers into dedicated services.
- Added architecture documentation in `docs/ARCHITECTURE.md`.

### Quality

- Added unit tests for heading parsing, ancestor/sibling resolution, interaction reducers, reading mapping/navigation, refresh scheduler, host/coordinator lifecycle, and settings normalization.
- Added QA checklist and fixture note for manual validation.
