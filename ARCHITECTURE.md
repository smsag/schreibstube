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
  explorer-controller  the file pane: icons, pins, its menu, its sync actions
  pane-sections        the two read-only lists above the tree: bookmarks, latest
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

## Why bookmarks are a Markdown file

Because nothing writes them. A bookmark list that only ever gets read has no
merge problem, no schema migration and no way to corrupt itself: when something
is wrong with it, a person opens the file and fixes it. That is worth more than
an add-bookmark dialog, and it is the one design choice the pane's bookmark
section is built around.

The file also has to survive being edited by hand, so the parser drops what it
cannot use rather than reporting it — a line of prose in the middle of the file
is ignored, and a scheme that must never be opened is dropped while reading,
before it can become a row on a screen.

## Why the file pane has its own state file

Icons and pins are keyed by vault path, and they live in `explorer.json` beside
`data.json` rather than inside it. `data.json` is saved by writing the whole
settings object, so a second device holding a stale copy in memory overwrites
everything the first one wrote — mailbox and publishing state included. A
separate file limits that to icons, and small independent entries make the cheap
fix possible: every entry carries a timestamp, every write re-reads the file and
merges per entry, and the pane polls the file's modification time so a write
delivered by iCloud or Obsidian Sync is picked up rather than clobbered.

Paths move, so the map follows renames (a renamed folder moves everything under
it) and keeps a tombstone for thirty days when a file disappears, because a move
made outside Obsidian arrives as a delete and a create.

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
