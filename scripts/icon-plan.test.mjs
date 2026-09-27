import { describe, expect, it } from "vitest";
import { CUSTOM_CODEPOINT_BASE, planIconFont } from "./icon-plan.mjs";
import { CUSTOM_ICONS, ICON_GROUPS, UI_ICONS } from "./icon-set.mjs";

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
});
