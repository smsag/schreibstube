# Publishing: specification

Publish a vault folder as a static site. The plugin renders each note to HTML
and pushes the result through the Schreibstube bridge, which holds the SFTP
credentials and writes to the web root.

Status: specification, not yet implemented. Targets plugin version 1.8.0.

## Decisions already taken

| Decision | Choice | Consequence |
|---|---|---|
| Markdown to HTML | Rendered in the plugin | The bridge never parses note content; it only writes bytes |
| Publish set | One vault folder per account | The published set is visible in the file tree |
| Deletions | Manifest-based mirror | Only files the plugin uploaded are ever deleted |
| Transport | Bridge over HTTPS, as for mail | Works on mobile; the plugin gains no dependency |
| Tokens | Separate mail and publish tokens | A leaked publish token cannot read the mailbox |
| SFTP credentials | On the bridge, as named targets | No key material in the vault; adding an account needs a redeploy |

## Why the bridge and not direct SFTP

Obsidian on mobile runs in a WebView with no Node runtime and no raw sockets,
so the plugin cannot open an SSH connection. A direct SFTP implementation would
force `isDesktopOnly: true` and cost the heading overlay and focus mode on
mobile. The mail bridge already solved this for IMAP and SMTP, and publishing
reuses the same transport, the same auth shape, and the same deployment.

The second benefit matters as much as the first. The SSH key lives in the
bridge environment, never in the vault, and the vault holds only a token that
can be rotated without touching the hosting account.

## Scope

In scope for the first release:

- One or more publish accounts, each mapping a vault folder to a bridge target.
- Render, plan, upload, delete, manifest write, in that order.
- A dry run that shows exactly what would be uploaded and deleted.
- An index page and a minimal built-in stylesheet.
- Attachments referenced from published notes.

Out of scope for the first release, listed so nobody plans around them:

- Feeds, tags, pagination, search.
- Comments, analytics, anything that needs server-side code.
- Scheduled or automatic publishing on save.
- Re-rendering the site from the server without the vault.
- Multiple accounts publishing the same folder.

## Architecture

```
Obsidian (desktop or mobile)                 Bridge (Node, single instance)      Web host
────────────────────────────                 ──────────────────────────────      ────────
collect folder + attachments
render each note to HTML
hash every output file
        │
        ├── POST /publish/plan ────────────▶ read manifest over SFTP ──────────▶ SFTP
        ◀── upload[], delete[], unchanged ──
        │
        ├── POST /publish/put (per file) ──▶ write temp, rename ───────────────▶ SFTP
        │
        └── POST /publish/commit ──────────▶ delete removed, write manifest ───▶ SFTP
```

The plugin never learns the host name, the user, or the key. It knows a target
name and a token.

## Bridge

### Configuration

Targets are declared by name and configured with one environment block each.
Validation happens at startup, as with the mail configuration, so a broken
deployment fails on boot with a precise message.

```
PUBLISH_TOKEN=<openssl rand -base64 32>
PUBLISH_TARGETS=blog,handbuch

PUBLISH_BLOG_HOST=sftp.example.com
PUBLISH_BLOG_PORT=22
PUBLISH_BLOG_USER=web123
PUBLISH_BLOG_KEY=<base64 of an OpenSSH private key>
PUBLISH_BLOG_KEY_PASSPHRASE=…          # optional
PUBLISH_BLOG_PASSWORD=…                # alternative to KEY, not both
PUBLISH_BLOG_HOST_FINGERPRINT=SHA256:… # required
PUBLISH_BLOG_ROOT=/var/www/blog
PUBLISH_BLOG_BASE_URL=https://blog.example.com
PUBLISH_BLOG_ALLOWED_EXT=html,css,js,json,xml,txt,svg,png,jpg,jpeg,gif,webp,avif,ico,woff2,pdf
```

Startup rejects a target whose root is not absolute, whose base URL is not
`https://`, which has neither a key nor a password, which has both, or which
has no host fingerprint. Host key verification cannot be trust-on-first-use
here: the container is stateless and would trust a new key after every restart.

The existing `BRIDGE_TOKEN` keeps working for the mail routes and is renamed to
`MAIL_TOKEN`, with `BRIDGE_TOKEN` accepted as a fallback so deployed instances
do not break. `PUBLISH_TOKEN` is required only when `PUBLISH_TARGETS` is set, so
a mail-only deployment is unaffected.

### Authorisation

Each route group accepts exactly one token. `/send` and `/search` accept the
mail token, `/publish/*` accepts the publish token, and neither accepts the
other. Comparison stays constant-time and a wrong token is indistinguishable
from a missing one, as today.

### Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/publish/targets` | — | `{targets:[{name, baseUrl}]}` |
| `POST` | `/publish/plan` | `{target, files:[{path, sha256, bytes}]}` | `{upload:[path], delete:[path], unchanged, manifestFound}` |
| `POST` | `/publish/put` | `{target, path, sha256, contentBase64}` | `{path, bytes}` |
| `POST` | `/publish/commit` | `{target, delete:[path], manifest}` | `{deleted, pruned, manifestWritten, baseUrl}` |

