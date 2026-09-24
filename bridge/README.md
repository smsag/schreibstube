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

| Bridge | Protocol | Plugin          | Notes                                                        |
| ------ | -------- | --------------- | ------------------------------------------------------------ |
| 2.7.x  | 2        | 1.8.0 and later | Slideshows on the site, filmstrip thumbnails                 |
| 2.6.x  | 1        | 1.8.0 and later | Notes cached in memory, parallel SFTP, one login per publish |
| 2.5.x  | 1        | 1.8.0 and later | Sent folder by tag, state guard, absolute `STATE_ROOT`       |
| 2.4.x  | 1        | 1.8.0 and later | Validated search body, fetch and asset byte bounds           |
| 2.3.x  | 1        | 1.8.0 and later | `TRUST_PROXY`, Node 24, image without Mermaid's tree         |
| 2.2.x  | 1        | 1.8.0 and later | Per-target switches, publish history, JSON logs              |
| 2.1.x  | 1        | 1.8.0 and later | Mail and publishing                                          |
| 2.0.x  | 1        | 1.8.0 and later | Mail only; `BRIDGE_TOKEN` renamed to `MAIL_TOKEN`            |
| 1.0.x  | —        | 1.7.0           | Mail only, single token, no version handshake                |

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

| Method | Path                   | Capability | Body                                                                         | Returns                                            |
| ------ | ---------------------- | ---------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET`  | `/health`              | —          | —                                                                            | `{status, version, protocol, capabilities[]}`      |
| `POST` | `/diagnostics`         | mail       | —                                                                            | per-protocol reachability                          |
| `POST` | `/send`                | mail       | `{to, cc?, bcc?, subject, text, from?, inReplyTo?, references?}`             | `{messageId, sentAt, filedInSent}`                 |
| `POST` | `/search`              | mail       | `{criteria:{from?,to?,subject?,text?,since?,references?}, mailbox?, limit?}` | `{messages[], mailbox, truncated}`                 |
| `GET`  | `/publish/targets`     | publish    | —                                                                            | `{targets:[{name, baseUrl, siteTitle}]}`           |
| `POST` | `/publish/diagnostics` | publish    | `{target}`                                                                   | `{ok, root, entries}` or `{ok:false, error}`       |
| `POST` | `/publish/plan`        | publish    | `{target, index}`                                                            | what to upload, and what will be deleted           |
| `PUT`  | `/publish/source`      | publish    | raw Markdown, `?target=&sha256=`                                             | `{sha256, bytes}`                                  |
| `PUT`  | `/publish/asset`       | publish    | raw bytes, `?target=&sha256=&name=`                                          | `{sha256, bytes, path}`                            |
| `PUT`  | `/publish/thumbnail`   | publish    | raw JPEG or PNG, `?target=&source=&sha256=&name=`                            | `{sha256, bytes, path}`                            |
| `POST` | `/publish/commit`      | publish    | `{target, index}`                                                            | `{written, unchanged, deleted, pruned, collected}` |
| `POST` | `/publish/render`      | publish    | `{target}`                                                                   | the same, rebuilt from stored state                |

`/health` is the version handshake: plugin and bridge deploy separately, and
`protocol` is what lets the plugin say "redeploy the bridge" instead of failing
later on an unknown route.

`/diagnostics` opens a real connection with the configured credentials and
reports each protocol on its own, because a health check that says only "a
process is alive" cannot answer "is my configuration right".

Every error carries a stable `code` and the `requestId` that identifies it in
the logs:

```json
{ "error": "Unauthorized.", "code": "unauthorized", "requestId": "req_3f9a1c07" }
```

`references` is the thread lookup: it matches messages citing that Message-ID in
either `References` or `In-Reply-To`, which is how the plugin finds replies to a
note it sent.

Two details worth knowing:

- **The bridge generates the Message-ID** (in the `From` domain) and returns it,
  rather than letting the MTA assign one. The plugin stores that value in the
  note's frontmatter, and it is the only thing linking later replies back to the
  note — so it has to be known before the send, not after.
- **SMTP does not file a copy in Sent.** After a successful send the bridge
  `APPEND`s the same bytes to the Sent mailbox over IMAP. A failure there is
  reported in `filedInSent` but is not treated as a failed send — the mail is
  already delivered.

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
crash means the next publish repeats work rather than losing a file.

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
broken it is never reused.

Every write goes to a temporary name and is renamed over its target, so a reader
never sees a half-written page. The host key is checked against a configured
fingerprint: a stateless container cannot trust on first use, because it would
re-trust a new key after every restart.

The rendered site is static. Maths is rendered to HTML by KaTeX at publish time;
Mermaid needs JavaScript, and only on pages that contain a diagram, from a
bundle the bridge writes itself rather than from a content delivery network.

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
image library to decode files from the network. Protocol 2 carries them: an
index asset may say `thumbnail: true`, the plan answers with the
`uploadThumbnails` the site lacks, and `PUT /publish/thumbnail` takes each one,
addressed by the picture it shows (`source`) and checked by its own bytes
(`sha256`) and its format, at most 200 kB. They live under `assets/thumbs/`,
named after their picture, so one the site has is known to be current without
decoding anything, and they go when no filmstrip shows the picture any more.
A page points at a thumbnail only once it is on the host; until then the
filmstrip shows the picture itself. A protocol-1 plugin sends no marks and a
protocol-1 bridge asks for no thumbnails, and either way the filmstrip works.

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
`vendor/mermaid.min.js`, and removes the rest — 205 MB of parser dependencies
that would never run. `assets.mjs` looks in `vendor/` first and only then in
the package, which is what a checkout with `node_modules` uses. CI boots the
image and checks that both halves of that happened.

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
request. So does a variable that is set and unreadable: a numeric one that is
not a positive integer, or a flag spelled as neither true nor false. Leave a
variable out to take its default; do not leave it half-written.

**Where a target keeps its state.** `PUBLISH_<TARGET>_STATE_ROOT` is an
absolute path on the SFTP host, and it holds every published note's Markdown as
written — frontmatter and `%%` comments included — beside an index naming each
note's place in the vault. Put it outside the web root wherever the host allows
that. Left out, it defaults to `<ROOT>/.schreibstube`, inside the served tree,
and then:

- the bridge writes a `.htaccess` that denies everything into that directory
  before the first file lands there. Apache honours it, which covers most
  shared hosting. A `.htaccess` that is already there is left alone.
- every start logs a warning naming the target, because a server that ignores
  `.htaccess` serves the directory. nginx needs a rule of its own:

  ```nginx
  location ^~ /.schreibstube/ { deny all; }
  ```

**Budgets.** `REQUEST_TIMEOUT_MS` (30 s) bounds a request and
`UPSTREAM_TIMEOUT_MS` (20 s) each operation against a mail or SFTP server. A
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
and `PUBLISH_MAX_FILES` for a publication. `.env.example` lists them with their
defaults.

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
   # {"status":"ok"}
   ```

7. Put that base URL into the plugin's **Bridge URL** setting, and the token into
   **Bridge token**.

Sliplane runs on Hetzner infrastructure in Germany, which keeps mail content in
the EU — relevant if the mailbox carries personal data. Confirm the current
region and data-processing terms yourself before relying on that.

### Security posture

The bridge is reachable from the public internet, so the bearer token and TLS
are the entire perimeter:

- Use a long random token per capability (the service refuses anything under
  24 characters) and rotate it by changing the env var and the plugin setting.
  A mail token never opens a publish route, or the other way round.
- The plugin refuses a plain `http://` bridge URL unless it is loopback, so a
  misconfiguration cannot silently send the token in the clear.
- Token comparison is constant-time, and a missing token is indistinguishable
  from a wrong one.
- Request bodies are capped (`MAX_BODY_BYTES`, default 1 MB), every outbound
  operation has a deadline, and repeated token failures from one address are
  throttled. Behind a proxy that throttle needs `TRUST_PROXY=true`, or the
  address it sees is the proxy's and one stranger's failures lock everyone out.
- A publish target's state directory is kept out of the web root, or, at its
  default inside it, guarded by a deny `.htaccess` and a warning at every start
  (see Configuration).
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
