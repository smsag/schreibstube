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

  it("is registered under its own id, the one the ribbon, command and pane share", () => {
    expect(SCHREIBSTUBE_ICON).toBe("schreibstube-logo");
  });

  it("carries the designed geometry unchanged: the bubble and the branch graph", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain(
      'd="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"'
    );
    expect(SCHREIBSTUBE_ICON_SVG).toContain('<circle cx="9" cy="7.5" r="1.5"/>');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('<circle cx="9" cy="12.5" r="1.5"/>');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('<circle cx="15.5" cy="7.5" r="1.5"/>');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('<path d="M9 9v2"/>');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('<path d="M15.5 9a5 5 0 0 1-5 3.5"/>');
  });

  it("is stroke only: no shape carries a fill or a colour of its own", () => {
    const shapes = SCHREIBSTUBE_ICON_SVG.match(/<(path|circle)\b[^>]*>/g) ?? [];
    expect(shapes).toHaveLength(6);
    for (const shape of shapes) {
      expect(shape).not.toContain("fill=");
      expect(shape).not.toContain("stroke=");
    }
    expect(SCHREIBSTUBE_ICON_SVG).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("keeps Lucide's rules: a 2-unit stroke, round ends, 18 of 24 units, centred", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke-width="2"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke-linecap="round"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke-linejoin="round"');

    // The bubble spans 3 to 21 of the 24-unit grid, as Lucide's own does: 75% of the box,
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
