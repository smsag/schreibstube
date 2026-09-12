# Publishing: specification

Publish a vault folder as a static site. The plugin uploads Markdown sources
and attachments through the Schreibstube bridge; the bridge renders the HTML,
holds the SFTP credentials, and writes to the web root.

Status: implemented and unreleased; bridge 2.1.0. This document is the design
and the reasoning behind it, kept as the record of why publishing is shaped this
way. `bridge/README.md` and the plugin README document what was built.

## Decisions

| Decision | Choice | Consequence |
|---|---|---|
| Markdown to HTML | Rendered on the bridge | Deterministic, snapshot-testable, identical from every device |
| Publish set | Folder per account, `published: true` in frontmatter | Opt-in per note; the folder bounds what is even read |
| Ordering | By `date`, newest first | The index is a blog index |
| Attachments | Images and video, up to 25 MB each | One raw-bytes upload per file, no chunking |
| Render scope | Obsidian syntax, math, diagrams | KaTeX server-side; Mermaid as self-hosted client-side script |
| Sources on the server | Kept in a state directory | A template change re-renders the site without the vault |
| Deletions | Manifest-based mirror | Only files the bridge wrote are ever deleted |
| Transport | Bridge over HTTPS | Works on mobile; the plugin gains no dependency |
| Tokens | Separate mail and publish tokens | A leaked publish token cannot reach the mailbox |
| SFTP credentials | On the bridge, as named targets | No key material in the vault; a new account needs a redeploy |
| Desktop SFTP shortcut | Not built | One transport, one code path, one set of failure modes |
| Backwards compatibility | Not required | The bridge is restructured rather than extended |

## Why the bridge

Obsidian on mobile runs in a WebView with no Node runtime and no raw sockets,
so the plugin cannot open an SSH connection. A direct SFTP implementation would
force `isDesktopOnly: true` and cost the heading overlay and focus mode on
mobile. The mail bridge already solved this for IMAP and SMTP.

Rendering moved to the bridge once the bridge existed. Obsidian's own renderer
would have produced markup that shifts with the app, renders asynchronous
plugin content as empty, and cannot be snapshot-tested in continuous
integration. A Markdown pipeline on the bridge is a pure function from source
to HTML, which is testable, identical on every device, and re-runnable without
the vault.

## Scope

In scope for the first release:

- One or more publish accounts, each mapping a vault folder to a bridge target.
- Upload changed sources, render the whole site, write what changed.
- A dry run that shows exactly what would be uploaded, written and deleted.
- An index page sorted by date, and a built-in stylesheet.
- Images and video referenced from published notes.
- Math and Mermaid diagrams.

Out of scope, listed so nobody plans around them:

- Feeds, tags, pagination, search.
- Comments, analytics, anything needing server-side code at request time.
- Scheduled or automatic publishing on save.
- Multiple accounts publishing the same folder.

# Part one: bridge refactor

The bridge was built for one capability and now grows a second. Extending it in
place would carry over four assumptions that no longer hold: one token, one
body limit, one set of credentials, and no automated tests. With backwards
compatibility waived, it is restructured instead.

## Capability-based configuration

`loadConfig` returns server settings plus whichever capabilities are
configured, and boots with at least one:

```js
{
  port, requestTimeoutMs, version,
  mail:    null | { token, imap, smtp, from, defaultMailbox, sentMailbox, … },
  publish: null | { token, targets: { blog: {…}, handbuch: {…} } }
}
```

A mail-only deployment stays exactly as cheap as it is today, and a
publish-only deployment becomes possible. `BRIDGE_TOKEN` is gone; `MAIL_TOKEN`
and `PUBLISH_TOKEN` are each required only for their own capability, and each
is validated for minimum length as before.

## Route table

Routing becomes a table rather than a switch, because the two capabilities need
different limits and different auth:

```js
{ method, path, capability, bodyType, maxBytes, timeoutMs, handler }
```

