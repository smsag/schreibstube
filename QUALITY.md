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

## What was not changed, and why

- **`explorer-view.ts` at 2,091 lines and `main.ts` at 876.** Both are wiring,
  not decisions, and both are excluded from coverage by design. Splitting the
  pane view into its sections (pinned, bookmarks, latest, tree, drag) would
  make each reviewable; it is a refactor that deserves its own change with the
  mobile checklist run after it.
- **`imapflow` 1 → 2.** A major with no mailbox to test against here.
- **Pinning actions to commit SHAs.** Worth doing once Dependabot is opening
  the update pull requests that make pinned SHAs maintainable.
- **Vitest's `isolate: false`.** It reports 2.4 s to gain; the i18n module
  and the `window` stub hold global state that would need auditing first.
- **The remaining strict flags** above.

## Now / Next / Later

**Now** (this change): everything in the table.

**Next**: split `explorer-view.ts` by section; pin action SHAs; `imapflow` 2 with
a mailbox to test against; measure the bridge image and consider a multi-stage
build if Mermaid's tree dominates it.

**Later**: `exactOptionalPropertyTypes`, then `noUncheckedIndexedAccess`;
provenance attestation on releases; a coverage floor for controllers once the
fake app covers the pane.

## The three principles

They live in `CLAUDE.md`, where an agent reads them before touching a file, and
in the PR template, where a reviewer sees them ticked. In one line each:

1. **Decisions stay pure; wiring stays thin.**
2. **Every boundary is validated and budgeted.**
3. **The floors only go up.**
