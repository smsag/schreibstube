# Schreibstube bridge

A small, stateless HTTP service that lets the Schreibstube Obsidian plugin reach
protocols a WebView cannot speak: mail over IMAP and SMTP, and publishing over
SFTP.

## Why this exists

Obsidian on mobile runs plugins in a WebView: no Node runtime, no raw TCP
sockets. IMAP, SMTP and SFTP are raw TCP protocols, so the plugin cannot speak
them directly — on mobile it never will be able to. Putting HTTPS in front of
them gives the plugin one transport (`requestUrl`) that behaves identically on
desktop and mobile, and keeps the plugin free of Node-only dependencies.

A useful side effect: the mailbox password lives here, in the bridge's
environment, not in the vault. The plugin only stores a token, which can be
rotated without touching the mailbox.

**The bridge stores nothing.** No database, no message cache, no request-body
logging. Log lines record the Message-ID and result counts, never recipients or
message content.

## Versions

The bridge and the plugin are deployed separately, so the pair has to stay
compatible. `/health` reports what a deployment is actually running, and the
plugin says plainly when the bridge is behind rather than failing later on a
route that does not exist yet.

| Bridge | Protocol | Plugin          | Notes                                                                                                |
| ------ | -------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| 3.0.x  | 8        | 1.8.0 and later | `/search` `exclude`, quiet `/health`; plan `conflicts`, diagnostics without the root path; see below |
| 2.13.x | 7        | 1.8.0 and later | `:folder:` in a note is drawn as the plugin's icon                                                   |
| 2.12.x | 7        | 1.8.0 and later | `/attachments` hands over a received mail's files                                                    |
| 2.11.x | 6        | 1.8.0 and later | A commit reports `deleteFailed`; assets and SVGs checked                                             |
| 2.10.x | 5        | 1.8.0 and later | A send may carry a note's diagrams as PNG attachments                                                |
| 2.9.x  | 4        | 1.8.0 and later | Alias `from`, refused and unconfirmed sends, `MAIL_FROM` checked                                     |
| 2.8.x  | 3        | 1.8.0 and later | The site's tab icon, named by its theme                                                              |
| 2.7.x  | 3        | 1.8.0 and later | Slideshows, filmstrip thumbnails, header tags and tag pages                                          |
| 2.6.x  | 1        | 1.8.0 and later | Notes cached in memory, parallel SFTP, one login per publish                                         |
| 2.5.x  | 1        | 1.8.0 and later | Sent folder by tag, state guard, absolute `STATE_ROOT`                                               |
| 2.4.x  | 1        | 1.8.0 and later | Validated search body, fetch and asset byte bounds                                                   |
| 2.3.x  | 1        | 1.8.0 and later | `TRUST_PROXY`, Node 24, image without Mermaid's tree                                                 |
| 2.2.x  | 1        | 1.8.0 and later | Per-target switches, publish history, JSON logs                                                      |
| 2.1.x  | 1        | 1.8.0 and later | Mail and publishing                                                                                  |
| 2.0.x  | 1        | 1.8.0 and later | Mail only; `BRIDGE_TOKEN` renamed to `MAIL_TOKEN`                                                    |
| 1.0.x  | —        | 1.7.0           | Mail only, single token, no version handshake                                                        |

## Capabilities

The bridge hosts capabilities, each with its own token, credentials and limits.
A capability whose variables are absent is not offered at all, and a deployment
that offers nothing refuses to start. One capability's token never opens
another's routes: it is refused exactly as a wrong token is, and says as little.

Run the bridge as a **single instance**. State that has to be shared between
requests — the throttle today, the per-target publish lock later — lives in
memory, and a second instance would not see it.

## API

All endpoints except `/health` require `Authorization: Bearer <token>`, and the
token must belong to the capability that owns the route.

