import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRenderer, prepare, renderMarkdown } from "./render/markdown.mjs";

const emptySite = { notes: new Map(), assets: new Map(), slugify: (value) => value };
import {
  DEFAULT_INDEX_DEPTH,
  LABELS,
  MAX_INDEX_DEPTH,
  MAX_INDEX_ENTRIES,
  pageHeadings,
  parseNoteIndexOptions,
  planNoteIndex
} from "./render/note-index.mjs";

/**
 * The index block is read by the plugin in the vault and here for the site.
 * The examples are shared, so the two readings cannot drift apart.
 */
const table = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../contracts/index-cases.json", import.meta.url)), "utf8")
);

function levelsOf(test) {
  const levels = [...(test.levels ?? [])];
  for (let run = test.repeat; run; run = run.then) {
    for (let i = 0; i < run.count; i += 1) levels.push(run.level);
  }
  return levels;
}

describe("the shared index contract, on the bridge", () => {
  for (const { name, source, expect: wanted } of table.options) {
    it(`reads the block: ${name}`, () => {
      expect(parseNoteIndexOptions(source)).toEqual(wanted);
    });
  }

  for (const test of table.plans) {
    it(`plans the list: ${test.name}`, () => {
      const plan = planNoteIndex(
        levelsOf(test).map((level) => ({ level })),
        test.depth
      );
      const wanted = test.expect;
      expect(plan.kind).toBe(wanted.kind);
      if (plan.kind === "entries") {
        if (wanted.indents) expect(plan.entries.map((e) => e.indent)).toEqual(wanted.indents);
        if (wanted.count !== undefined) expect(plan.entries).toHaveLength(wanted.count);
      }
      if (plan.kind === "too-long") {
        expect(plan.count).toBe(wanted.count);
        expect(plan.fits).toBe(wanted.fits);
      }
    });
  }

  for (const { name, source, levels, texts } of table.headings) {
    it(`finds the headings: ${name}`, () => {
      const headings = pageHeadings(createRenderer().parse(prepare(source), { site: emptySite }));
      expect(headings.map((heading) => heading.level)).toEqual(levels);
      if (texts) expect(headings.map((heading) => heading.text)).toEqual(texts);
    });
  }

  it("applies the same limits", () => {
    expect(DEFAULT_INDEX_DEPTH).toBe(table.limits.defaultDepth);
    expect(MAX_INDEX_DEPTH).toBe(table.limits.maxDepth);
    expect(MAX_INDEX_ENTRIES).toBe(table.limits.maxEntries);
  });

  it("labels the index in the shared words", () => {
    expect(LABELS.summary(12)).toBe(table.labels.summary.replace("{n}", "12"));
    expect(LABELS.summary(1)).toBe(table.labels.summaryOne);
  });
});

const md = createRenderer();
const site = { notes: new Map(), assets: new Map(), slugify: (value) => value };
const render = (source) => renderMarkdown(md, source, site).html;
const index = (body = "") => "```schreibstube-index\n" + body + "\n```";

describe("the index on the page", () => {
  it("links each heading to the anchor the page gives it, nested as the outline reads", () => {
    const html = render(`# Exposé\n\n${index()}\n\n## Lage\n\n### Mikrolage\n\n## Preis`);
    expect(html).toContain(
      '<details class="schreibstube-index" open>\n' +
        "<summary>Inhalt · <strong>3</strong> Abschnitte</summary>\n" +
        '<ul>\n<li><a href="#expose">Exposé</a>\n' +
        '<ul>\n<li><a href="#lage">Lage</a></li>\n' +
        '<li><a href="#preis">Preis</a></li>\n</ul>\n</li>\n</ul>\n</details>\n'
    );
    expect(html).toContain('<h2 id="lage"');
  });

  it("starts folded when the block says so", () => {
    expect(render(`${index("collapsed: true")}\n\n## A`)).toContain(
      '<details class="schreibstube-index">'
    );
  });

  it("reaches the depth the block names", () => {
    const html = render(`${index("depth: 3")}\n\n## A\n\n### B\n\n#### C`);
    expect(html).toContain('href="#b"');
    expect(html).not.toContain('href="#c"');
  });

  it("keeps two headings with the same words apart, as the anchors do", () => {
    const html = render(`${index()}\n\n## Notizen\n\n## Notizen`);
    expect(html).toContain('href="#notizen"');
    expect(html).toContain('href="#notizen-1"');
  });

  it("closes every list when the outline steps back more than one level", () => {
    const html = render(`${index("depth: 3")}\n\n# A\n\n## B\n\n### C\n\n# D`);
    expect(html).toContain(
      '<a href="#c">C</a></li>\n</ul>\n</li>\n</ul>\n</li>\n<li><a href="#d">D</a>'
    );
    const opened = html.match(/<ul>/g).length;
    expect(html.match(/<\/ul>/g)).toHaveLength(opened);
  });

  it("lists the page's own headings, not a quote's, and escapes their words", () => {
    const html = render(`${index()}\n\n> ## Zitat\n\n## A <b>&</b> "B" \`code\``);
    expect(html).not.toContain('href="#zitat"');
    expect(html).toContain(">A &amp; &quot;B&quot; code</a>");
  });

  it("shows nothing when there is nothing to list, or too much", () => {
    expect(render(`${index()}\n\n### Tief`)).not.toContain("schreibstube-index");
    const many = Array.from({ length: MAX_INDEX_ENTRIES + 1 }, (_, i) => `## H${i}`).join("\n\n");
    const html = render(`${index()}\n\n${many}`);
    expect(html).not.toContain("schreibstube-index");
    expect(html).not.toContain("<pre");
  });
});
