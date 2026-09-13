# Contributing

## Setup

Node 24 — `.nvmrc` names it, and it is the one version CI runs, the bridge's
image ships, and both `engines` fields require. Then:

```bash
npm run setup     # installs the plugin's dependencies and the bridge's
npm run check     # lint, format, tests with coverage, build
```

The test suite covers the bridge as well as the plugin, and the bridge keeps its
own dependency tree. `npm test` says so if it is missing rather than failing on
a module resolution error.

## The checks

| Command                 | What it does                                                           |
| ----------------------- | ---------------------------------------------------------------------- |
| `npm run lint`          | ESLint over the plugin and the bridge                                  |
| `npm run format`        | Prettier, in place                                                     |
| `npm test`              | The whole suite, plugin and bridge                                     |
| `npm run test:coverage` | The same, against the coverage floor                                   |
| `npm run build`         | Type check, bundle, prove it has no Node built-ins and fits the budget |
| `npm run build:icons`   | Regenerate the bundled icon font, only when the set changes            |

The coverage floor is a floor, not a target. Raise it when the number rises;
never lower it to make a change pass. The same goes for the bundle budget in
`scripts/check-bundle.mjs` and the lint rules: `CLAUDE.md` states the three
principles every change is measured against, and the pull request template
asks for them.

## Conventions

- `src/services/` never imports `obsidian`. Anything that needs the app is a
  controller, and controllers are tested against the stub in `src/testing/`.
- User-visible strings live in `src/i18n/`. English is the reference catalogue
  and gives the type; German has to satisfy it, so an untranslated string does
  not compile.
- Comments explain why, not what. If a line needs a comment to say what it does,
  the line is the problem.
- Undocumented Obsidian internals live in `src/services/workspace-internals.ts`,
  feature-detected, and nowhere else.
- The icon set is a list of names in `scripts/icon-set.mjs`. Changing it needs
  the font package and Python once:

  ```bash
  npm install --no-save @tabler/icons-webfont
  pip install fonttools brotli
  npm run build:icons
  ```

  The generated `src/ui/icon-font.generated.ts` is committed, so nobody else
  needs either. Icons are stored by name; a font upgrade changes the generated
  map, never a vault's data.

## Reading a stack trace from a report

The release's `main.js` is minified, so a trace from a user names positions
like `plugin:schreibstube:12:48213`. The map that reads them is attached to
every release as `main.js.map`, and never installed in a vault:

```bash
npm run trace -- 1.23.0 "at t.onload (plugin:schreibstube:12:48213)"
pbpaste | npm run trace -- 1.23.0          # a whole console dump
npm run trace -- ./main.js.map < report.txt  # against a local build
```

Every position the map knows becomes `src/…​.ts:line:column`; the rest of the
trace passes through untouched.

## Before a release: the mobile checklist

The plugin's mobile support is architectural — no Node built-ins in the bundle,
everything over `requestUrl` — and the build proves the first half. The second
half is worth ten minutes on a phone, once per release:

1. Open a vault on iOS or Android and confirm the plugin loads with no error.
2. Scroll a long note: the heading stack appears and follows.
3. Turn on focus mode, type a paragraph, turn it off.
4. Run **Proof-read note** on a short note and accept one suggestion.
5. Run **Publish** on a small folder against a throwaway target, and open the
   site in the phone's browser.
6. Send one note as an email and confirm it arrives.
7. Open the file pane: the icons draw (an empty square means the font did not
   load), a long press opens the menu, and "More actions" opens as a drill-down
   rather than doing nothing.

Record the result in the release notes. A claim that has not been checked on a
phone since the last release is a claim about the code, not about the app.

## Releasing

```bash
npm run release -- 1.8.0
```

The script bumps `manifest.json`, `package.json` and `versions.json` together,
which is the part that used to be three edits and a chance to get one wrong. It
refuses a version that is not newer than the current one, and refuses a dirty
working tree.

Then commit, tag, and run the Release workflow with the same version.

## The bridge

The bridge versions independently of the plugin, and the pair has to stay
compatible. `bridge/README.md` carries the table; `/health` reports the version
the deployment is actually running, and the plugin says so when it is behind.