| Method | Path                   | Capability | Body                                                                                   | Returns                                                                               |
| ------ | ---------------------- | ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET`  | `/health`              | —          | —                                                                                      | `{status, protocol}`; with any valid token also `version, capabilities[]`             |
| `POST` | `/diagnostics`         | mail       | —                                                                                      | per-protocol reachability                                                             |
| `POST` | `/send`                | mail       | `{to, cc?, bcc?, subject, text, from?, inReplyTo?, references?, attachments?}`         | `{messageId, sentAt, filedInSent, rejected[]}`                                        |
| `POST` | `/search`              | mail       | `{criteria:{from?,to?,subject?,text?,since?,references?}, mailbox?, limit?, exclude?}` | `{messages[], mailbox, truncated}`                                                    |
| `POST` | `/attachments`         | mail       | `{uid, mailbox?}`                                                                      | `{uid, attachments:[{filename, contentType, content}], skipped:[{filename, reason}]}` |
| `GET`  | `/publish/targets`     | publish    | —                                                                                      | `{targets:[{name, baseUrl, siteTitle}]}`                                              |
| `POST` | `/publish/diagnostics` | publish    | `{target}`                                                                             | `{ok, rootExists, entries}` or `{ok:false, error}`; a missing root is `ok:false`      |
| `POST` | `/publish/plan`        | publish    | `{target, index}`                                                                      | what to upload, what will be deleted, and the `conflicts` in the way                  |
| `PUT`  | `/publish/source`      | publish    | raw Markdown, `?target=&sha256=`                                                       | `{sha256, bytes}`                                                                     |
| `PUT`  | `/publish/asset`       | publish    | raw bytes, `?target=&sha256=&name=`                                                    | `{sha256, bytes, path}`                                                               |
| `PUT`  | `/publish/thumbnail`   | publish    | raw JPEG or PNG, `?target=&source=&sha256=&name=`                                      | `{sha256, bytes, path}`                                                               |
| `POST` | `/publish/commit`      | publish    | `{target, index}`                                                                      | `{written, unchanged, deleted, deleteFailed, pruned, collected}`                      |
| `POST` | `/publish/render`      | publish    | `{target}`                                                                             | the same, rebuilt from stored state                                                   |

`/health` is the version handshake: plugin and bridge deploy separately, and
`protocol` is what lets the plugin say "redeploy the bridge" instead of failing
later on an unknown route. Both it and `status` are public, since a platform's
probe and a plugin without a token need them. The bridge's `version` and its
`capabilities` tell a scanner which advisories apply and which token is worth
guessing, so from 3.0.0 they are named only when the request carries a valid
token of either capability; a wrong one counts against the throttle like any
other, and is answered with the public shape.

`/diagnostics` opens a real connection with the configured credentials and
reports each protocol on its own, because a health check that says only "a
process is alive" cannot answer "is my configuration right".
`/publish/diagnostics` runs on the target's shared connection and answers from
its last attempt for 30 seconds: each test is a login, and a host that counts
failed logins bans the address that makes them. It says whether the web root is
there, never where.

Every error carries a stable `code` and the `requestId` that identifies it in
the logs:

```json
{ "error": "Unauthorized.", "code": "unauthorized", "requestId": "req_3f9a1c07" }
```

`references` is the thread lookup: it matches messages citing that Message-ID in
either `References` or `In-Reply-To`, which is how the plugin finds replies to a
note it sent.

`exclude`, from protocol 8, lists up to 500 Message-IDs (or `uid:<n>` for a
message that had none) the caller already holds. The bridge reads the newest
matches as envelopes and steps past those before it fills the window of
`limit`, reading back at most 2,000 matches. Without it, anyone who sent fifty
mails citing a note's Message-ID pushed the note's genuine replies out of
every later fetch; with it, each fetch reaches further back, and `truncated`
says when matches were left unread. An older bridge ignores the field and
answers the newest matches, which the plugin tells the person.

Two details worth knowing:

- **The bridge generates the Message-ID** (in the `From` domain) and returns it,
  rather than letting the MTA assign one. The plugin stores that value in the
  note's frontmatter, and it is the only thing linking later replies back to the
  note — so it has to be known before the send, not after.
- **`from` sets the From line, not the sender of record.** A request may name
  one address, with or without a name, as its `from`; anything else is
  refused with a 400 rather than sent under `MAIL_FROM`. The address must be
  `MAIL_FROM`'s own or one that `MAIL_FROM_ALLOWED` names, as an address or by
  its `@domain`; any other is refused with a 403 `sender_not_allowed` that
  names the variable. Until 3.0.0 any address was taken, which made the mail
  token a token for mail from anyone. The SMTP envelope
  always carries `MAIL_FROM`'s address: that is the address the server
  authenticated and its SPF record vouches for, and bounces return to it.
  Whether the server accepts a From that differs is the provider's policy —
  test an alias once before relying on it — and an alias on a domain the
  provider does not sign for fails DMARC at many recipients.
- **A send the server never confirmed is not called a failure.** When the
  SMTP deadline runs out, or the connection drops after the message was handed
  over, the server may still deliver it. `/send` then answers `504` with the
  code `send_unconfirmed` instead of `502`, so the plugin can say "check Sent"
  rather than "failed" — the answer that made people send a mail twice.
  Recipients are read with nodemailer's own address parser for the envelope as
  for the header, so a quoted name with a comma stays one recipient.
- **Refused recipients are reported.** The server accepts a message as soon
  as it takes one recipient; the ones it turned down come back in `rejected`
  and are logged as a warning, by count, never by address.
- **SMTP does not file a copy in Sent.** After a successful send the bridge
  `APPEND`s the same bytes to the Sent mailbox over IMAP. A failure there is
  reported in `filedInSent` but is not treated as a failed send — the mail is
  already delivered. The reason is in the log, as a warning against the
  Message-ID.
- **Every field of a send is checked before anything is compiled.** Recipients
  are read with the parser that builds the envelope, and one with no address
  in it is refused rather than sent to nobody; `subject`, `inReplyTo` and each
  of `references` are strings of at most 998 characters, `references` a list
  of at most 100. The Message-ID is always the bridge's own.
- **A send reaches at most `MAX_RECIPIENTS` addresses (50)**, to, cc and bcc
  together, and the bridge sends at most `MAIL_SEND_PER_HOUR` mails in any
  hour (60). One more is answered 429 `send_rate_limited` with a
  `retry-after`, and the plugin shows the bridge's reason rather than the
  token advice a 429 otherwise gets. A refused request spends nothing.
- **The log names a failed send by its codes**, such as `EENVELOPE 550`, never
  by the server's words: they quote the recipients the server refused. The
  caller still hears the whole reason.

## Tests

The bridge is covered by the repository's Vitest suite, so its tests run with
the plugin's:

```bash
npm ci --prefix bridge   # once; the tests import imapflow and nodemailer
npm test                 # from the repository root
```

The pure modules — configuration, routing, the throttle, the deadlines — are
tested directly. The mail modules run against a fake SMTP transport and a fake
IMAP client, so nothing touches the network. `server.test.mjs` starts the bridge
as a real process and drives it over HTTP, because configuration is read and the
port bound at import time, and because routing, auth and the body limits are
properties of the running service.

How long a publish takes is measured rather than guessed:

```bash
npm run bench --prefix bridge -- 300 10   # notes, milliseconds per SFTP request
```

It publishes a generated site against the test SFTP server, which answers
every request that many milliseconds late, and prints the time and the number
of SFTP requests for a first publish, one edited note, no change, and a commit
right after a restart. The request count does not depend on the machine and is
the number to compare between versions.

## Publishing

A publish folder becomes a static site: the plugin uploads Markdown and
attachments, the bridge renders the HTML and writes it over SFTP.

**Uploads are incremental, rendering is total.** Sources are addressed by
content, so an unchanged note is never uploaded twice and a renamed one uploads
nothing at all. Every commit then renders the whole site, because a title or a
date that changed in one note changes the index page and every link pointing at
it. Output is hashed before it is written, so an unchanged page is left alone.

**The manifest is what makes deletion safe.** `<state>/manifest.json` records
every file the bridge wrote. A page whose note was unpublished is removed; a
file the bridge has never heard of is never touched. It is written last, so a
crash means the next publish repeats work rather than losing a file. A
deletion the host refuses is counted in the commit's `deleteFailed`, logged as
a warning, and kept in the manifest, so the next publish tries it again;
`deleted` counts only what actually went.

**A commit records only what is on the host.** An asset the index names is
one the bridge has recorded in the manifest or written since the last commit;
one that was never uploaded — the plugin gave up halfway — refuses the commit
with `409 assets_missing`, naming the files, as a missing source does with
`sources_missing`. Running the plan again asks for them.

**Only files the bridge wrote are written.** A page, a stylesheet or an
upload whose path the manifest does not know, and that the host already
has, belongs to someone else — the host's placeholder `index.html`, another
tool's page. Overwriting it made the manifest claim it, and a later publish
delete it. The plan now lists such files as `conflicts` (protocol 8), and an
upload or a commit that would write one is refused with `409 path_conflict`
naming them; an asset already there with the very bytes about to be written
is the same file and goes ahead. `PUBLISH_<TARGET>_ADOPT_EXISTING=true` lets a
target take such files over — for a site that was published before by other
means, or whose manifest was lost.

**Uploads have a budget.** Uploads arrive outside the publish lock, before
the commit that names them. Between two commits a target takes at most
`PUBLISH_MAX_UPLOADS` uploads (4000) and `PUBLISH_MAX_PUBLISH_BYTES` (500 MB)
and answers `413 quota_exceeded` beyond them, counted in memory since the last
commit or start. Every asset is recorded in `<state>/pending.json` before its
bytes are written, and the next commit removes those its index does not use
and counts them as `abandoned`, so an upload no commit came for does not stay
on the host for good. Uploads and commits to one target do not overlap; each
refuses with `409 publish_in_progress` while the other runs. A commit holds at
most 200 MB of note text, and a stored note that no longer hashes to its name
is removed rather than published, so the next plan asks for it again.

**Each publish leaves a trace.** `<state>/history.json` keeps the last fifty
summaries — when, what was written, what was deleted — so "when did that page
change" has an answer without a log server. Failing to write it never fails a
publish that already succeeded.

**Sources are kept.** `<state>/src/<sha256>.md` holds the Markdown, so
`/publish/render` can rebuild the whole site after a template change with
nothing uploaded and no vault in reach.

**Sources are also kept in memory.** A note is addressed by the hash of its
content, so a copy the bridge holds can never be stale, and a commit renders
from memory whatever this process has uploaded or read before: editing one
note of three hundred reads one note, not three hundred. What is not in memory
— after a redeploy — is read several requests at a time, and so are the
writes and deletions. Up to 32 MB of notes are kept, least recently used first
out.

The requests of one publish share one SFTP connection per target, closed after
fifteen seconds without use, so a first publish of many files logs in once
rather than once per file; a connection that failed in a way that may have
broken it is never reused. Every SFTP operation is under `UPSTREAM_TIMEOUT_MS`,
a transfer under that plus a minute per 7.5 MB of the file, and every publish
request under its own budget; when a request runs out, its
connection is closed at once, which is what fails the operation the server
never answered and frees the target for the next publish. The request is
abandoned as well: every operation it would still start is refused before it
reaches the server, so a commit that ran out of time cannot write a page after
the next one has begun. The connection pings the
server every ten seconds and gives up after three unanswered pings, so a line
that died without a word is noticed within the minute.

An uploaded asset has to be what its name says: a PNG, JPEG, GIF, WebP or
AVIF, and an MP4, M4V, QuickTime, WebM or Ogg video, begins the way its format
does. An SVG is served from the site's own domain, where one opened on its own
runs whatever it carries, so it is read as an XML parser reads it and held to
an allow-list (`publish/svg-guard.mjs`): the elements and attributes a drawing
is made of, no namespace prefix but `xlink`, no DTD with entities, no
processing instruction but the XML declaration, no event handler, no animation
of a link, and no reference out of the document once character references are
decoded. A drawing's own fonts and pictures embedded as `data:` URIs are
allowed there, since an Excalidraw or draw.io export carries them; draw.io's
HTML labels, which are `foreignObject`, are not.
One that fails is refused with `400 asset_rejected`.

Every write goes to a temporary name and is renamed over its target, so a reader
never sees a half-written page. Every directory between the configured root and
the file is looked at first, once per connection, and a link — a directory that
points elsewhere — is refused for a write, a deletion or pruning alike, in the
web root and in the state directory. The host key is checked against a
configured fingerprint: a stateless container cannot trust on first use,
because it would re-trust a new key after every restart.

**Headers, where the bridge can set them.** A target with
`PUBLISH_<TARGET>_HTACCESS=true` — the default for one that keeps its state
in the web root, which is the shared Apache host — gets two files the bridge
writes and keeps in its manifest: `.htaccess` at the root, which sends a
content security policy, `X-Content-Type-Options: nosniff` and a referrer
policy with every page, and `assets/.htaccess`, which serves every SVG with
`Content-Security-Policy: sandbox`, so a drawing opened on its own has no
origin to act in. The policy allows the site's own scripts and its one inline
script by hash, inline styles (KaTeX and Mermaid write them), pictures and
video from anywhere, and frames for a video a note embeds; a theme that loads
a web font needs `PUBLISH_<TARGET>_CSP`. A `.htaccess` the operator keeps there
is left alone, with a warning. Other servers take the same headers from their
own configuration; `PUBLISHING.md` has them for nginx and Caddy.

The rendered site is static. Maths is rendered to HTML by KaTeX at publish time;
Mermaid needs JavaScript, and only on pages that contain a diagram, from a
bundle the bridge writes itself rather than from a content delivery network.

An **icon in the text** — `:folder:`, any name the plugin's icon picker offers —
is drawn as that icon, inline, where Obsidian draws it: not in code, not in a
link, and not for a name the set does not have, which stays the text it was.
The drawings are Tabler's own strokes, from the release the plugin's font was
cut from, written into `publish/render/icons.generated.mjs` by the plugin's
`npm run build:icons`, so the site and the picker cannot know different names.
Each icon is an `<svg class="icon-shortcode">` that carries its own size,
stroke and colour (`currentColor`), because a vault's `theme.css` replaces the
built-in one; a theme may move it on the line with `--icon-baseline`
(default `-0.15em`) and style the class like any other. The page loads nothing
for it. No field of the index changed, so the protocol stays at 7. A publish
draws every page from its stored source, so a page published before this gets
its icons the next time anything is published.

A ` ```schreibstube-slideshow``` ` block becomes the plugin's slideshow.
The bridge reads the block by the plugin's rules — `contracts/slideshow-cases.json`
holds the examples both sides are tested against — and writes plain HTML that
already reads without a script: the stage swipes, tiles are a grid, a
comparison is two pictures side by side. On pages that have one, it adds
`assets/slideshow.css` and `assets/slideshow.js`, a small module from
`publish/client/` that brings the header, the controls, the thumbnails, the
divider and the fullscreen view. Only images the site has are shown; a block
the plugin would refuse is left off the page.

A filmstrip's thumbnails are small copies the plugin makes, since it can
decode a picture where the picture is and the bridge would otherwise need an
image library to decode files from the network. Protocol 3 carries them: an
index asset may say `thumbnail: true`, the plan answers with the
`uploadThumbnails` the site lacks, and `PUT /publish/thumbnail` takes each one,
addressed by the picture it shows (`source`) and checked by its own bytes
(`sha256`) and its format, at most 200 kB. They live under `assets/thumbs/`,
named after their picture, so one the site has is known to be current without
decoding anything, and they go when no filmstrip shows the picture any more.
A page points at a thumbnail only once it is on the host; until then the
filmstrip shows the picture itself. A protocol-1 plugin sends no marks and a
protocol-1 bridge asks for no thumbnails, and either way the filmstrip works.

Up to three **header tags** per connection are linked on the right of every
page's header, each to `tag/<slug>/`, a page listing the published notes that
carry it, newest first. Protocol 3 carries them: the index may name
`headerTags` (at most three, no two sharing a page), and a note may name
`tags` — only which of those header tags it carries, which the plugin works out
the way Obsidian counts tags, so a note's other tags never leave the vault. A
header tag no published note carries gets no link and no page. A protocol-2
plugin sends none, and the header is as it was.

A theme may name the site's **tab icon**:
`--site-icon: url("data:image/svg+xml,…")` anywhere in `theme.css` (a PNG as
`data:image/png;base64,…` works too). The bridge reads it out of the theme it
was sent, writes it as `assets/site-icon.svg` (or `.png`) and links it from
every page's head, because a browser asks for an icon by address and never
looks inside a stylesheet. The icon is served from the site's own domain, so it
is checked: at most 32 kB, an SVG held to the drawing allow-list above with no
`data:` URIs of its own, or a PNG that begins like one. An icon that fails is
left out — the
site loses its tab icon, not its publish. An SVG icon may carry its own
`prefers-color-scheme` rule to switch for a dark tab bar. No field of the index
changed: the theme was always sent, so the protocol stays at 3.

## Dependencies and advisories

CI runs `npm audit --omit=dev --audit-level=high` over this tree on every
change, because the bridge's runtime dependencies are the only ones in the
repository that ship anywhere: the plugin bundles nothing.

`lodash-es` is pinned by an `overrides` entry to a patched line. Mermaid's parser
still declares the vulnerable range, and the bridge never runs Mermaid at all —
it copies one prebuilt file into the published site, where the browser runs it
against diagrams the site's own author wrote — but a finding that has a fix is
cheaper to take than to explain. A site that does not draw diagrams can set
`PUBLISH_<TARGET>_ALLOW_DIAGRAMS` to `false`, and then nothing of Mermaid
reaches the site at all.

Dependabot opens one grouped pull request a week for this tree. A major version
arrives on its own, since that is the one worth reading.

The image does not carry Mermaid's dependency tree at all. The `Dockerfile`
installs the package in a build stage, keeps the one prebuilt file under
`vendor/mermaid.min.js`, and removes the rest — 167 MB of parser dependencies
that would never run. `assets.mjs` looks in `vendor/` first and only then in
the package, which is what a checkout with `node_modules` uses. CI boots the
image and checks that both halves of that happened. The install runs no
package's install scripts: nothing in the tree needs one (ssh2 falls back to
its pure JavaScript ciphers), and a script is the one place a dependency
would run code at build time.

## Configuration

Copy `.env.example` and fill it in. To offer publishing, set `PUBLISH_TOKEN`,
`PUBLISH_TARGETS`, and one block of variables per target — host, user, a key or
a password, the host fingerprint, the web root and the site URL.

**The fingerprint is the ED25519 key's.** A server holds several host keys, and
the bridge is shown the ED25519 one where the server has it, else ECDSA, else
RSA. List them all:

```bash
ssh-keyscan your-host | ssh-keygen -lf -
```

and take the line ending in `(ED25519)`; if there is none, `(ECDSA)`; `(RSA)`
only when it is the only one. A fingerprint of another type never matches, and
the bridge refuses with a message naming the type it was shown.

To offer mail, set `MAIL_TOKEN`,
`IMAP_HOST`, `SMTP_HOST`, `MAIL_USER`, `MAIL_PASSWORD` and `MAIL_FROM`;
everything else has a sensible default. Set none of them and the bridge does not
offer mail; set some, and it names the ones still missing. Missing or weak
values fail at startup with a precise message rather than on the first
request. So does a variable that is set and unreadable: a `MAIL_FROM` with no
address in it, a numeric one that is not a positive integer written in
decimal digits, a port above 65535, a `PUBLISH_<TARGET>_KEY` that does not
decode to a PEM, OpenSSH or PuTTY private key, or a flag spelled as neither true nor
false. Leave a variable out to take its default; do not leave it half-written.

**Who a mail may be from.** `MAIL_FROM_ALLOWED` lists, separated by commas,
the further addresses a note may send as — the aliases of the mailbox — and
`@domain` entries for every address at one domain (that domain only, not its
subdomains): `MAIL_FROM_ALLOWED=buero@your-domain.de,@team.your-domain.de`.
`MAIL_FROM`'s own address is always allowed, and unset is that address alone.
An entry that is neither a bare address nor a domain fails at startup.
Whether the server delivers mail from an alias is still its own policy.

**`IMAP_SECURE=false` means STARTTLS, required.** The connection starts in
the clear on port 143 and must be upgraded before the login; a server — or
anyone between — that does not offer the upgrade fails the connection rather
than receiving the password in the clear. SMTP has always required it.

**Where a target keeps its state.** `PUBLISH_<TARGET>_STATE_ROOT` is an
absolute path on the SFTP host, and it holds every published note's Markdown —
a current plugin leaves out the frontmatter and the `%%` comments, an older one
sent the note as written — beside an index naming each note's place in the
vault. It belongs outside the
web root. Left out, it is `<ROOT>/.schreibstube`, inside the served tree, and
**since bridge 3.0 the bridge refuses to start with the state inside the web
root** unless `PUBLISH_<TARGET>_STATE_IN_ROOT=true` says the host allows nothing
else. To migrate, either set `PUBLISH_<TARGET>_STATE_ROOT` to a directory
outside the root and move the existing `.schreibstube` directory there, or set
`PUBLISH_<TARGET>_STATE_IN_ROOT=true`. With the state in the root:

- the bridge writes a `.htaccess` that denies everything into that directory
  before the first file lands there. Apache honours it, which covers most
  shared hosting. A `.htaccess` that is already there is left alone.
- every start logs a warning naming the target, because a server that ignores
  `.htaccess` serves the directory. nginx needs a rule of its own:

  ```nginx
  location ^~ /.schreibstube/ { deny all; }
  ```

**A target's own token.** `PUBLISH_<TARGET>_TOKEN` gives one target a token
that alone opens it, under the same rules as every token: at least 24
characters, not the example value, and shared with no other token. A token
that does not open a target is answered as if the target did not exist, and
`/publish/targets` lists only what the token opens. `PUBLISH_TOKEN` keeps
opening every target without a token of its own.

**Budgets.** `REQUEST_TIMEOUT_MS` (30 s) bounds a request, reading its body
included, and `UPSTREAM_TIMEOUT_MS` (20 s) each operation against a mail or
SFTP server, the connection attempts of `/diagnostics` included. A
send is two such operations, delivery and then filing the copy in Sent, each
with its own deadline, and the request is allowed both plus five seconds. A
Sent folder that does not answer in time is reported as `filedInSent: false`,
never as a failed send, because a person told a delivered message failed sends
it again. Publishing allows 180 s for an upload and 300 s for a commit. The
plugin waits 60 s for mail and 330 s for a commit; raise the budgets only so far
that the bridge still answers first.

The size limits are variables too: `MAX_BODY_BYTES` for a request body,
`MAX_TEXT_CHARS` for the text kept from a message and `MAX_MESSAGE_BYTES` for
what one message may weigh on the wire; `PUBLISH_MAX_SOURCE_BYTES`,
`PUBLISH_MAX_IMAGE_BYTES`, `PUBLISH_MAX_VIDEO_BYTES`, `PUBLISH_MAX_INDEX_BYTES`
and `PUBLISH_MAX_FILES` for a publication, and `PUBLISH_MAX_PUBLISH_BYTES` and
`PUBLISH_MAX_UPLOADS` for what a target takes between two commits.
`.env.example` lists them with their defaults.

A send may carry pictures, `attachments: [{filename, contentType, content}]`
with the content in base64: the diagrams of a note, drawn by the plugin because
no mail client can draw them. Only `image/png` is taken, under a plain name
ending in `.png`, and the bytes have to begin like a PNG. At most 10 pictures,
4 MB each and 10 MB together (`mail-attachments.mjs`); the send route alone
reads a body large enough for them, `MAX_BODY_BYTES` plus that allowance in
base64, and every other route keeps `MAX_BODY_BYTES`. A picture that fails is
a refused request, never a mail sent without it, because its text would point
at an attachment that is not there. A plugin before protocol 5 sends none.

A received mail's files come from `/attachments`, one message at a time by the
UID a search returned, so a search stays as light as its text. Pictures, PDFs
and Office files (Word, Excel, PowerPoint and their OpenDocument kin) are handed
over in base64 under a plain name; anything else is named in `skipped` with the
reason `type`, `size` or `limit`, and from 3.0.0 `content` for a file whose
bytes do not begin the way its kind's do — a PDF's `%PDF-`, a PNG's, JPEG's,
GIF's, WebP's or HEIC's signature, `PK` for the zipped Office and OpenDocument
files, the OLE header for `.doc`, `.xls` and `.ppt`. A name, kept or shown in
`skipped`, loses control and format characters (the latter include the
overrides that turn `fdp.exe` around on screen), is cut to 200 bytes of UTF-8
between characters, and a name Windows keeps for a device, such as `CON.pdf`,
gets a `_` in front. A signature's logos, small pictures shown
inside the text, and an S/MIME signature are left out without a word. At most
20 files, 15 MB each and 25 MB together, from a mail of at most 40 MB as the
server stores it (`mail-import.mjs`); a larger mail is answered 413
`message_too_large`, and one that has moved since the search 404
`message_gone`. The route has twice `UPSTREAM_TIMEOUT_MS`, since a mail with
its files is many times a search's download.

Generate the token with:

```bash
openssl rand -base64 32
```

### Strato

Verify against your Strato customer panel — these are the usual values, not a
guarantee:

```
IMAP_HOST=imap.strato.de     IMAP_PORT=993   IMAP_SECURE=true
SMTP_HOST=smtp.strato.de     SMTP_PORT=465   SMTP_SECURE=true
MAIL_USER=you@your-domain.de                 # the full address, not a short name
```

Strato's Sent folder is `Sent Items` on the server, whatever your mail app
calls it ("Gesendete Objekte" in Strato's webmail). You should not need to set
it: see below.

### Where the sent copy goes

SMTP delivers a message and keeps nothing, so the bridge files the copy in your
Sent folder over IMAP itself. For that it needs the folder's name on the server,
which is often not the name a mail app shows. `SENT_MAILBOX` decides:

- **Unset** (the default): the bridge asks the server which folder it tags as
  Sent (IMAP's `\Sent` marker, the one mail apps go by) and files there. Only
  the server's own tag counts, never a guess from a folder's name. A server that
  tags nothing gets `Sent`. The answer is asked once and kept until the next
  deploy.
- **A name**, such as `Sent Items` or `INBOX.Sent`: always that folder, even
  when the server tags another one.
- **Empty** (`SENT_MAILBOX=`): no copy is filed, for a server that files what
  its SMTP sends by itself.

Gmail files its own copy, so on Gmail the bridge files nothing unless
`SENT_MAILBOX` names a folder, and reports the copy as filed.

If the plugin says a mail was sent but no copy was filed, the folder was not
found. Set `SENT_MAILBOX` to its name on the server: in Apple Mail, Settings →
Accounts → Mailbox Behaviors shows it; in Thunderbird, the folder's Properties.

## Deploying on Sliplane

Sliplane builds from a Dockerfile in a connected GitHub repository. The exact UI
labels change over time, but the settings you need are:

1. **New service → from GitHub**, pointing at this repository.
2. **Build context / Dockerfile path**: `bridge` — the bridge is a subdirectory,
   so the default repository root will not work.
3. **Port**: `8080` (or set `PORT` and match it).
4. **Health check path**: `/health`.
5. **Environment variables**: everything from `.env.example`. Mark
   `MAIL_PASSWORD`, `MAIL_TOKEN`, `PUBLISH_TOKEN` and any `PUBLISH_*_KEY` or
   `PUBLISH_*_PASSWORD` as secrets. Set `TRUST_PROXY=true`: the platform's
   proxy terminates TLS, so without it the throttle sees one address for
   everyone.
6. Deploy, then confirm:

   ```bash
   curl https://<your-service>.sliplane.app/health
   # {"status":"ok","protocol":8}
   ```

7. Put that base URL into the plugin's **Bridge URL** setting, and the token into
   **Bridge token**.

Sliplane runs on Hetzner infrastructure in Germany, which keeps mail content in
the EU — relevant if the mailbox carries personal data. Confirm the current
region and data-processing terms yourself before relying on that.

### Security posture

The bridge is reachable from the public internet, so the bearer token and TLS
are the entire perimeter:

- Use a long random token per capability and rotate it by changing the env
  var and the plugin setting. The service refuses to start with a token under
  24 characters, one of fewer than 10 different characters, the placeholder
  an older `.env.example` carried, or the same token for mail and publishing.
  A mail token never opens a publish route, or the other way round.
- The plugin refuses a plain `http://` bridge URL unless it is loopback, so a
  misconfiguration cannot silently send the token in the clear.