`/publish/targets` exists so the settings tab can offer a dropdown instead of
asking the user to retype a name the bridge knows.

`/publish/put` verifies the declared hash against the received bytes and
refuses a mismatch, so a truncated upload cannot be recorded as published.

### Write protocol

Every write goes to a temporary name in the destination directory and is then
renamed over the target. Rename within one filesystem is atomic, so a reader
never sees a half-written page.

Order in `commit`: deletions first, then directory pruning, then the manifest.
The manifest is written last on purpose. A crash before it leaves the manifest
describing the previous state, and the next plan simply re-uploads. The failure
mode is a wasted upload, never a lost file.

### Path safety

This is the part that deserves the tests. The bridge is now a remote file
writer, and a path bug is a defaced site rather than an embarrassing email.

A path is rejected unless it is relative, free of `..` and empty segments, free
of backslashes and control characters, at most 1024 bytes with no segment over
255, and carries an allowed extension. The resolved path must remain under the
target root. Before overwriting, the bridge stats the destination and refuses to
write through an existing symlink. Directory pruning after deletion stops at the
root and removes only empty directories.

These rules live in `bridge/publish-path.mjs` as pure functions, imported by the
root Vitest suite so they are covered by the same `npm test` as the plugin.

### Limits

| Limit | Value | Reason |
|---|---|---|
| `/publish/put` body | 10 MB | Base64 inflates by a third; the practical file cap is about 7 MB |
| Other routes | 1 MB | Unchanged from the mail bridge |
| Files per plan | 2000 | A runaway folder should fail fast, not half-publish |
| Concurrent publishes per target | 1 | An in-memory lock; the bridge must run as a single instance |

The single-instance requirement is a real constraint and belongs in the
deployment notes. Two instances behind a load balancer would interleave writes
to one site.

## Manifest

Stored at `<root>/.schreibstube/manifest.json`.

```json
{
  "version": 1,
  "target": "blog",
  "updatedAt": "2026-09-12T09:14:02.113Z",
  "generator": "schreibstube/1.8.0",
  "files": {
    "hello-world/index.html": { "sha256": "…", "bytes": 4821 },
    "assets/theme.css": { "sha256": "…", "bytes": 2210 }
  }
}
```

It lists only files that are public anyway, but the deployment notes should
still recommend denying `/.schreibstube/` in the web server, because the file
makes enumeration trivial.

A missing manifest is not an error. It means a first publish, and every file is
planned for upload with nothing to delete.

## Plugin

### Settings

A **Publish** section holding:

- Bridge URL, defaulting to the mail bridge URL, with an override field for the
  case where the services are ever split.
- Publish token, in Obsidian's secret storage, resolved through the existing
  `resolveApiKey` helper with the label `Publish-Token`.
- A list of accounts. Each has a display name, a vault folder, a bridge target
  chosen from `/publish/targets`, and a toggle for writing publish state back
  into the note.
- A **Verbindung testen** button per account, calling `/publish/plan` with an
  empty file list. It proves the token, the target, the SFTP login, and the
  root path in one request without writing anything.

### Commands

| Command | Behaviour |
|---|---|
| **Veröffentlichen** | Renders, plans, shows the plan for confirmation, uploads, commits |
| **Veröffentlichung prüfen** | The same up to the plan, then stops and shows it |
| **Website öffnen** | Opens the account base URL |

Publishing is explicit. No save hook, no schedule, at least until the plan
preview has proven itself in practice.

### Note contract

```yaml
---
title: Hallo Welt          # default: first H1, else the filename
date: 2026-09-12           # default: file creation time
description: …             # optional, used in the page head and on the index
publish_slug: hallo-welt   # default: slugified filename
draft: true                # excluded from the publish set
published_at: …            # written back on success
published_url: …           # written back on success
---
```

Write-back mirrors what the mail feature does with `message_id` and `sent_at`,
and for the same reason: the note should carry the evidence of what happened to
it. It is a per-account toggle because it touches every published note.

### Output layout

```
/index.html                     list of published notes, newest first
/<slug>/index.html              one page per note
/assets/theme.css               built-in stylesheet
/assets/<hash>-<name>           attachments, content-addressed
/.schreibstube/manifest.json    state
```

Clean URLs without server configuration, and an attachment whose content
changes gets a new name, so caches cannot serve a stale image.

A `theme.css` in the publish folder root replaces the built-in stylesheet. That
is the whole theming story for the first release.

### Rendering

Each note is rendered with Obsidian's own `MarkdownRenderer` into a detached
element, then wrapped in a page template. This keeps callouts, wikilinks and
embeds looking as they do in the app, and it works on mobile because the
renderer is the app's own code.

Link handling:

