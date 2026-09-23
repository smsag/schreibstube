# Working in this repository

Two pieces: an Obsidian plugin (`src/`) and a Node bridge (`bridge/`). Read
`ARCHITECTURE.md` for what runs where, `CONTRIBUTING.md` for the commands, and
`QUALITY.md` for how the codebase is graded and why the guards below exist.

`npm run check` is the whole gate: lint, format, tests with coverage, build with
the bundle check. Nothing is done until it passes.

## The three principles

Every change is measured against these. They are what keeps a fast-moving
codebase from regressing, and each one is enforced by a check, not by memory.

### 1. Decisions stay pure; wiring stays thin

Anything that decides something — what to match, what to upload, what a
frontmatter key means, which path is safe — lives in `src/services/` or a pure
bridge module, imports neither `obsidian` nor the network, and has a test.
Controllers, views and routes only wire those decisions to the platform, and
are tested against the stub in `src/testing/`. The rule is what keeps the suite
at ten seconds and a phone bug reproducible on a laptop.

_Enforced by:_ `src/services/` has no `obsidian` import (the tests alias it and
would fail to load one); `vitest.config.mts` measures coverage over the decision
modules only.

### 2. Every boundary is validated and budgeted

Anything read from outside the process is untrusted until checked: `data.json`
and `explorer.json` (a user edits them), frontmatter (any plugin writes it), a
request body, a provider or bridge response, a mail body, a file name from a
vault. Anything that leaves the process carries a size limit and a deadline,
and a credential goes to exactly one host. New input follows the existing
shape: a `normalize…` or `check…` function with its own tests, a `MAX_…` bound,
a `withTimeout`/`withDeadline` around the call.

_Enforced by:_ the bridge's body limits and deadlines are per route; the
plugin's every network client goes through `withTimeout`; the bridge audits its
runtime tree in CI.

### 3. The floors only go up

Coverage thresholds, the bundle budget, the lint rules, the TypeScript flags,
the audit level and the Node matrix are ratchets. A change may raise one; it
never lowers one to pass. If the instrument itself changes — a new coverage
engine counts differently — the re-base is its own change, says what was
measured, and lands alone. A number that moved without a sentence explaining
why is a regression.

_Enforced by:_ `vitest.config.mts` thresholds, `scripts/check-bundle.mjs`,
`eslint.config.mjs`, `tsconfig.json`, and the CI audit step. The PR template
asks for the sentence.

## Conventions worth knowing

- User-visible strings live in `src/i18n/`; English is the type, German must
  satisfy it. Frontmatter keys are prefixed `schreibstube`, without exception.
- Comments explain why, never what. A commit message says what changed for the
  user and why, in prose; `CHANGELOG.md` gets an entry for every user-visible
  change under `## Unreleased`.
- Undocumented Obsidian internals live in `src/services/workspace-internals.ts`,
  feature-detected, and nowhere else.
- The bridge and the plugin version independently; a request or response shape
  change bumps `PROTOCOL_VERSION` and the table in `bridge/README.md`.
- Never put a model identifier, a session link or a tool name into code,
  comments or docs.
