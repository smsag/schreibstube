# Quality review

A review of the repository against the software quality attributes — correctness,
reliability, robustness, performance, usability, verifiability, reusability,
portability, understandability, interoperability, productivity, timeliness,
visibility — with security and cost of ownership added, since both were asked
for and both are where a plugin that talks to a mailbox and a web host earns
or loses trust.

Each attribute is graded 1 to 5 before and after the changes in this review.
The grades are a working engineer's judgement backed by the evidence in the
row; the numbers under **Measured** are reproducible with `npm run check`.

## Summary

The codebase was already unusually disciplined: pure decision modules with
1,222 tests in nine seconds, every boundary validated, documentation that
explains why. What it lacked was the guards that keep it that way, and one
expensive default that nobody had measured.

| Attribute         | Before | After | What changed                                                                                                                                                 |
| ----------------- | :----: | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Correctness       |   4    |   4   | `noImplicitOverride` guards every Obsidian lifecycle override; type-aware lint for unhandled promises. Both found nothing today, which is the point.         |
| Reliability       |   4    |  4.5  | Behind a proxy, one stranger's five bad tokens locked the real user out for a minute. `TRUST_PROXY` keys the throttle on the caller.                         |
| Robustness        |  4.5   |  4.5  | Unchanged: settings, frontmatter, bodies, hashes and paths were already validated; limits and deadlines everywhere.                                          |
| Performance       |   2    |   4   | Production bundle 1,595 KB → 277 KB by moving the source map out; a 400 KB budget fails the build. Tests 9.3 s → 7.5 s on Vitest 5.                          |
| Usability         |  3.5   |   4   | `manifest.json` still described a heading overlay; it now says what the plugin is. Stale `BRIDGE_TOKEN` guidance replaced; secrets to mark are listed.       |
| Verifiability     |   4    |  4.5  | 66 files, 1,233 tests; the Docker image is built and booted in CI; the release refuses a version that disagrees with the manifest or has no changelog entry. |
| Reusability       |   4    |   4   | Unchanged: provider adapters, pure protocol modules, one retry and one timeout helper shared by every client.                                                |
| Portability       |  4.5   |  4.5  | The bundle check still proves no Node built-in; the bridge's engine claim (`>=22.12`) now matches what CI tests and Docker runs.                             |
| Understandability |  4.5   |  4.5  | Documentation is a model. Two files remain oversized (`explorer-view.ts` 2,091 lines, `main.ts` 876) — see Later.                                            |
| Interoperability  |   4    |   4   | Unchanged: versioned bridge protocol, documented API, stable error codes with request ids.                                                                   |
| Productivity      |   4    |  4.5  | Dependabot grouped weekly; PR template; CI runs on supported Node versions only; lint stays under seven seconds with type information.                       |
| Timeliness        |   4    |   4   | Release script and workflow were sound; the workflow now fails fast on the two mistakes it could not catch.                                                  |
| Visibility        |   3    |   4   | `SECURITY.md`, this review, `CLAUDE.md`; audit and image build in CI; source map attached to each release for symbolicating reports.                         |
| Security          |  3.5   |  4.5  | Both audits clean (were 8 root, 1 bridge); workflow token read-only; deterministic image build; proxy-aware throttle.                                        |
| Cost of ownership |   3    |   4   | One fewer CI matrix leg; a bundle a fifth the size on every start and every sync; no manual dependency chasing; no rebuild-to-discover image failures.       |

### Measured

| Number                             | Before             | After                                         |
| ---------------------------------- | ------------------ | --------------------------------------------- |
| `main.js` shipped to every vault   | 1,595 KB           | 277 KB (budget 400)                           |
| Tests / files / wall time          | 1,222 / 65 / 9.3 s | 1,233 / 66 / 7.5 s                            |
| `npm audit` root (dev tree)        | 8 (2 critical)     | 0                                             |
| `npm audit --prefix bridge`        | 1 high             | 0                                             |
| Lint wall time                     | ~3 s               | ~7 s (type-aware)                             |
| Coverage floors (lines/fn/stmt/br) | 70 / 85 / 70 / 85  | 77 / 72 / 76 / 74 (new instrument, see below) |
| CI legs per change                 | 2 (Node 20, 22)    | 2 (Node 22, 24) + image build                 |
| Workflow token permissions         | default (write)    | `contents: read`                              |