A route declares which token opens it, so a mail token on a publish route is
rejected before the body is read. Body limits become per route: mail keeps its
1 MB, source uploads get 2 MB, asset uploads get 25 MB. `bodyType` is `json` or
`raw`; a JSON base64 payload would inflate a 25 MB video by a third on the way
through both processes, so an upload sends bytes.

## Seven improvements worth making while it is open

1. **Tests.** The bridge currently has none and was verified by hand. Every
   pure module — configuration, path validation, slug derivation, manifest
   diffing, the whole renderer — is imported by the root Vitest suite and runs
   under the same `npm test` as the plugin. This is the single biggest gap.
2. **Outbound timeouts.** The plugin wraps its requests in `withTimeout`; the
   bridge wraps nothing. A hung IMAP or SFTP connection holds a request until
   the client gives up and can leak the socket. Every outbound operation gets a
   deadline, and every request an overall budget.
3. **Request identifiers.** Log lines carry a timestamp but nothing that ties
   the forty requests of one publish together. Each request gets a short id,
   returned in every error body and printed on every line about it. Support
   questions become answerable.
4. **A version handshake.** Plugin and bridge deploy separately and will drift.
   `/health` returns the bridge version and the protocol version it speaks; the
   plugin checks it on the first call of a session and says plainly that the
   bridge needs redeploying, instead of failing on an unknown route.
5. **A real diagnostics endpoint.** `/health` proves only that a process is
   alive. `/diagnostics`, authenticated per capability, opens an actual IMAP
   login or SFTP connection and reports what it found. The settings tab needs
   exactly this for its connection test.
6. **Sanitised error bodies.** `Send failed: ${err.message}` forwards upstream
   text verbatim. For SFTP that can carry remote paths and host detail. Errors
   become a stable code, a short message, and the request id; the verbatim text
   stays in the log.
7. **Failure throttling.** A public URL with a bearer token and no throttle
   invites brute force. A long token makes that impractical, not impossible.
   Repeated authentication failures from one address earn a delay and then a
   429.

One further point is operational rather than code. **Graceful shutdown** should
refuse new publishes while draining in-flight ones, because a Sliplane redeploy
mid-publish is otherwise survivable only thanks to the manifest being written
last.

# Part two: publish capability

## Target configuration

```
PUBLISH_TOKEN=<openssl rand -base64 32>
PUBLISH_TARGETS=blog,handbuch

PUBLISH_BLOG_HOST=sftp.example.com
PUBLISH_BLOG_PORT=22
PUBLISH_BLOG_USER=web123
PUBLISH_BLOG_KEY=<base64 of an OpenSSH private key>
PUBLISH_BLOG_KEY_PASSPHRASE=…          # optional
PUBLISH_BLOG_PASSWORD=…                # alternative to KEY, never both
PUBLISH_BLOG_HOST_FINGERPRINT=SHA256:… # required
PUBLISH_BLOG_ROOT=/var/www/blog
PUBLISH_BLOG_STATE_ROOT=/var/schreibstube/blog   # default: <ROOT>/.schreibstube
PUBLISH_BLOG_BASE_URL=https://blog.example.com
PUBLISH_BLOG_SITE_TITLE=Schreibstube
```

Startup rejects a target whose root is not absolute, whose base URL is not
`https://`, which has neither a key nor a password, which has both, or which
has no host fingerprint. Host key verification cannot be trust-on-first-use
here: the container is stateless and would re-trust a new key after every
restart, which is not verification at all.

`STATE_ROOT` is a path on the SFTP host, not on the bridge. The bridge keeps no
disk state of its own, so it stays as disposable as it is today and Sliplane
needs no volume. The state root should sit outside the served tree; the default
keeps it under the web root for hosts that allow nothing else, and the
deployment notes then require a deny rule for `/.schreibstube/`.

The one deployment constraint is that the service runs as a **single
instance**. The per-target publish lock is in memory, and two instances behind a
load balancer would interleave writes to one site. On Sliplane that means not
enabling more than one replica.