- Token comparison is constant-time, and a missing token is indistinguishable
  from a wrong one.
- Request bodies are capped (`MAX_BODY_BYTES`, default 1 MB), every outbound
  operation has a deadline, and repeated token failures from one address are
  throttled. Behind a proxy that throttle needs `TRUST_PROXY=true`, or the
  address it sees is the proxy's and one stranger's failures lock everyone out;
  the log says so once when `X-Forwarded-For` arrives while it is off. With a
  CDN in front of the platform's proxy, set `TRUST_PROXY_HOPS=2` (the number of
  proxies; `TRUST_PROXY=true` is one) and the throttle takes the second address
  from the right. An IPv6 caller is throttled by its /64, which one customer
  holds whole, and an IPv4 address in IPv6 form as the IPv4 address. Failures
  age out of the window and nothing else clears them: a good request with one
  capability's token does not reset the guesses at another's. The throttle
  remembers at most 10,000 addresses, forgetting the one that failed longest
  ago first.
- A request refused before its body was read — a wrong token, an unknown path,
  a throttled address, an oversized body — is answered with
  `connection: close` and its socket closed, rather than kept open for the
  longest route's budget. Headers must arrive within 10 seconds, and at most
  `MAX_CONNECTIONS` sockets (100) are open at once. A URL the parser cannot
  read is a 400.
- A publish target's state directory is kept out of the web root; the bridge
  refuses to start with it inside unless told the host allows nothing else,
  and then guards it with a deny `.htaccess` and a warning at every start (see
  Configuration).
- A publish writes only files the bridge wrote before, follows no linked
  directory, and takes a bounded amount between commits. A target may have a
  token of its own, so one site's token opens no other.
- The plugin asks before sending a token to a bridge address the device has
  not sent it to, since the address syncs with the vault and the token does
  not.
- A target that publishes raw HTML from notes (`PUBLISH_<TARGET>_ALLOW_HTML`,
  on by default for a personal site) is said in a warning at every start: a
  vault with more than one author should turn it off.
- Add an IP allowlist or rate limit at the platform level if your provider
  offers one.

## Running locally

Node 24, as everywhere in this repository: `.nvmrc` at the root says so, the
image runs it, and both `engines` fields require it.

```bash
cd bridge
npm install
cp .env.example .env    # fill it in
node --env-file=.env server.mjs
```

Then set the plugin's Bridge URL to `http://localhost:8080` — loopback is the
one case where plain HTTP is accepted.
