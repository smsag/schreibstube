import { describe, expect, it } from "vitest";
import { CAPTURE_SCALE, captureSize, MAX_CAPTURE_PX, standaloneSvg, svgSize } from "./svg-capture";

const MERMAID =
  '<svg id="m1" width="100%" viewBox="0 0 620 310" style="max-width:620px"><g/></svg>';

describe("svgSize", () => {
  it("believes the measured box first, because it is what the drawing became", () => {
    expect(svgSize(MERMAID, { width: 900, height: 450 })).toEqual({ width: 900, height: 450 });
  });

  it("falls back to the viewBox, which a diagram always declares", () => {
    expect(svgSize(MERMAID)).toEqual({ width: 620, height: 310 });
    expect(svgSize(MERMAID, { width: 0, height: 0 })).toEqual({ width: 620, height: 310 });
  });

  it("reads a viewBox written with commas or a negative origin", () => {
    expect(svgSize('<svg viewBox="-10,-10, 200, 100"/>')).toEqual({ width: 200, height: 100 });
  });

  it("falls back to the attributes, but never to a percentage", () => {
    expect(svgSize('<svg width="300" height="150"/>')).toEqual({ width: 300, height: 150 });
    expect(svgSize('<svg width="100%" height="100%"/>')).toBeNull();
  });

  it("is null when nothing says how big it is", () => {
    expect(svgSize("<svg><g/></svg>")).toBeNull();
  });
});

describe("captureSize", () => {
  it("draws at twice the size, so print stays sharp", () => {
    expect(captureSize({ width: 620, height: 310 })).toEqual({ width: 1240, height: 620 });
    expect(CAPTURE_SCALE).toBe(2);
  });

  it("rounds to whole pixels, which is what a canvas takes", () => {
    expect(captureSize({ width: 100.4, height: 50.6 }, 1)).toEqual({ width: 100, height: 51 });
  });

  it("holds the longest side under the limit without changing the shape", () => {
    const size = captureSize({ width: 4000, height: 1000 });
    expect(Math.max(size.width, size.height)).toBe(MAX_CAPTURE_PX);
    expect(size.width / size.height).toBeCloseTo(4, 5);
  });

  it("never asks a canvas for nothing", () => {
    expect(captureSize({ width: 0.2, height: 0.2 }, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe("standaloneSvg", () => {
  const size = { width: 1240, height: 620 };

  it("states the namespace a detached drawing can no longer inherit", () => {
    expect(standaloneSvg(MERMAID, size)).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("keeps a namespace the drawing already stated", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';
    expect(standaloneSvg(svg, size).match(/xmlns=/g)).toHaveLength(1);
  });

  it("replaces a percentage size with the pixels it is to be drawn at", () => {
    const out = standaloneSvg(MERMAID, size);
    const openingTag = /<svg[^>]*>/.exec(out)?.[0] ?? "";
    expect(openingTag).toContain('width="1240"');
    expect(openingTag).toContain('height="620"');
    expect(openingTag).not.toContain("100%");
  });

  it("paints a white ground, so a light stroke is not lost on the page", () => {
    expect(standaloneSvg(MERMAID, size)).toContain('fill="#ffffff"');
    expect(standaloneSvg(MERMAID, size, "#eeeeee")).toContain('fill="#eeeeee"');
  });

  it("keeps the drawing itself, styles and all", () => {
    const svg = '<svg viewBox="0 0 10 10"><style>.n{fill:red}</style><g class="n"/></svg>';
    const out = standaloneSvg(svg, size);
    expect(out).toContain("<style>.n{fill:red}</style>");
    expect(out).toContain('<g class="n"/>');
    expect(out.endsWith("</svg>")).toBe(true);
  });

  it("declares the xlink namespace only for a drawing that uses it", () => {
    expect(standaloneSvg('<svg viewBox="0 0 1 1"><use xlink:href="#a"/></svg>', size)).toContain(
      "xmlns:xlink"
    );
    expect(standaloneSvg(MERMAID, size)).not.toContain("xmlns:xlink");
  });

  it("leaves something that is not an SVG alone rather than corrupting it", () => {
    expect(standaloneSvg("<div>no drawing</div>", size)).toBe("<div>no drawing</div>");
  });
});
