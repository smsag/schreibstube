# Print templates

Two templates to copy into a vault: a German business letter and a CV. Each is
a folder, and a folder is all a template is.

## Installing one

Copy the folder into the templates folder the settings name — `Vorlagen/Druck/`
unless you changed it — and open its `template.md`. The frontmatter at the top
is what the template needs; the prose under it is how to use it.

```
Vorlagen/Druck/Brief/
  template.md     what it needs, and how to use it
  template.typ    how the page is laid out
  fonts/          the faces it sets in
```

The folder's name is the template's name. A note asks for it by that name:

```yaml
---
schreibstubePrintTemplate: Brief
---
```

## Fonts

Neither template ships fonts, because typefaces are licensed and a repository
is not a place to redistribute them. Put your own `.ttf` or `.otf` files in the
template's `fonts/` folder and the template will set in them.

Both examples ask for **Fira Sans**, which is free and available from Google
Fonts. The CV also uses its condensed cut for headings, so a long German job
title stays on one line. Fira registers that cut as a _width_ on the same
family rather than as a family of its own, which is why the layout asks for it
with `stretch: 75%` rather than by name — a font that names its condensed cut
separately would be asked for by name instead.

With no fonts at all a template still prints: Typst sets it in its own built-in
face. It will look like a document, just not like yours.

## Writing your own

Start from the closer of these two and change the layout. `template.typ`
defines one function that takes the note's body and the data, and returns the
page. Everything Typst can do is available; what it may not do is reach outside
its own folder or use a package, because printing happens on the device with no
network.

The helpers a converted note calls — `schreibstube-image`, `-diagram`,
`-code`, `-table`, `-callout`, `-task` — have defaults, and a template that
wants a different look defines its own at the top level of `template.typ`. See `PRINTING.md` in the
repository for the whole contract.
