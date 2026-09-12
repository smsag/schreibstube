import { describe, expect, it } from "vitest";
import { registeredIcons } from "../testing/obsidian-stub";
import {
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

  it("scales the 24-unit artwork onto the 100-unit box Obsidian draws in", () => {
    // 100 / 24, or the icon sits in the top-left sixth of the button.
    expect(SCHREIBSTUBE_ICON_SVG).toContain("scale(4.166666666666667)");
  });

  it("takes its colour from the button it is drawn in", () => {
    expect(SCHREIBSTUBE_ICON_SVG).toContain('stroke="currentColor"');
    expect(SCHREIBSTUBE_ICON_SVG).toContain('fill="none"');
  });
});
