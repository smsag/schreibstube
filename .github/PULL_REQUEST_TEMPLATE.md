## What changed and why

<!-- One paragraph. The "why" is the part a reviewer cannot get from the diff. -->

## The three principles

<!-- See CLAUDE.md. Tick what applies; a box you cannot tick is worth a sentence. -->

- [ ] **Decisions stay pure.** New logic lives in `src/services/` or a pure bridge module, without `obsidian` or network imports, and has a test.
- [ ] **Every boundary is validated and budgeted.** Anything read from a file, a request, a response or a frontmatter key is checked before use, and anything that leaves the process has a size limit and a deadline.
- [ ] **The floors only go up.** Coverage thresholds, the bundle budget and the lint rules are unchanged or stricter. If a number moved, the reason is in this description.

## Checked on

- [ ] `npm run check` passes locally
- [ ] Mobile, if the change touches the file pane, the overlay or anything that renders
