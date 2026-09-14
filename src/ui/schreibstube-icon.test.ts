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

  it("carries Lucide's house outline and the quill in its doorway", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain(
      'd="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"'
    );
    expect(SCHREIBSTUBE_ICON_SVG).toContain('d="M9.5 17.5 13 14l1.5 1.5-3.5 3.5-2 .5z"');
  });

  it("keeps Lucide's rules: a 2-unit stroke, round ends, 18 of 24 units, centred", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke-width="2"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke-linecap="round"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke-linejoin="round"');

    // Lucide's own house spans 3 to 21 of its 24-unit grid: 75% of the box,
    // with the same margin on every side. Anything wider stands out of the row.
    const { min, max } = mappedExtent();
    expect(max - min).toBeCloseTo(75, 1);
    expect(min).toBeCloseTo(100 - max, 1);
  });

  it("emits a transform free of floating-point noise", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain("translate(0 0)");
    expect(SCHREIBSTUBE_ICON_SVG).toContain("scale(4.1667)");
  });

  it("takes its colour from the button it is drawn in", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke="currentColor"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('fill="none"');
  });
});