**About the coverage floors.** Vitest 5 maps the V8 profile through the AST,
which counts arrow functions and short-circuit branches the previous remapping
never saw. The same suite measures 79 / 74 / 78 / 76 under it against
77 / 87 / 77 / 91 before. The floors were re-based to the same margin under the
new instrument, in the same change, with this sentence. That is the one
exception the third principle allows.

## What was found

### Performance: the bundle carried its own source map

`esbuild.config.mjs` set `sourcemap: "inline"` in production so that a stack
trace in a user report would name a TypeScript line. The cost was a `main.js` of
1.6 MB, parsed by Obsidian on every start, on every device, and copied by every
sync client on every release. Minified without the map the same bundle is 277 KB;
the map is 989 KB on its own.

The map is now written beside the bundle and attached to the GitHub release.
Obsidian installs three files and the map is not one of them, so no vault ever
loads it. esbuild's `external` mode adds no `sourceMappingURL` comment either,
so devtools never look for a file that is not there. A reported stack trace is
read with `npm run trace -- <release>`, which fetches that release's map and
rewrites every `plugin:schreibstube:line:column` in a pasted console dump to
its TypeScript position (`scripts/source-map.mjs`, pure and tested). The bundle
check gained a size budget so the next inlined artefact fails the build rather
than shipping.

### Security: the throttle could not tell callers apart behind a proxy

The bridge's README recommends Sliplane, whose proxy terminates TLS. Every
request then arrives from the proxy's address, and the authentication throttle
— five failures per address per minute — was keyed on exactly that. Any
stranger sending five wrong tokens locked the plugin's owner out for a minute,
repeatably, at no cost.

`TRUST_PROXY=true` reads the last hop of `X-Forwarded-For`, the one the trusted
proxy appended, which a client cannot forge. It is off by default because
without a proxy the header is the client's to choose. Two process-level tests
cover both directions: a spoofed header is ignored when untrusted, and a
stranger's lockout does not reach the user when trusted.

### Security: dependencies

The root tree carried eight findings, two critical, all in Vitest 2 and its
Vite; the bridge carried `lodash-es` through Mermaid's parser, for which the
README said no fix existed. A fix exists now. Vitest and esbuild are current,
`lodash-es` is pinned by an `overrides` entry, and CI audits the bridge's runtime
tree at the high level on every change. The root tree is build tooling only —
the plugin bundles nothing — so it is not gated, but Dependabot keeps it moving.

Vitest 5 requires Node 22.12, which retired Node 20 from the matrix. Node 20 has
been out of support since April 2026; testing on it spent CI minutes to prove a
claim the bridge should no longer make. Its `engines` field now says `>=22.12`,
which is what the Dockerfile runs.

### Deployments: what CI could not see

- The workflow token had default permissions; it now has `contents: read`.
- The Dockerfile fell back from `npm ci` to `npm install`, so a drifted lockfile
  built an image from whatever the registry had that day. The fallback is gone.
- Nothing built the image before a deploy did. A CI job now builds it, boots it
  with a minimal mail configuration, and probes `/health`.
- The release workflow accepted any version string and would have tagged a
  release whose manifest said something else, or with empty notes. It now
  checks the input against `manifest.json` and `package.json` and refuses an
  empty changelog section.
- No Dependabot. Weekly, grouped by tree, majors on their own.

### Correctness: two flags that cost nothing today

`noImplicitOverride` marks every Obsidian lifecycle method the plugin overrides
— twenty-two sites, all now explicit — so a renamed or removed base method fails
to compile instead of silently never being called. `noFallthroughCasesInSwitch`
had zero findings. The type-aware promise rules (`no-floating-promises`,
`no-misused-promises`, `await-thenable`) had zero findings across the plugin;
the lint config's own comment had promised an unhandled promise would be
caught, and now it is. Type information adds four seconds to lint.

`exactOptionalPropertyTypes` (13 errors) and `noUncheckedIndexedAccess` (278)
were measured and left for a dedicated change.

### Usability: what the plugin says about itself

