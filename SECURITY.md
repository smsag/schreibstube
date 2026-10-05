# Security

## Reporting

Open a private security advisory on the repository (Security → Report a
vulnerability) rather than a public issue. Say which piece is affected — the
plugin, the bridge, or a published site — and what a reproduction needs. Expect
an acknowledgement within a week.

## What holds a secret, and where

| Secret                                   | Lives in                                     | Never reaches           |
| ---------------------------------------- | -------------------------------------------- | ----------------------- |
| LLM API key, GitHub token, bridge tokens | Obsidian's secret storage, by name           | `data.json`, the bridge |
| Mailbox password, SSH key, host key      | The bridge's environment                     | The vault, any response |
| A vault's notes                          | The vault; the bridge sees only what is sent | Logs (message IDs only) |

Each credential is sent to exactly one host: a GitHub token only to GitHub, a
provider key only to that provider's endpoint, a bridge token only to the
configured bridge URL, which must be HTTPS unless loopback. A mail token opens
no publish route and the other way round.

## The perimeter

The bridge is a public URL guarded by per-capability bearer tokens of at least
24 characters, compared in constant time. Repeated failures from one address
are throttled; behind a hosting platform's proxy set `TRUST_PROXY=true` so the
address is the caller's rather than the proxy's. Request bodies are capped per
route, every outbound operation has a deadline, uploads must hash to what they
claim, the SFTP host key is pinned, and a remote write refuses to follow a
symlink. Nothing is persisted on the bridge.

On the published site, raw HTML from a note is passed through only when the
target allows it (`PUBLISH_<TARGET>_ALLOW_HTML`, on by default for a personal
site); a vault with more than one author should turn it off.

## Text from somebody else

Obsidian renders an embed, raw HTML and a remote image as soon as a note is
shown, and other plugins run code a note holds — Dataview a `dataviewjs`
fence or an inline `$=` span, Templater a `<% %>` tag, JS Engine, Datacore,
Meta Bind and Buttons their blocks — with Obsidian's rights, which on a
desktop are the machine's. Everything the plugin writes into a note on
someone else's behalf goes through one module, `src/services/foreign-text.ts`:

- A mail's subject, sender and body, and the names of attachments left out of
  an import, are escaped so they show and build nothing: no link or embed, no
  HTML, comment or Templater tag, no backtick and no fence.
- A summary or an AI table keeps its formatting, and any executing construct
  the selection did not already hold is disarmed, with a notice.
- A proof-read card or a source update that brings such code carries a "runs
  code" badge and is left out of "Accept all".
- A picture description has links, images, HTML, comments and code taken out.
- A proposed file name has invisible characters removed and must pass the same
  check as a name typed by hand.

Every answer from a model provider, the exchange-rate service and the
typesetter's download is held to a size as well as a deadline, by its declared
length and by its bytes. Folder settings read from `data.json` refuse `..`, a
backslash, a control character and any segment starting with a dot, so none
can point at the config folder. The `obsidian://schreibstube-new-doc` link
reads nothing it is given and acts at most once every five seconds.

## The typesetter the plugin downloads

Printing runs Typst as WebAssembly on the device. The module is 28 MB, so it is
not in the plugin bundle: it is fetched once per device from this repository's
own release and kept beside the plugin.

Those bytes are executed, so they are pinned. `src/services/typst-runtime.ts`
holds a SHA-256 for each of the two files; the release workflow downloads them
from npm and refuses to publish if they do not match, and the plugin hashes
them again — after the download and on every later start, since the cache sits
in a folder a person can open — and refuses to load anything else. A template
is compiled with no file system and no network: only the job's own files, and
no Typst package may be imported.

## What CI checks

Every change runs the bridge's runtime tree through `npm audit` at the high
level, builds the bridge's Docker image and probes its health route, type-checks
under strict flags, lints for unhandled promises, and proves the plugin bundle
reaches for no Node built-in. Dependabot opens grouped update pull requests
weekly for both trees, the workflows and the image base.

## Known limits

- The bridge runs as one instance; the throttle and the per-target publish lock
  are in memory and would not be shared by a second replica.
- The plugin sends note text to the configured LLM provider when asked to
  proof-read, rename or summarize. Which provider, and what is excluded
  (frontmatter, code, tables, math, links), is documented in `README.md`.
- Document sync downloads what a note's `schreibstubeSyncedFrom` names, and any
  note that reaches the vault — synced, imported, pasted — can carry that key.
  With sync and the background poll on, the plugin requests that URL on a
  schedule, which its owner can see; nothing is written into the note until a
  person accepts it. A mirrored note shows remote images, which tell their host
  when the note is opened. Obsidian's request API follows redirects, so the
  HTTPS and Markdown-extension checks hold for the URL the note names, not for
  where a server redirects it; the GitHub token is attached only to requests
  the plugin addresses to `api.github.com`.
- Neutralising code covers the plugins named above. A plugin that runs some
  other construct from a note's text is not known to this one.
- The plugin bundles one runtime dependency, the model runtime that search by
  meaning starts; CI audits it with the bridge's tree. Everything else in the
  root tree is build tooling and affects the build machine only.
