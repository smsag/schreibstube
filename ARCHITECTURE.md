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
  property-controller  property icons and today's date in the Properties view
  property-set-controller  property sets: the folder, Templater, and the four ways a set is offered
  semantic/            search by meaning: the model, the vault index, conversations, the API
services/            pure decisions, no Obsidian imports, heavily tested
platform/            the network clients and the bootstrap: what talks to Obsidian or the wire, and no decisions
processors/          editor extensions and reading-view post-processors
print/               the Typst compiler and the worker it runs in
pdf/                 the PDF reader borrowed from Obsidian, and the preview it draws
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

## Search by meaning, and the API

One language model runs on the device, and only Schreibstube loads it. It keeps
two indexes in the plugin folder: the vault's notes (a description note stands
for its picture), and the conversations a chat plugin hands over. Pythia keeps
its chats in its own data file, outside the vault, so it lists them through the
API rather than the index finding them. The decisions came from Pythia after it
was hardened for the phone, and live in `services/semantic/`; the wiring is in
`controllers/semantic/`.

The desktop keeps the vault index; a phone holds it. A phone never builds on
its own — a first build there ran for over an hour and iOS may end it whenever
Obsidian goes to the background — so it reads the synced file, answers from it
finished or not, and reads it again when the desktop has written a newer one.
**Build now** on a phone embeds a budget of notes and merges what the desktop
wrote meanwhile before it writes, so the two devices do not undo each other
through the one file. The phone's own edits are embedded on the phone, each
note when its writer moves on to another and never on a quiet clock, since an
embed there is a model load; they go to a journal of its own
(`…phone-journal.bin`), tied to the desktop's base like the shared journal and
ignored once the desktop writes a new one. A build
answers queries while it runs, and a note whose
embed fails on the desktop — not by a deadline — is kept as a row without
vectors, so it is not retried until its text changes.

A vector depends on the code that runs the model as well as on the model: a
new transformers or onnxruntime-web can move every one of them. Each row's hash
therefore ends in the runtime generation that embedded it
(`EMBEDDING_RUNTIME` in `services/semantic/embedding-models.ts`), a device reuses
only rows of its own generation, and an index finished under an older one reads
as unfinished, so the desktop rebuilds it. Until that rebuild reaches a note,
its old row keeps answering — a slightly different ranking for a while is
better than an empty Recommended, above all on a phone that waits for the
desktop. A test holds the generation to the versions in the lockfile, so a
dependency bump cannot land until someone has measured whether the vectors
moved.

The Explorer filter reads note text too, separately from the model: a
vocabulary of every note's words (`services/body-index.ts`), read once when the
filter is first used. Both it and the model read a note through
`services/note-text.ts`, which drops frontmatter, code, URLs and encoded data.

Other plugins reach it as `app.plugins.getPlugin("schreibstube").api`, version 2:

```ts
api.status(); // "off" | "loading" | "partial" | "ready"
api.kinds(); // [{ kind, label, source }]: the vault's two and every allowed source's
api.search(text, { kinds?, sources?, limit?, exclude? });
api.related({ path } | { source, id }, { kinds?, sources?, limit? }); // stored vectors, no model
api.registerSource(pluginId, { kind, label, plural, icon?, list, onChanged,
  open?, link?, ids?, changedSince? }); // → { release(), consent() }
api.onIndexChanged(cb); // what a search can find changed; at most once a second
```

Any plugin may register a source; each is one index file of its own
(`semantic-source-<id>-…bin`), so sources never share rows or ids. Plugins are
not isolated from each other and a name cannot be proved, so the gate is the
person: a source is read only once allowed, from a notice when it first
registers or in the settings, where the answer is also taken back. The name
must be an enabled plugin's where the registry can say so. Everything a source
hands over is untrusted: checked, bounded to 1 000 items of 40 000 characters
and eight sources, and given five seconds to answer. A source with `ids()` and
`changedSince()` is asked only for what changed after its first listing.

Each item is `{ id, title, updatedAt, summary?, messages? | text?, notes? }`.
`notes`, optional, are vault paths attached to the item as context: Recommended
counts them as a link between the item and each note, and they are not
embedded. A hit names an item `<source>:<id>` and carries both halves.

A hit's `score` is its relevance, 0 to 1, read against the floor measured for
what was compared — note to note, note to item, a query to either — so kinds
rank alike in one list; its raw cosine is `similarity`. `limit` is clamped to
50, and a failure inside a question is answered with nothing rather than
thrown into the caller; a registration that cannot be taken throws.

The other direction is printing. Pythia publishes an API of its own
(`app.plugins.getPlugin("pythia").api`, version 1) that hands a print a copy of
a note with each linked conversation's summary as a footnote, and refreshes
those summaries when asked. `readPythiaPrintApi` in
`services/workspace-internals.ts` finds it; `services/pythia-print.ts` checks
every answer before the print uses it. See PRINTING.md, "Pythia's footnotes".

## Why the file pane has its own state file

Icons and the two marks are keyed by vault path, and they live in `explorer.json` beside
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
