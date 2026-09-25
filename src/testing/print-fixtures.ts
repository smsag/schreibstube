/**
 * Notes and templates the typesetter is run against in CI.
 *
 * The converter's tests compare strings, and a string can be exactly what the
 * test expects and still be Typst that does not compile — every callout failed
 * that way while its test passed. So `scripts/check-print-compile.mjs` builds
 * a job from every case here, for every template, with the same pure modules a
 * print uses, and hands it to the pinned runtime.
 *
 * A case is kept small and named for what it guards, so a failure reads as the
 * construct that broke. Add one with every converter fix.
 */
import { markdownToTypst } from "../services/markdown-typst";
import { buildJob, jobAssetPath, type JobFile, type PrintJob } from "../services/print-job";
import { resolvePrintData } from "../services/print-data";
import { parseTemplate } from "../services/print-template";
import { applyOptions, initialOptions, type MarginPreset } from "../services/print-options";

export interface PrintCase {
  name: string;
  markdown: string;
  /** The note's properties, printed as the dialog prints them when asked. */
  properties?: [string, string][];
  /** A margin preset from the dialog, instead of the template's own. */
  margin?: MarginPreset;
}

export const PRINT_CASES: readonly PrintCase[] = [
  { name: "paragraph", markdown: "Ein Absatz mit Umlauten: äöü ß.\n\nUnd ein zweiter." },
  { name: "headings", markdown: "# Eins\n\n## Zwei\n\n### Drei\n\nText." },
  {
    name: "inline",
    markdown:
      "**fett**, *kursiv*, ***beides***, ~~weg~~, ==markiert==, `code` und [Link](https://example.de)."
  },
  {
    name: "expression-before-bracket",
    markdown:
      "Die Funktion `f`(x), die Datei `package`.json, **Anmerkung**(siehe unten), " +
      "*kursiv*[^1] und [Seite](https://example.de)(Quelle).\n\n[^1]: Fußnote"
  },
  {
    name: "escapes",
    markdown: "#hashtag $5 @name <tag> a/b //kommentar 1. kein Punkt\n= kein Titel"
  },
  { name: "lists", markdown: "- a\n- b\n  - c\n\n3. drei\n4. vier\n\n- [ ] offen\n- [x] erledigt" },
  {
    name: "table",
    markdown: "| Pos | Leistung | Preis |\n|:---:|:---|---:|\n| 1 | `x`(1) | **5,99 €**. |\n| 2 | |"
  },
  { name: "single-column-table", markdown: "| a |\n|---|\n| 1 |" },
  { name: "quote", markdown: "> Ein Zitat[^q]\n\n[^q]: Die Quelle" },
  {
    name: "callout",
    markdown: "> [!warning] Achtung\n> Der Text mit **fett**(Klammer)\n\n> [!tip]\n> Ohne Titel"
  },
  { name: "footnote-cycle", markdown: "Text[^a]\n\n[^a]: A[^b]\n[^b]: B[^a]" },
  { name: "code", markdown: "```ts\nconst a = `x`; // #not typst\n```" },
  {
    name: "long-code",
    markdown: "```\n" + Array.from({ length: 150 }, (_, i) => `zeile ${i}`).join("\n") + "\n```"
  },
  {
    name: "long-callout",
    markdown:
      "> [!note] Lang\n" + Array.from({ length: 80 }, (_, i) => `> Absatz ${i}\n>`).join("\n")
  },
  {
    name: "image",
    markdown: "Vor dem Bild.\n\n![Ein Bild](bild.png)\n\n![[bild.png|Eingebettet]]"
  },
  {
    name: "diagrams",
    markdown:
      "## Ablauf\n\n```mermaid\nA\n```\n\n> [!note]\n> ```mermaid\n> B\n> ```\n\n```mermaid\nC\n```"
  },
  { name: "rule-and-break", markdown: "oben<br>\nunten\n\n---\n\nnächste Seite" },
  { name: "empty", markdown: "" },
  {
    name: "properties",
    markdown: "# Titel\n\nText.",
    properties: [
      ["autor", "Steffen"],
      ["tags", "brief, anfrage"],
      ["quote", '"); #panic("']
    ]
  },
  { name: "small-margin", markdown: "Text mit kleinem Rand.", margin: "small" },
  { name: "wide-margin", markdown: "Text mit breitem Rand.", margin: "wide" }
];

/** A template as the script finds it: a folder's descriptor frontmatter and layout. */
export interface FixtureTemplate {
  folder: string;
  frontmatter: Record<string, unknown>;
  layout: string;
  /** Files the template folder carries beside the layout, such as a photo. */
  assets?: JobFile[];
  fonts?: JobFile[];
}

export interface FixtureJob {
  /** `template/case`, which is what a failure is reported as. */
  name: string;
  job: PrintJob;
  /** Whether the note puts text on the page, which a page without a font cannot show. */
  hasText: boolean;
}

/**
 * The smallest valid PNG, one grey pixel. A case's pictures and diagrams all
 * point at it: what is checked is that the placement compiles, not the picture.
 */
export const PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg=="
  ),
  (char) => char.charCodeAt(0)
);

/** Every case, for every template, as the job a print would hand the compiler. */
export function fixtureJobs(templates: readonly FixtureTemplate[]): FixtureJob[] {
  const jobs: FixtureJob[] = [];

  for (const fixture of templates) {
    const { template: own } = parseTemplate(fixture.folder, fixture.frontmatter);

    for (const printCase of PRINT_CASES) {
      const template = applyOptions({
        ...initialOptions(own),
        margin: printCase.margin ?? "standard"
      });
      const pictures = new Map<string, JobFile>();
      const assigned = new Map<string, string>();
      const place = (path: string): string => {
        pictures.set(path, { path, bytes: PIXEL_PNG });
        return path;
      };

      const conversion = markdownToTypst(printCase.markdown, {
        hrIsPageBreak: template.hrIsPageBreak,
        properties: printCase.properties ?? [],
        diagramImage: (block) => [place(`assets/diagram-${block.index}-0.png`)],
        image: ({ source }) => place(jobAssetPath(source, assigned))
      });

      const data = resolvePrintData(
        template,
        {},
        {
          title: "Fixture",
          noteName: printCase.name,
          now: new Date(Date.UTC(2026, 8, 24)),
          locale: "de"
        }
      );

      jobs.push({
        name: `${template.name}/${printCase.name}`,
        job: buildJob({
          template,
          layout: fixture.layout,
          body: conversion.body,
          data,
          fonts: fixture.fonts ?? [],
          assets: [...pictures.values(), ...(fixture.assets ?? [])]
        }),
        hasText: printCase.markdown.trim() !== ""
      });
    }
  }

  return jobs;
}
