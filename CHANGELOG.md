# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- **The publish frontmatter keys are configurable.** A vault that already names these fields its own way can map each role — published, title, date, description, slug, and the two written back after publishing — to the key it uses, under **Frontmatter-Felder** in the publish settings. The defaults are unchanged, so a vault that never touches this keeps working. A configured key replaces the default rather than adding to it; a blank field means "unchanged", and two roles cannot share a key, because the plugin would have no way to tell which meaning was intended.
- **Publishing: a vault folder becomes a website, from desktop and from mobile.** Three commands — **Veröffentlichen**, **Veröffentlichung prüfen** and **Website öffnen** — publish a folder as a static site over SFTP.
  - **Opt-in per note.** A note is published when its frontmatter carries `schreibstubePublished: true`; removing the flag takes the page down on the next publish. Title, date, description and slug come from frontmatter, each with a sensible default. After publishing, the time and the address are written back into the note.
  - **The bridge renders the Markdown**, so the output is identical from a phone and a laptop, can be snapshot-tested, and can be rebuilt months later without the vault. Wikilinks between published notes become site links; a link to an unpublished note degrades to plain text rather than a dead link. Callouts, footnotes, tables, definition lists, task lists, highlights, maths and Mermaid diagrams all render, and comments never reach the page.
  - **Images and video** referenced by a published note are uploaded under a content-addressed name, so a changed picture cannot be served from a cache.
  - **A plan before anything moves.** The confirmation dialog lists what will be uploaded and, in full, what will be deleted.
  - **Only what changed travels.** Sources are addressed by content, so an unchanged note is never uploaded twice and a renamed one uploads nothing at all. Re-publishing an untouched folder writes nothing.
  - **Deletions are safe by construction.** The bridge keeps a manifest of every file it wrote; a file it has never heard of is never touched. The manifest is written last, so an interrupted publish costs repeated work rather than a lost file.
  - **The hosting credentials stay on the bridge.** The vault holds a target name and a token, and the publish token is separate from the mail token. The host key is checked against a configured fingerprint.
- **Publish settings section** — bridge URL (falling back to the mail bridge), publish token in Obsidian's secret storage, and one entry per account with a connection test that proves token, target, SSH login, host key and web root in one request.
- **The bridge has tests.** 295 of them, covering configuration, routing, authorisation, the throttle, deadlines, the mail paths, the path rules, the manifest, the renderer and the whole publish flow. They run under the repository's own `npm test`: the mail paths use a fake SMTP transport and a fake IMAP client, and the publish flow drives a real SSH connection into a real SFTP server, so nothing reaches the network.
- **A CI workflow** runs the test suite and the production build on every pull request.
- **The plugin explains the bridge's new statuses** — throttled, restarting and timed out — instead of echoing the status code.
- **Email commands, working on mobile as well as desktop.** Three new commands:
  - **Send note as email** — addressing comes from the note's frontmatter (`schreibstubeTo`, `schreibstubeCc`, `schreibstubeSubject`), the body is the note with its frontmatter stripped. A confirmation dialog shows recipients and subject before anything leaves the vault. On success the assigned `schreibstubeMessageId` and `schreibstubeSentAt` are written back to the note.
  - **Query mailbox** — search IMAP by sender, subject, full text and date, then insert the chosen message into the active note.
  - **Fetch replies into note** — find replies to the note's own `schreibstubeMessageId` and append the new ones under a configurable heading. Every merged message is recorded in `schreibstubeMergedIds`, so the command is idempotent and can be run as often as you like without duplicating content.
