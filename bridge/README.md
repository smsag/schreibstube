# Schreibstube mail bridge

A small, stateless HTTP service that lets the Schreibstube Obsidian plugin send
and search email.

## Why this exists

Obsidian on mobile runs plugins in a WebView: no Node runtime, no raw TCP
sockets. IMAP and SMTP are raw TCP protocols, so the plugin cannot speak them
directly — on mobile it never will be able to. Putting HTTPS in front of them
gives the plugin one transport (`requestUrl`) that behaves identically on
desktop and mobile, and keeps the plugin free of Node-only dependencies.

A useful side effect: the mailbox password lives here, in the bridge's
environment, not in the vault. The plugin only stores a bridge token, which can
be rotated without touching the mailbox.

**The bridge stores nothing.** No database, no message cache, no request-body
logging. Log lines record the Message-ID and result counts, never recipients or
message content.

## API

All endpoints except `/health` require `Authorization: Bearer <BRIDGE_TOKEN>`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/health` | — | `{"status":"ok"}` |
| `POST` | `/send` | `{to, cc?, bcc?, subject, text, from?, inReplyTo?, references?}` | `{messageId, sentAt, filedInSent}` |
| `POST` | `/search` | `{criteria:{from?,to?,subject?,text?,since?,references?}, mailbox?, limit?}` | `{messages[], mailbox, truncated}` |

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

## Configuration

Copy `.env.example` and fill it in. Required: `BRIDGE_TOKEN`, `IMAP_HOST`,
`SMTP_HOST`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`. Everything else has a
sensible default. Missing or weak values fail at startup with a precise message
rather than on the first request.

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

If your Sent folder is named differently (some setups use `INBOX.Sent` or
`Gesendet`), set `SENT_MAILBOX` to match, or to an empty value to skip filing.

## Deploying on Sliplane

Sliplane builds from a Dockerfile in a connected GitHub repository. The exact UI
labels change over time, but the settings you need are:

1. **New service → from GitHub**, pointing at this repository.
2. **Build context / Dockerfile path**: `bridge` — the bridge is a subdirectory,
   so the default repository root will not work.
3. **Port**: `8080` (or set `PORT` and match it).
4. **Health check path**: `/health`.
5. **Environment variables**: everything from `.env.example`. Mark
   `MAIL_PASSWORD` and `BRIDGE_TOKEN` as secrets.
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

- Use a long random `BRIDGE_TOKEN` (the service refuses anything under 24
  characters) and rotate it by changing the env var and the plugin setting.
- The plugin refuses a plain `http://` bridge URL unless it is loopback, so a
  misconfiguration cannot silently send the token in the clear.
- Token comparison is constant-time, and a missing token is indistinguishable
  from a wrong one.
- Request bodies are capped (`MAX_BODY_BYTES`, default 1 MB).
- Add an IP allowlist or rate limit at the platform level if your provider
  offers one.

## Running locally

```bash
cd bridge
npm install
cp .env.example .env    # fill it in
node --env-file=.env server.mjs
```

Then set the plugin's Bridge URL to `http://localhost:8080` — loopback is the
one case where plain HTTP is accepted.
