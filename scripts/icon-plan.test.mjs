import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { artworkNodes, CUSTOM_CODEPOINT_BASE, inlineMarkup, planIconFont } from "./icon-plan.mjs";
import { CUSTOM_ICONS, ICON_GROUPS, UI_ICONS } from "./icon-set.mjs";
import { ICON_SHAPES } from "../bridge/publish/render/icons.generated.mjs";
import { ICON_CODEPOINTS } from "../src/ui/icon-font.generated.ts";

const TABLER = new Map([
  ["folder", 0xeaad],
  ["file", 0xeaa2],
  ["tag", 0x10096]
]);

const OURS = [
  { name: "schreibstube", source: "assets/logo.svg" },
  { name: "pythia", source: "assets/icons/pythia.svg" }
];

describe("planIconFont", () => {
  it("splits the names between Tabler and our own artwork", () => {
    const plan = planIconFont(["file", "pythia", "folder", "schreibstube"], TABLER, OURS);

    expect(plan.errors).toEqual([]);
    expect(plan.tabler).toEqual(["file", "folder"]);
    expect(plan.custom).toEqual([
      { ...OURS[0], codepoint: CUSTOM_CODEPOINT_BASE },
      { ...OURS[1], codepoint: CUSTOM_CODEPOINT_BASE + 1 }
    ]);
  });

  it("keeps a glyph's codepoint when an earlier one is not shipped", () => {
    const plan = planIconFont(["pythia"], TABLER, OURS);
    expect(plan.custom).toEqual([{ ...OURS[1], codepoint: CUSTOM_CODEPOINT_BASE + 1 }]);
  });

  it("keeps our codepoints clear of every one Tabler uses", () => {
    expect(CUSTOM_CODEPOINT_BASE).toBeGreaterThan(Math.max(...TABLER.values()));
  });

  it("refuses a name neither Tabler nor our artwork has", () => {
    const plan = planIconFont(["folder", "foldr"], TABLER, OURS);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain("foldr");
  });

  it("refuses our own glyph under a name Tabler uses", () => {
    const plan = planIconFont(["tag"], TABLER, [{ name: "tag", source: "x.svg" }]);
    expect(plan.errors).toEqual([expect.stringContaining('"tag" is a Tabler name')]);
  });

  it("refuses the same name listed twice", () => {
    const twice = [OURS[0], { name: "schreibstube", source: "other.svg" }];
    expect(planIconFont([], TABLER, twice).errors).toEqual([
      expect.stringContaining("listed twice")
    ]);
  });
});

describe("the shipped icon set", () => {
  it("offers every one of our own glyphs in the picker", () => {
    const offered = new Set([...UI_ICONS, ...ICON_GROUPS.flatMap((group) => group.icons)]);
    for (const icon of CUSTOM_ICONS) expect(offered).toContain(icon.name);
  });

  // Both tables come from one build; this catches one of them edited, or
  // regenerated, without the other.
  it("is drawn on the website under exactly the names Obsidian draws", () => {
    expect(Object.keys(ICON_SHAPES).sort()).toEqual(Object.keys(ICON_CODEPOINTS).sort());
  });
});

describe("inlineMarkup", () => {
  it("writes Tabler's nodes as the shapes inside an SVG", () => {
    const nodes = [
      ["path", { d: "M5 4h4l3 3h7" }],
      ["path", { d: "M3 12h18", stroke: "none", fill: "currentColor", opacity: "0.5" }]
    ];
    expect(inlineMarkup("folder", nodes)).toBe(
      '<path d="M5 4h4l3 3h7"/>' +
        '<path d="M3 12h18" stroke="none" fill="currentColor" opacity="0.5"/>'
    );
  });

  it("refuses anything a page should not carry", () => {
    expect(() => inlineMarkup("x", [["script", {}]])).toThrow(/<script>/);
    expect(() => inlineMarkup("x", [["path", { onload: "alert(1)" }]])).toThrow(/onload/);
    expect(() => inlineMarkup("x", [["path", { fill: "url(javascript:1)" }]])).toThrow(/fill/);
    expect(() => inlineMarkup("x", [["path", { d: 'M0 0"/><script>' }]])).toThrow(/d=/);
  });

  it("refuses an icon that draws nothing", () => {
    expect(() => inlineMarkup("empty", [])).toThrow(/draws nothing/);
  });
});

describe("artworkNodes", () => {
  const svg = (inner, root = 'viewBox="0 0 24 24" fill="none"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${root}>\n${inner}\n</svg>\n`;

  it("reads the shapes of our own artwork", () => {
    expect(
      artworkNodes("a", svg('  <path d="M1 2"/>\n  <circle cx="9" cy="7.5" r="1.5"/>'))
    ).toEqual([
      ["path", { d: "M1 2" }],
      ["circle", { cx: "9", cy: "7.5", r: "1.5" }]
    ]);
  });

  it("reads every file the icon set names", () => {
    for (const icon of CUSTOM_ICONS) {
      const nodes = artworkNodes(
        icon.name,
        readFileSync(new URL(`../${icon.source}`, import.meta.url), "utf8")
      );
      expect(inlineMarkup(icon.name, nodes)).toMatch(/^<(path|circle)/);
    }
  });

  it("refuses artwork that is more than shapes, or on another grid", () => {
    expect(() => artworkNodes("a", svg('<g><path d="M1 2"/></g>'))).toThrow(/self-closing/);
    expect(() => artworkNodes("a", svg('<!-- x --><path d="M1 2"/>'))).toThrow(/self-closing/);
    expect(() => artworkNodes("a", svg('<path d="M1 2"/>', 'viewBox="0 0 48 48"'))).toThrow(/grid/);
    expect(() => artworkNodes("a", "<p>not svg</p>")).toThrow(/not one <svg>/);
  });
});
