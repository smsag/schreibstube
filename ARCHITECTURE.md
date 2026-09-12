# Architecture

Two pieces: a plugin that runs inside Obsidian, and a bridge that runs on a
server you own. Everything follows from one constraint.

## The constraint

Obsidian on mobile runs plugins in a WebView. There is no Node runtime and no
raw TCP socket, so the plugin cannot speak IMAP, SMTP or SFTP — not today, and
not later. The choice is between a desktop-only plugin and a small service that
speaks those protocols on the plugin's behalf.

The bridge is that service. Everything else is a consequence.

## What runs where

| Concern                      | Plugin | Bridge |
| ---------------------------- | ------ | ------ |
| Reading the vault            | yes    | never  |
| Deciding what is published   | yes    | no     |
| Rendering Markdown to HTML   | no     | yes    |
| Mailbox password, SSH key    | never  | yes    |
| Speaking IMAP, SMTP, SFTP    | no     | yes    |
| Deciding what may be deleted | no     | yes    |

The plugin holds vault knowledge and a token. The bridge holds credentials and
the protocols. Neither holds both.

## The plugin

```
main.ts              lifecycle, commands, events
controllers/         one per feature; they own flow and talk to Obsidian
  publish-commands   collects the folder, drives plan → upload → commit
  mail-commands      send, search, merge replies
  proofread-controller  the review sidebar
  sync-poller        checks bound notes against their sources
services/            pure decisions, no Obsidian imports, heavily tested
ui/                  panels and modals
settings/            one module per settings area
i18n/                German and English catalogues
```

The rule that keeps the suite fast: `services/` never imports `obsidian`.
Anything that needs the app is a controller, and controllers are tested against
a stub of Obsidian and a fake vault (`testing/`).

## The bridge

```
server.mjs           configuration, route table, request handling
config.mjs           one block per capability; absent means not offered
router.mjs           which token opens which route
mail-routes.mjs      send, search, diagnostics
publish/             plan, upload, commit, render, SFTP
```

Capabilities are independent. A deployment can offer mail, publishing, or both,
and one capability's token never opens another's routes.

## Publishing, end to end

```
plugin                                   bridge                      web host
──────                                   ──────                      ────────
collect the folder
hash every note and attachment
        │
        ├── POST /publish/plan ────────▶ read manifest ────────────▶ SFTP
        ◀── what is missing ───────────
        │
        ├── PUT  /publish/source ──────▶ store by content hash ────▶ SFTP
        ├── PUT  /publish/asset ───────▶ write asset ─────────────▶ SFTP
        │
        └── POST /publish/commit ──────▶ render every note
                                         write what changed ──────▶ SFTP
                                         delete what went
                                         write the manifest last
```

Uploads are incremental; rendering is total. A title that changed in one note
changes the index page and every link pointing at it, and only a full render
gets that right. Output is hashed before writing, so an unchanged page is left
alone.

## The three rules worth knowing

**The manifest decides what may be deleted.** It records every file the bridge
wrote. A file it has never heard of is never touched, which is what makes
mirroring deletions safe on a host that has other things on it.

**The manifest is written last.** A crash before that leaves it describing the
previous state, so the next publish repeats work rather than losing a file.

**The host key is pinned.** A stateless container cannot trust on first use; it
would re-trust a new key after every restart.

## Reading the code

Start at `PUBLISHING.md` for why publishing is shaped this way, `bridge/README.md`
for the API and deployment, and `CONTRIBUTING.md` for how to run it.
