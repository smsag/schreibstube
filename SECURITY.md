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
configured bridge URL, which must be HTTPS unless loopback. That URL syncs with
the vault and the token does not, so each device remembers where it sent each
token and asks before sending it to another origin. A mail token opens no
publish route and the other way round, and a publish target may have a token
that alone opens it.

## The perimeter

The bridge is a public URL guarded by per-capability bearer tokens of at least
24 characters, compared in constant time. Repeated failures from one address
are throttled; behind a hosting platform's proxy set `TRUST_PROXY=true` so the
address is the caller's rather than the proxy's. Request bodies are capped per
route, every outbound operation has a deadline, uploads must hash to what they
claim and begin like the format they name, the SFTP host key is pinned, and a
remote write, deletion or pruning refuses to follow a link at any directory
below the root. A publish writes only files the bridge wrote before, takes a
bounded amount between commits, and stops writing the moment its request runs
out of time. Nothing is persisted on the bridge.

On the published site, raw HTML from a note is passed through only when the
target allows it (`PUBLISH_<TARGET>_ALLOW_HTML`, on by default for a personal
site); a vault with more than one author should turn it off. An uploaded SVG is
held to an allow-list of drawing elements and attributes, and where the bridge
writes `.htaccess` files the site carries a content security policy and serves
SVGs in a sandbox (`PUBLISHING.md` has the same for nginx and Caddy). A
target's state directory, which holds the published notes' text, is kept out
of the web root unless the operator says the host allows nothing else. Mail bodies merged
into a note are escaped so a sender cannot embed a vault file into it.

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
- The plugin bundles one runtime dependency, the model runtime that search by
  meaning starts; CI audits it with the bridge's tree. Everything else in the
  root tree is build tooling and affects the build machine only.