`manifest.json` — the one line a person reads before installing — still
described the plugin as a heading overlay. The bridge README told operators to
mark `BRIDGE_TOKEN` as a secret, a variable that has not existed since bridge
2.0, and did not mention the SSH key or the publish token. Both are fixed.

## The second pass

Everything the first pass left open, done on the same branch.

### Cost: the bridge image carried 205 MB it never ran

A production install of the bridge is 238 MB, and 167 MB of that exists only
because Mermaid's package declares its parser's dependencies. The bridge reads
one 5.4 MB file from the package and copies it into a published site; nothing
in the tree executes. The Dockerfile now installs in a build stage, keeps that
one file under `vendor/`, and uninstalls the package; the runtime tree is 33 MB.
`assets.mjs` looks in `vendor/` first and falls through to the package, which
is what a checkout uses, and `firstReadable` is tested. CI's image job checks
that the file is present and the tree is gone.

### One Node everywhere

The bridge's `engines` said 20, its image ran 22, CI tested 20 and 22, the
release used 22. Now `.nvmrc` says 24 — the current LTS — and the image, CI,
the release and both `engines` fields read from or agree with it. One CI leg
instead of two, and a version that is claimed is the version that is run.

### Supply chain: pinned actions and provenance

`actions/checkout`, `actions/setup-node` and `actions/attest-build-provenance`
are pinned by commit with the version in a comment, which Dependabot keeps
current. The release workflow attests the four assets it publishes, so a vault
owner can verify that the `main.js` on a release was built by this workflow
from the tagged commit. The repository is public, which is what makes the
attestation verifiable.

### `imapflow` 2

Its only breaking changes are a Node floor the image already had and the
removal of a `lib/` path the bridge never imported. The API the bridge uses —
connect, mailbox lock, search, fetch, append, logout — is unchanged, and the
suite's fake IMAP client still exercises every path.

### The file pane's view, split

`explorer-view.ts` was 2,091 lines. It is 1,296, and what left it is now
readable on its own:

| Module                    | Holds                                                         | Tests |
| ------------------------- | ------------------------------------------------------------- | :---: |
| `ui/explorer-gestures.ts` | the press-hold-move drag, edge scrolling, the long-press menu |   —   |
| `ui/explorer-drop.ts`     | where a drag may land, in the tree and in the pinned block    |   4   |
| `ui/explorer-section.ts`  | a section header: chevron, count, mark, end control           |   —   |
| `ui/explorer-memory.ts`   | what the pane remembers per device, read defensively          |   8   |
| `services/file-glyph.ts`  | which icon a file gets — a decision, so a service             |   5   |

The cut was made at the seams the code already had: the drag gesture shared
one piece of state with the view (which row is being carried), the drop
targets needed only a root element, the header needed only to be told whether
it is closed, and the memory needed only the app's storage. Every function
moved with its comment; no behaviour changed, which the mobile checklist
should confirm before the next release since nothing here can run a phone.

### The last two strict flags

`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. See the
commit for the count of sites each touched; the rule for fixing them was a
guard or a default where undefined is genuinely possible, and a non-null
assertion only where the preceding lines prove the invariant, with a comment.

## What was not changed, and why

- **`main.ts` at 876 lines.** Command registration and lifecycle wiring; it
  reads top to bottom and is excluded from coverage by design. Worth splitting
  only when a fourth controller arrives.
- **Vitest's `isolate: false`.** It reports 2.4 s to gain; the i18n module
  and the `window` stub hold global state that would need auditing first.
- **A coverage floor for controllers.** The fake app does not cover the pane
  view yet; a floor over code it cannot reach would be a number, not a guard.

## Now / Next / Later

**Now** (this branch): everything above.

**Next**: run the mobile checklist on the split pane before releasing 1.23.0;
set `TRUST_PROXY=true` on the deployed bridge; confirm the first attested
release verifies with `gh attestation verify`.

**Later**: `main.ts` when a fourth controller arrives; controller coverage once
the fake app covers the pane.

## The three principles

They live in `CLAUDE.md`, where an agent reads them before touching a file, and
in the PR template, where a reviewer sees them ticked. In one line each:

1. **Decisions stay pure; wiring stays thin.**
2. **Every boundary is validated and budgeted.**
3. **The floors only go up.**
