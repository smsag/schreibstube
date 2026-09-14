import { describe, expect, it } from "vitest";
import { registeredIcons } from "../testing/obsidian-stub";
import {
  mappedExtent,
  registerSchreibstubeIcon,
  SCHREIBSTUBE_ICON,
  SCHREIBSTUBE_ICON_SVG
} from "./schreibstube-icon";

describe("the Schreibstube icon", () => {
  it("registers itself under the name the pane and ribbon ask for", () => {
    registerSchreibstubeIcon();

    expect(registeredIcons.get(SCHREIBSTUBE_ICON)).toBe(SCHREIBSTUBE_ICON_SVG);
  });

  it("carries the three strokes of the design: roof, walls and quill", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain('d="M4 10.5 12 4l8 6.5"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('d="M6 9.5V20h12V9.5"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('d="M10 16.5l3-3 1.5 1.5-3 3-2 .5z"');
  });

  it("draws to the size Lucide does, centred in Obsidian's 100-unit box", () => {
    // Obsidian's own `folder` covers 91.7% of its box once its stroke counts.
    // Anything much smaller reads as a lighter icon among the ribbon's others.
    const { min, max } = mappedExtent();

    expect(max - min).toBeCloseTo(83.33, 1);
    expect(min).toBeCloseTo(100 - max, 1);
  });

  it("emits a transform free of floating-point noise", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain("translate(-12.5 -12.5)");
    expect(SCHREIBSTUBE_ICON_SVG).toContain("scale(5.2083)");
  });

  it("takes its colour from the button it is drawn in", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke="currentColor"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('fill="none"');
  });
});