## Protocol

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/publish/targets` | — | `{targets:[{name, baseUrl, siteTitle}]}` |
| `POST` | `/publish/plan` | `{target, index}` | `{uploadSources[], uploadAssets[], willWrite, willDelete[], unchanged}` |
| `PUT` | `/publish/source?target=&sha256=` | raw Markdown | `{sha256, bytes}` |
| `PUT` | `/publish/asset?target=&sha256=&name=` | raw bytes | `{sha256, bytes, path}` |
| `POST` | `/publish/commit` | `{target, index}` | `{written, deleted, pruned, unchanged, baseUrl}` |
| `POST` | `/publish/render` | `{target}` | `{written, unchanged}` |

`/publish/render` rebuilds the site from stored sources and the stored index.
It is what makes a template change a redeploy rather than a re-upload, and it
needs no vault and no plugin.

### The index

The plugin knows the vault; the bridge does not. The index is how vault
knowledge crosses, and it is the input to link resolution, the index page, and
every page header:

```json
{
  "renderVersion": 1,
  "siteTitle": "Schreibstube",
  "notes": [
    {
      "sourcePath": "Blog/Hallo Welt.md",
      "sha256": "…",
      "slug": "hallo-welt",
      "title": "Hallo Welt",
      "date": "2026-09-12",
      "description": "…"
    }
  ],
  "assets": [
    { "sourcePath": "Blog/bild.png", "sha256": "…", "bytes": 48210, "name": "bild.png" }
  ]
}
```

The plugin resolves every default before sending: title from the first heading
or the filename, date from file creation time, slug from the filename. The
bridge receives complete records and never guesses.

### Flow

```
plan     hash comparison against the manifest; nothing is written
upload   only sources and assets whose hashes are new, one request each
commit   render every note, write changed output, delete removed, write manifest
```

Uploads are incremental, rendering is total. Rendering the whole site on every
commit costs little, removes a class of staleness bugs, and is the only way an
edited title or date updates the index page and the links pointing at it.
Output is still hashed before writing, so an unchanged page is not rewritten
and the transfer stays proportional to what actually changed.

### Storage

Sources are content-addressed under the state root:

```
<state>/manifest.json          what is published, by output path and hash
<state>/index.json             the last index, so /publish/render needs no plugin
<state>/src/<sha256>.md        note sources, deduplicated by content
```

Content addressing makes uploads idempotent and makes a resumed publish free:
a hash already present is never uploaded twice. Sources unreferenced by the
current index are collected at commit.

### Write protocol

Every write goes to a temporary name in the destination directory and is
renamed over the target. Rename within one filesystem is atomic, so a reader
never sees a half-written page.

Order at commit: render everything, write changed output, delete removed
output, prune empty directories, collect orphan sources, write the manifest
last. A crash before the manifest leaves it describing the previous state, so
the next plan re-uploads and re-renders. The failure mode is wasted work, never
a lost file.

### Path safety

The bridge is now a remote file writer. A path bug defaces a site, which is a
different order of problem from a badly formatted email.

A path is rejected unless it is relative, free of `..` and empty segments, free
of backslashes and control characters, at most 1024 bytes with no segment over
255, and carries an allowed extension. The resolved path must remain under the
target root or state root. Before overwriting, the bridge stats the destination
and refuses to write through an existing symlink. Pruning stops at the root and
removes only empty directories.

Uploaded asset names are never used as paths. They are slugified and prefixed
with the content hash, so a hostile filename cannot escape anything.

These rules live in `bridge/publish/path.mjs` as pure functions with their own
test file. They are the part of this feature most worth over-testing.

### Limits

| Limit | Value |
|---|---|
| Markdown source | 2 MB |
| Image | 10 MB |
| Video | 25 MB |
| Files per publish | 2000 |
| Bytes per publish | 500 MB |
| Concurrent publishes per target | 1 |

## Rendering

`markdown-it` with GitHub-flavoured defaults, plus footnotes, definition
lists, task lists, highlights, subscript and superscript, and heading anchors.
On top of that, four Obsidian-specific rules:

- **Wikilinks.** `[[Note]]` and `[[Note|alias]]` resolve through the index. A
  link to a published note becomes `/<slug>/`. A link to an unpublished note
  becomes plain text, never a dead link.
- **Embeds.** `![[bild.png]]` becomes the content-addressed asset path. A video
  extension produces a `<video controls>` element rather than an image.
- **Callouts.** `> [!note]`, with the collapsible variants rendered as
  `<details>` so folding needs no JavaScript.
- **Comments.** `%%…%%` is removed before rendering, not hidden with CSS.

**Math** is rendered server-side with KaTeX, both inline and block. The
stylesheet and its font files are written once as generator assets and tracked
in the manifest like any other file.

**Diagrams** are the one exception to a JavaScript-free site. Mermaid cannot
render server-side without a headless browser, so a `mermaid` fence becomes a
`<pre class="mermaid">` block and the page loads a self-hosted Mermaid bundle
that the bridge writes from its own dependencies. No content delivery network,
and only pages that contain a diagram load the script.

Frontmatter never reaches the output. It is metadata, and `published: false` on
a page that leaks its own frontmatter would be an unpleasant surprise.

Every rule gets a snapshot test. Rendering is a pure function, which is the
whole reason it moved here.

## Note contract

```yaml
---
published: true            # absent or false: not published
title: Hallo Welt          # default: first heading, else the filename
date: 2026-09-12           # default: file creation time
description: …             # optional; page head and index entry
slug: hallo-welt           # default: slugified filename
published_at: …            # written back on success
published_url: …           # written back on success
---
```

Setting `published: false` on a note that was published removes it from the
site on the next publish. That is the unpublish path, and it needs no separate
command.

Write-back mirrors what the mail feature does with `message_id` and `sent_at`:
the note carries the evidence of what happened to it. It is a per-account
toggle because it touches every published note, and it runs in its own error
boundary so a failed write is reported without claiming the publish failed.

## Output layout

```
/index.html                  published notes, newest first
/<slug>/index.html           one page per note
/assets/<hash>-<name>.<ext>  images and video
/assets/theme.css            built-in stylesheet
/assets/katex.css            plus font files, written once
/assets/mermaid.min.js       written once, loaded only by pages with diagrams
```

Clean URLs with no server configuration. An asset whose content changes gets a
new name, so a cache cannot serve a stale image. A `theme.css` in the publish
folder root replaces the built-in stylesheet, which is the whole theming story
for the first release.

### Slug collisions

Two notes resolving to the same slug abort the publish during the plan stage,
naming both notes. Silently overwriting one page with another loses content
with no signal.

## Plugin

### Settings

A **Publish** section holding the bridge URL, defaulting to the mail bridge
URL with an override for the case where the services are ever split; the
publish token in Obsidian's secret storage, resolved through the existing
`resolveApiKey` helper; and a list of accounts. Each account has a display
name, a vault folder, a bridge target chosen from `/publish/targets`, and a
write-back toggle.

A **Verbindung testen** button per account calls `/diagnostics`, which proves
the token, the target, the SFTP login, the fingerprint and the root path in one
request without writing anything.

### Commands

| Command | Behaviour |
|---|---|
| **Veröffentlichen** | Collects, plans, shows the plan for confirmation, uploads, commits |
| **Veröffentlichung prüfen** | The same up to the plan, then stops and shows it |
| **Website öffnen** | Opens the account base URL |

Publishing is explicit. No save hook and no schedule, at least until the plan
preview has proven itself in practice.

## Failure modes

| Failure | Behaviour |
|---|---|
| Bridge unreachable | Nothing is uploaded; the command reports and stops |
| Bridge too old | The version handshake names the mismatch and points at a redeploy |
| Token wrong | One clear message pointing at settings; no partial run |
| Fingerprint mismatch | Refused, loudly. This is the one case that might be an attack |
| Upload interrupted | Uploaded hashes stay; the manifest is untouched; the next run resumes free |
| Commit fails | Output may be partly written; the manifest is untouched; the next run re-renders |
| Slug collision | Refused at plan; nothing is uploaded |
| Disk full | The failing write reports the error; nothing is committed |

## Non-functional requirements

- **Latency.** Re-publishing an unchanged folder of fifty notes completes in
  under five seconds, uploading nothing and writing nothing but the manifest.
- **Transfer.** Only new content hashes travel. An edited note uploads one file.
- **Reliability.** An interrupted publish never leaves a served page half
  written, and never loses a file that is still in the index.
- **Security.** No key material in the vault. Separate tokens per capability.
  Every path validated against a configured root. No filename from a note ever
  used as a path.
- **Privacy.** Only notes marked `published: true` inside the folder leave the
  vault. Logs record target, counts and bytes, never paths or content.
- **Observability.** One summary line per publish on each side: target,
  uploaded, written, deleted, unchanged, duration, request id.

## Delivery

### Epic 1: Bridge restructure

- **Story 1.1** Capability-based configuration with startup validation.
  *Accepts when:* mail-only, publish-only and combined deployments all boot,
  each invalid variant fails at startup naming the variable, and no
  `BRIDGE_TOKEN` path remains.
- **Story 1.2** Route table with per-route capability, body type, limit and
  timeout. *Accepts when:* a mail token on a publish route is rejected before
  the body is read, and both rejections are indistinguishable from a missing
  token.
- **Story 1.3** Request identifiers, sanitised error bodies, failure
  throttling, outbound timeouts, graceful drain.
- **Story 1.4** `/health` version handshake and authenticated `/diagnostics`.
- **Story 1.5** Existing mail behaviour ported onto the new structure with its
  first tests. *Accepts when:* send, search and reply-fetch behave exactly as
  they do today.

### Epic 2: Renderer

- **Story 2.1** Markdown pipeline with the base plugin set, snapshot-tested.
- **Story 2.2** Wikilinks, embeds, callouts and comments against an index
  fixture. *Accepts when:* a link to an unpublished note renders as text and
  every internal link in the output resolves within the site.
- **Story 2.3** Math and generator assets.
- **Story 2.4** Diagrams with the self-hosted bundle, loaded only where used.
- **Story 2.5** Page template, index page sorted by date, built-in stylesheet
  and `theme.css` override. *Accepts when:* two consecutive renders of one
  fixture produce byte-identical output.

### Epic 3: Publish capability

- **Story 3.1** Path safety module with its own tests.
- **Story 3.2** SFTP transport with fingerprint pinning. *Accepts when:* a
  mismatched fingerprint aborts before authentication.
- **Story 3.3** Plan, source and asset upload, as raw bytes and hash-verified.
- **Story 3.4** Commit: render, write changed, delete removed, prune, collect,
  manifest last. *Accepts when:* a process killed between upload and commit
  leaves site and manifest consistent and the next plan resumes correctly.
- **Story 3.5** `/publish/render` from stored state alone.

### Epic 4: Plugin

- **Story 4.1** Settings section, accounts, target dropdown, connection test.
- **Story 4.2** Collection, frontmatter contract, defaults, slug derivation,
  collision detection, index construction.
- **Story 4.3** Publish client over `requestUrl`, mirroring `mail-client.ts`,
  with binary bodies for assets.
- **Story 4.4** The three commands, plan confirmation, progress notice.
- **Story 4.5** Frontmatter write-back in its own error boundary.

### Rollout

1. Bridge restructure and the mail port, with tests. No publish routes yet.
2. Renderer alone, output written to a local directory and reviewed.
3. Publish routes against a throwaway directory on the real host, deletion
   disabled.
4. Deletion enabled, exercised with a renamed note and an unpublished note.
5. First real account, then a second to prove the target model.

Each step is a separate pull request. The publish commands stay unregistered
until step three passes, which is the feature flag.