- **Mail bridge** (`bridge/`) — a small, stateless self-hosted service that speaks IMAP/SMTP on the plugin's behalf. Ships with a Dockerfile and Sliplane deployment instructions.
- **Email settings section** — bridge URL, bridge token (in Obsidian's secret storage), optional From override, mailbox, result limit, and merge heading.

### Changed

- **A JSON request body that is not an object is refused as one**, rather than falling through to a field check and being reported as a missing field.
- **The bridge is now capability-based** (`bridge/` 2.0.0), in preparation for publishing. Each capability brings its own token, credentials and limits; a capability whose variables are absent is not offered, and a deployment that offers nothing refuses to start. One capability's token never opens another's routes.
  - **`BRIDGE_TOKEN` is now `MAIL_TOKEN`.** Rename it in your deployment before updating the bridge. Nothing changes in the plugin: the token is still sent as `Authorization: Bearer`.
  - **Errors carry a stable `code` and a `requestId`** alongside the message, so a report can be tied to a log line. Every log line about a request carries the same id.
  - **`/health` reports the bridge version, the protocol version and the capabilities offered**, so a bridge that was not redeployed alongside the plugin can say so instead of failing on an unknown route.
  - **New `/diagnostics` endpoint** opens a real connection with the configured credentials and reports each protocol separately.
  - **The token is now checked before the path**, so an unauthorised caller cannot map the bridge by probing for routes.
  - **Repeated authentication failures from one address are throttled**, then answered with a 429 and a `Retry-After`. The health probe stays reachable.
  - **Every outbound operation has a deadline** and every request a budget, so a connection that neither answers nor closes can no longer hold a request open until the client gives up.
  - **Shutdown drains in-flight requests** instead of cutting them off, so a redeploy is not a crash.
- Run the bridge as a single instance. Shared state such as the throttle lives in memory.

### Fixed

- **Duplicate correspondence sections.** A merge heading configured with stray whitespace never matched the section it wrote last time, so every "Fetch replies" run appended a fresh `## Correspondence` block.
- **A send is no longer reported as failed after the mail has gone out.** Persisting `schreibstubeMessageId` is now separate from the send itself: if it fails, the notice says the mail was delivered and shows the ID to add by hand, instead of inviting a re-send that would deliver a duplicate.
- **"Fetch replies" reports its own failures.** It previously had no error handling, so a failed write surfaced only as an unhandled rejection — with `schreibstubeMergedIds` unwritten, making the next run duplicate the replies it had already merged.
- **Merging no longer races the editor.** Replies are appended with an atomic read-modify-write, so a pending editor flush can no longer discard either unsaved typing or the merged replies.
- **The in-flight guard now spans the whole reply merge**, not just the search, so two overlapping runs cannot append the same replies twice.
- **Bridge: oversized requests return a readable 413** instead of dropping the connection, and the size is rejected from the declared `Content-Length` before any body is read.
- **Bridge: the search limit is clamped from both ends.** A negative or non-numeric `limit` previously inverted the result window, returning the oldest matches and far more of them than configured — each one fully parsed.

### Notes

- The plugin gains no new dependencies and remains available on mobile. Obsidian's mobile runtime has no Node and no raw sockets, so IMAP/SMTP cannot be spoken from the plugin; all mail traffic goes to the bridge over HTTPS via `requestUrl`, the same transport the AI commands already use.
- The mailbox password lives in the bridge's environment, never in the vault. The plugin stores only the bridge token, which can be rotated independently.
- Fetched message bodies are quoted when merged into a note, so email content cannot inject headings or lists into the note's own structure.
- Frontmatter keys follow the plugin-wide `schreibstube` prefix rule, so nothing the mail commands read can collide with another plugin's properties.

## 1.7.0 - 2026-09-11

### Added

- **Background poll for bound notes.** Every note bound to a source can be checked on a schedule, not just the one you have open. Changes found while a note is closed are counted, so opening it later surfaces them immediately, and a single summary notice reports how many notes changed rather than one notice per note.
  - The schedule is a five-field cron expression in local time, with lists, ranges, steps, and month and weekday names. Cron's OR rule for the two day fields is implemented, so `0 9 1 * 1` fires on the first of the month and on Mondays.
  - The settings screen validates the expression as you type and shows the next fire time, since a schedule cannot be verified by waiting for it.
  - Obsidian has no scheduler, so a poll runs only while the app is open. A schedule that came due while it was closed is caught up once shortly after the next start, which is what makes a daily poll usable on a machine that is not always on.
  - Requests are capped and the per-note interval still applies, so one tick never becomes a burst. State for the whole poll is written in a single save rather than once per note.
  - A poll that found changes has already advanced the validator, so the next interactive check fetches unconditionally. Without that the conditional request would answer "unchanged" and the update would be lost.
  - New command **Check all bound notes for updates** runs the poll immediately, regardless of schedule.
- **Private GitHub repositories.** A token stored in Obsidian's secret storage makes sources in a private repository work, and raises GitHub's rate limit. Authenticated reads go through the contents API, which is the path that serves a private file.
  - The token is only ever sent to GitHub. A note's URL cannot cause it to be attached to any other host, and a raw GitHub URL is recognised as a GitHub source just as a page URL is.
  - Without a token a private source reports that a token is needed rather than claiming the file was deleted, since GitHub answers 404 in both cases.
  - A rate-limited response says so instead of reporting a generic failure, and a response that arrived as metadata rather than file content is refused rather than written into the note.

### Settings

- **Document sync** gains a GitHub token, a background poll toggle, and the cron schedule.

## 1.6.0 - 2026-09-11

### Added

- **Document sync.** A note can be bound to a remote Markdown file with a `schreibstubeSyncedFrom` frontmatter key, and mirrors it. The source is the single truth and nothing is ever pushed back; incoming changes arrive in the review sidebar as cards you accept one at a time. A bound note can live in any folder, because it is found by its key rather than its location.
  - Changes are hunk-level, so one card covers one coherent edit rather than scattering a rewritten paragraph across a dozen word changes.
  - The note's own frontmatter is never part of the diff, and the remote file's frontmatter is stripped before comparison. Without the second rule the first sync of any source with frontmatter would overwrite the binding and orphan the note.
  - Local edits are detected with a hash of the body as of the last sync, so an edited mirror is reported as diverged rather than having your own words presented back as a remote change. The baseline advances only once the note matches the source again.
  - A deleted or moved source is reported on the card and the note is left untouched. It is never emptied.
  - Only HTTPS sources with a Markdown path are fetched, with a size cap and a content-type check. GitHub page URLs are rewritten to their raw form. Checks are conditional, so an unchanged source costs no download.
  - New command **Check note source for updates**, plus an optional check when a bound note opens, rate-limited per note.

### Changed

- **Every frontmatter key the plugin reads is now `schreibstube`-prefixed camelCase, and the old spellings are gone.** Obsidian frontmatter is one flat namespace shared with other plugins and with the user's own properties, so a bare key is a collision waiting to happen. Existing glossary notes need their frontmatter updated.

  | Before | After |
  |---|---|
  | `schreibstube-glossary` | `schreibstubeGlossary` |
  | `language` | `schreibstubeLanguage` |
  | `default-severity` | `schreibstubeDefaultSeverity` |
  | `glossary` | `schreibstubeGlossaries` |

### Settings

- New **Document sync** section: enable the feature, check on open, and the minimum interval between automatic checks.

### Internal

- The word-level and line-level diffs now share one longest-common-subsequence implementation, so they cannot drift apart in how they decide what changed.

## 1.5.0 - 2026-09-11

### Added

- **Proof-read sidebar.** A side pane that reviews the active note and proposes changes one at a time, each as a word-level diff with accept, reject, and jump-to-place. Three commands drive it: **Open proof-read sidebar**, **Proof-read note**, and **Check note against glossary**. Accepting the whole queue applies it as a single undo step.
  - The model is asked for clean prose, never for diffs or line numbers; every change and its offsets are derived locally, so what a card shows is what the document says.
  - Frontmatter, fenced code, tables, and math blocks are excluded from a run. Inline code, wikilinks, link targets, tags, and bare URLs are masked before sending and restored afterwards; a response that lost one is discarded rather than applied.
  - Cards are re-anchored against the live note before they are applied, so editing while the queue is open marks cards stale instead of rewriting the wrong words.
  - Long notes are chunked, with suggestions appearing per chunk. A failing chunk no longer loses the chunks that succeeded, and a run can be cancelled.
- **Glossary support.** A glossary is an ordinary note carrying `schreibstube-glossary: true` and a term table. Checks run locally and need no API key; the selected terms are also passed to the correction pass as constraints so a rewrite cannot undo them.
  - The term model follows TBX-Basic (ISO 30042): concepts group terms, and each term is `preferred`, `admitted`, `deprecated`, or `superseded`. A forbidden term with no replacement is therefore an ordinary case, not a special one. TBX picklist identifiers and the `notRecommended` and `obsolete` spellings are accepted for pasted exports.
  - Rule shapes follow Vale's vocabulary: substitution, existence, and capitalization, with suggestion, warning, and error severities.
  - Matching is whole-word and Unicode-aware, tolerating German inflection endings, with `exact` and `prefix` modes per term. An inflected match is flagged for review rather than silently given a base-form ending.
  - Which glossary applies is resolved in one order with no merging: the note's own `glossary` property, then a folder rule, then the sidebar pick, then the vault default.
  - Optional live underline of error-severity terms in the editor, off by default.

### Settings

- New **Proofreading** section: prompt, maximum response tokens, characters per request, and parallel requests.
- New **Glossary** section: default glossaries, folder rules, and the editor underline toggle.

## 1.4.0 - 2026-09-04

### Added

- **Summarize selection** command — select text in a note and replace it with an LLM-generated summary. Built for turning raw text pasted from analytics and reporting tools into a running insight log. The summarize prompt is configurable (with an insight-log preset as the default) and a **Maximum response tokens** setting caps the summary length. The command uses the shared AI model configured under **AI models**.
- **Debug logging** setting (under a new **Diagnostics** section). Errors are always logged to the developer console; enabling this adds verbose tracing to help diagnose issues.

### Changed

- **Shared AI configuration.** Provider, model, custom model ID, and API key now live under a dedicated **AI models** settings section and are shared by both rename and summarize (previously grouped under rename). Existing configurations are migrated automatically.
- **Production builds now ship inline source maps**, so console stack traces from a release point at real source.

### Internal

- Extracted the link-open-mode feature and the LLM commands out of the main plugin class into dedicated controllers; isolated every access to undocumented Obsidian internals behind a single guarded adapter that degrades to a logged no-op if an internal changes.
- Focus-mode decorations are now built only for the visible range, and the reading-view lifecycle observer no longer watches the whole document subtree — both reduce work on large notes and large workspaces.
- AI commands now guard against overlapping runs, and summarize targets the originally selected range even if the cursor moves while the request is in flight.

## 1.3.0 - 2026-08-28

### Changed

- **The heading-stack overlay is now ancestor-only.** It shows the chain of headings above the current viewport so you can see where you are in the document, and clicking a row jumps to that heading. Sibling expansion — hovering or tapping an ancestor to browse and jump between headings at the same level — has been removed, along with the **Max visible rows** setting. The **Enable heading stack overlay** toggle and click-to-navigate remain.

## 1.2.0 - 2026-08-28

### Added

- **Interactive sibling expansion restored in the heading-stack overlay.** Hover (desktop) or tap (touch) an ancestor to expand its siblings and jump to any heading at that level, on top of the outline connector styling. This behaviour was documented in the README but had been dropped from the code in 1.1.7.
- **Max visible rows** setting (3–20, default 6) — caps the height of an expanded sibling list. Restored alongside the feature above.
- **Enable heading stack overlay** setting — turn the overlay off entirely.
- **Custom model ID** setting — override the model dropdown with a newer or unlisted model id for the selected provider.
- Request **timeout** (30 s) for rename calls, so a stalled provider no longer hangs the command.

### Changed

- **Rename calls now use Obsidian's `requestUrl`** instead of the browser `fetch`, bypassing the renderer CORS restrictions that could block direct Anthropic/OpenAI requests.
- **LLM provider integration refactored** into a single registry (`llm-providers.ts`) that is the one source of truth for endpoints, headers, request bodies, response parsing, and model lists.
- **Google/Gemini removed** as a provider; Anthropic and OpenAI remain.
- README now documents all four feature areas (heading stack, focus mode, rename, link modes) with settings tables.

### Fixed

- Rename **API errors** are now mapped to actionable messages (invalid key, rate limited, service error) instead of a raw JSON blob.
- Model responses that wrap the filename in a code fence, quotes, or a `Filename:` label are cleaned up before the name is applied.

## 1.1.13 - 2026-06-27

### Fixed

- **Outline indent beyond 3rd level** was broken: the connector span inherited `white-space: nowrap` from its parent, which collapses consecutive spaces. Added `white-space: pre` to the connector span so every indent level renders at the correct depth.

## 1.1.12 - 2026-06-27

### Fixed

- **Outline tree connectors** no longer show a redundant leading `│` on deeper levels. The path now renders as clean indented `└─` entries:
  ```
  Chapter
  └─ Section
     └─ Subsection
  ```

## 1.1.11 - 2026-06-27

### Improved

- **Document tree outline** strips Markdown formatting (bold, italic, inline code, links, wikilinks) from heading text so it renders cleanly in the overlay.
- **Tree connector indicators** replace hash prefixes in the outline overlay. Ancestor headings appear in muted colour with `│`/`└─` connectors; the current (innermost) heading is highlighted in accent colour, making your position in the document immediately visible.

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
