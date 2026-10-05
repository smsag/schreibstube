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
24 characters and 10 different ones, never shared between capabilities, and
compared in constant time. Repeated failures from one address
are throttled, an IPv6 caller by its /64, and only time clears them; behind a
hosting platform's proxy set `TRUST_PROXY=true` (or `TRUST_PROXY_HOPS` for more
than one proxy) so the address is the caller's rather than the proxy's. A
request refused before its body arrived is closed, and `/health` names the
bridge's version and capabilities only to a token holder. Request bodies are capped per
route, every outbound operation has a deadline, uploads must hash to what they
claim, the SFTP host key is pinned, and a remote write refuses to follow a
symlink. Nothing is persisted on the bridge.

On the published site, raw HTML from a note is passed through only when the
target allows it (`PUBLISH_<TARGET>_ALLOW_HTML`, on by default for a personal
site, and said in a warning at every start); a vault with more than one author
should turn it off.

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

## The search runtime and the model files

Search by meaning, when it is switched on, runs a language model on the device
with onnxruntime-web. Three kinds of file are involved, and they are treated
according to whether they are executed.

- **The runtime's JavaScript** is bundled into `main.js`, and is therefore part
  of what the release attests. The bundle takes onnxruntime-web's
  WebAssembly-only build, which carries its own loader, and transformers.js's
  default of fetching that loader from jsDelivr is cut out at build time. The
  build fails if `main.js` names a CDN at all (`scripts/check-bundle.mjs`).
- **The runtime's WebAssembly module**, 14 MB, is fetched once per device from
  this repository's own release and kept beside the plugin, like the
  typesetter. `src/services/semantic/search-runtime.json` holds its length and
  SHA-256. A test holds that pin to the file the lockfile installs. The release
  workflow takes the file from the same installed package and refuses it if it
  does not match. The plugin checks the length and the hash after the download
  and on every load, and refuses anything else. The download is bounded in
  size and time. The model does not start without it. No code path fetches
  the module, or any other code, from anywhere else.
- **The model files** (configuration, tokenizer and the quantized ONNX
  weights) come from Hugging Face on first use and are kept in the browser's
  cache. They are data that the pinned runtime reads, not code that it runs,
  but they decide what search finds, and one of the three repositories (the
  Latin-script cut of the multilingual model) is under a personal account. So
  they are pinned too. `src/services/semantic/model-pins.json` names, for each
  model, one commit of its repository and the length and SHA-256 of every file
  the plugin reads from it. The device asks only for those files at that
  commit. It reads each file within its pinned length and checks the hash
  before the library sees a byte of it. It refuses any other request, and a
  model without a complete pin does not load. A size probe the library makes
  at another revision is answered from the pin and never sent.
  `scripts/check-model-pins.mjs` downloads every pinned file at its commit and
  compares it, in CI on every change and before every release. A file read
  back from the browser's cache is not hashed again. It was checked on its way
  in, it is stored under an address that names the pinned commit, and only
  code already running inside Obsidian could change it.

The runtime runs in a module Worker when the platform allows one, and Node's
globals are hidden from that Worker before any of its code runs (`process`,
`require`, `module` and the rest; see `worker-prelude.ts`). The last-resort
fallback is a hidden iframe. That iframe is same-origin and not sandboxed,
because an opaque origin has no Cache Storage, and the model would download
again at every start. Code in that iframe could reach the Obsidian window, so
it is held to the same rule as the Worker: only the attested bundle and the
pinned module run there.

## How a release is made, and how to check one

A release is built and published by the Release workflow, from `main` only,
after someone approves it in the repository's `release` environment. The job
that builds runs with a read-only token and installs without dependency
scripts; the job that publishes holds the write and signing grants and runs
nothing from npm or the repository, only a hash check of the built files and
the GitHub CLI. `CONTRIBUTING.md` has the details.

Every file on a release — `main.js`, `manifest.json`, `styles.css`, the source
map, the Typst runtime and the search runtime — carries a signed provenance
attestation that names
the workflow and the commit it was built from. With the GitHub CLI:

```bash
gh attestation verify main.js -R smsag/schreibstube
```

A file that was changed after the build, or built anywhere else, fails.

The build is also reproducible. From the tagged commit, with the Node version
`.nvmrc` names:

```bash
git clone https://github.com/smsag/schreibstube && cd schreibstube
git checkout 1.75.0                 # the release's tag
npm ci --ignore-scripts
npm run build
sha256sum main.js styles.css manifest.json
```

The three hashes match those of the files attached to the release
(`shasum -a 256` on macOS). The Typst runtime files are not built but checked:
`node scripts/fetch-typst-runtime.mjs` downloads them and compares them with
the hashes committed in `src/services/typst-runtime.ts`. The search runtime is
not built either: `node scripts/stage-search-runtime.mjs` takes it from the
installed onnxruntime-web and compares it with
`src/services/semantic/search-runtime.json`.

## What CI checks

Every change runs the bridge's runtime tree through `npm audit` at the high
level, builds the bridge's Docker image and probes its health route, type-checks
under strict flags, lints for unhandled promises, and proves the plugin bundle
reaches for no Node built-in and names no CDN. It also downloads every pinned
model file at its commit and compares it with its pin. Dependabot opens update pull requests weekly for
both trees, the workflows and the image base. A package or action version is
offered only once it has been public for a week, long enough for most
hijacked releases to be found and pulled; the root's runtime dependency, which
ships inside `main.js`, arrives on its own rather than grouped with the dev
tooling. The image base is pinned by digest, so it changes only through such
a pull request.

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
- The onnxruntime-web that transformers.js 4.3 requires is a nightly build
  (`1.31.0-dev`). It is pinned by the lockfile and the hash above, like any
  other version, but it has had less use than a release.
- The fallback iframe is same-origin, for the reason given above. Its
  containment is that it runs nothing unpinned, not a browser boundary.