- An internal link to another published note becomes `/<slug>/`.
- An internal link to an unpublished note becomes plain text, not a dead link.
- An embedded attachment is collected into the file set and rewritten to its
  content-addressed asset path.
- An external link is left alone, with `rel="noopener"` added.

Two known limits, worth stating before anyone reports them as bugs. Content
produced asynchronously by other plugins, Mermaid among them, may render empty
because serialisation does not wait for it. And output can shift when Obsidian
changes its renderer, since the markup is not ours.

If either becomes painful, the alternative is to render on the bridge from
uploaded Markdown, which buys determinism and testability at the cost of
reimplementing Obsidian's syntax extensions. Not worth it up front, worth
revisiting if the output proves unstable.

### Slug collisions

Two notes resolving to the same slug abort the publish during the plan stage,
naming both notes. Silently overwriting one with the other would lose a page
with no signal.

## Failure modes

| Failure | Behaviour |
|---|---|
| Bridge unreachable | Nothing rendered is uploaded; the command reports and stops |
| Token wrong | A single clear message pointing at settings; no partial run |
| Host fingerprint mismatch | The publish is refused, loudly. This is the one case that might be an attack |
| Upload fails midway | Already-uploaded files stay; the manifest is untouched; the next run resumes |
| Commit fails | Deletions may be partly applied; the manifest is untouched; the next run replans |
| Disk full on the host | The failing put reports the SFTP error verbatim; nothing is committed |

## Non-functional requirements

- **Latency.** A publish of fifty unchanged notes must complete in under five
  seconds, because the plan stage alone touches the network.
- **Transfer.** Only changed files travel. Re-publishing an untouched folder
  uploads nothing beyond the manifest.
- **Reliability.** An interrupted publish never leaves a served page in a
  half-written state.
- **Security.** No key material in the vault. Separate tokens per capability.
  Every remote path validated against the target root.
- **Privacy.** Only files in the publish folder leave the vault. Draft notes
  and notes outside the folder are never read. Bridge logs record target, file
  count and byte count, never paths or content.
- **Observability.** Every publish logs a single summary line on both sides:
  target, uploaded, deleted, unchanged, duration.

## Delivery

### Epic 1: Bridge publish capability

- **Story 1.1** Target configuration and startup validation.
  *Accepts when:* a valid block boots, each invalid variant fails at startup
  with a message naming the variable, and a mail-only deployment is unaffected.
- **Story 1.2** Token separation.
  *Accepts when:* mail routes reject the publish token, publish routes reject
  the mail token, `BRIDGE_TOKEN` still works for mail, and both rejections are
  indistinguishable from a missing token.
- **Story 1.3** Path safety module with unit tests.
  *Accepts when:* traversal, absolute paths, control characters, oversized
  segments, disallowed extensions and symlink destinations are all refused, and
  the tests run under the root `npm test`.
- **Story 1.4** SFTP transport with fingerprint pinning.
  *Accepts when:* a mismatched fingerprint aborts before authentication.
- **Story 1.5** The four endpoints, with temp-and-rename writes and
  last-written manifest.
  *Accepts when:* a killed process between put and commit leaves the site and
  manifest consistent, and the next plan resumes correctly.

### Epic 2: Plugin render pipeline

- **Story 2.1** Folder collection, frontmatter contract, draft exclusion, slug
  derivation, collision detection.
- **Story 2.2** Note to HTML with the page template and link rewriting.
- **Story 2.3** Attachment collection and content-addressed naming.
- **Story 2.4** Index page and built-in stylesheet, with `theme.css` override.
  *Accepts when:* rendering a fixture vault produces byte-identical output on
  two consecutive runs, and every link in the output resolves within the site.

### Epic 3: Plugin publish flow

- **Story 3.1** Settings section, accounts list, target dropdown, connection test.
- **Story 3.2** Publish client over `requestUrl`, mirroring `mail-client.ts`.
- **Story 3.3** The three commands, with the plan confirmation dialog and a
  progress notice.
- **Story 3.4** Frontmatter write-back, in its own error boundary so a failed
  write is reported without claiming the publish failed. This is the mistake
  the mail feature already made once and fixed.

### Rollout

1. Render stage first, writing to a local folder. Reviewable with no bridge and
   no server.
2. Bridge endpoints against a throwaway directory on the real host, with
   deletion disabled.
3. Deletion enabled, exercised with a renamed note.
4. Real folder, one account.
5. Second account, to prove the target model before it is documented.

Each step is a separate pull request. The publish commands stay unregistered
until step three passes, which is the feature flag.

## Open decisions

1. **Index page contents.** Title, date and description, or also an excerpt?
   The assumption here is the first.
2. **Attachment scope.** Only attachments referenced by published notes, as
   assumed here, or everything in the folder?
3. **Desktop shortcut.** Should desktop later gain a direct SFTP path that
   skips the bridge? It removes a dependency for desktop users and doubles the
   transport surface. The assumption here is no.
