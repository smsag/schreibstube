import { describe, it, expect } from "vitest";
import {
  buildSlideshowInsertion,
  clampCompareSplit,
  COMPARE_SPLIT_STEP,
  compareSplitAt,
  DEFAULT_COMPARE_SPLIT,
  DEFAULT_SLIDESHOW_LAYOUT,
  FEATURE_DETAIL_COUNT,
  featureDetails,
  imagesForLayout,
  linkpathCandidates,
  MAX_SLIDESHOW_IMAGES,
  MAX_STRIP_COLUMNS,
  parseLayout,
  parseSlideshow,
  SLIDESHOW_LAYOUTS,
  SLIDESHOW_SNIPPET,
  slideshowCounter,
  stepCompareSplit,
  stepIndex,
  STRIP_WRAP_COLUMNS,
  stripColumns
} from "./slideshow";

describe("parseSlideshow", () => {
  it("parses two images with alt text", () => {
    const result = parseSlideshow("![Slide 1](a.png)\n![Slide 2](b.png)");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toEqual({ src: "a.png", alt: "Slide 1" });
    expect(result.images[1]).toEqual({ src: "b.png", alt: "Slide 2" });
  });

  it("parses images with empty alt text", () => {
    const result = parseSlideshow("![](one.png)\n![](two.png)");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images[0]?.alt).toBe("");
  });

  it("ignores blank lines and // comments", () => {
    const result = parseSlideshow("// intro\n\n![](a.png)\n\n![](b.png)\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(2);
  });

  it("trims whitespace from src and alt", () => {
    const result = parseSlideshow("![ Slide ]( path/img.png )\n![](b.png)");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images[0]?.src).toBe("path/img.png");
    expect(result.images[0]?.alt).toBe("Slide");
  });

  it("parses paths with spaces and special characters", () => {
    const result = parseSlideshow("![](my folder/image file.png)\n![](b.png)");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images[0]?.src).toBe("my folder/image file.png");
  });

  it("reads CRLF line endings", () => {
    const result = parseSlideshow("![](a.png)\r\n![](b.png)\r\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(2);
  });

  it("accepts more than two images", () => {
    const source = ["a", "b", "c", "d"].map((n) => `![](${n}.png)`).join("\n");
    const result = parseSlideshow(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(4);
  });

  it("rejects fewer than two images", () => {
    expect(parseSlideshow("![](only-one.png)")).toMatchObject({ ok: false });
  });

  it("rejects an empty block", () => {
    expect(parseSlideshow("")).toMatchObject({ ok: false });
  });

  it("rejects a non-image line, naming its number", () => {
    const result = parseSlideshow("![](a.png)\nnot an image\n![](b.png)");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("2");
  });

  it("rejects a bare text line at the top", () => {
    const result = parseSlideshow("just text\n![](b.png)");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("1");
  });

  it("rejects an empty image path", () => {
    expect(parseSlideshow("![alt]()\n![](b.png)")).toMatchObject({ ok: false });
  });

  it("rejects more images than the maximum", () => {
    const source = Array.from(
      { length: MAX_SLIDESHOW_IMAGES + 1 },
      (_, i) => `![](img-${i}.png)`
    ).join("\n");
    const result = parseSlideshow(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(String(MAX_SLIDESHOW_IMAGES));
  });

  it("accepts exactly the maximum number of images", () => {
    const source = Array.from({ length: MAX_SLIDESHOW_IMAGES }, (_, i) => `![](img-${i}.png)`).join(
      "\n"
    );
    expect(parseSlideshow(source)).toMatchObject({ ok: true });
  });
});

describe("parseSlideshow layout options", () => {
  it("defaults to the slideshow layout", () => {
    const result = parseSlideshow("![](a.png)\n![](b.png)");
    expect(result).toMatchObject({ ok: true, layout: DEFAULT_SLIDESHOW_LAYOUT });
    expect(DEFAULT_SLIDESHOW_LAYOUT).toBe("slideshow");
  });

  it.each(SLIDESHOW_LAYOUTS)("reads layout: %s", (layout) => {
    const result = parseSlideshow(`layout: ${layout}\n![](a.png)\n![](b.png)`);
    expect(result).toMatchObject({ ok: true, layout });
  });

  it("reads the layout regardless of case and spacing", () => {
    expect(parseSlideshow("Layout :  FEATURE \n![](a.png)\n![](b.png)")).toMatchObject({
      ok: true,
      layout: "feature"
    });
  });

  it("takes the layout line anywhere among the images", () => {
    const result = parseSlideshow("![](a.png)\nlayout: masonry\n![](b.png)\n![](c.png)");
    expect(result).toMatchObject({ ok: true, layout: "masonry" });
    if (!result.ok) return;
    expect(result.images).toHaveLength(3);
  });

  it("does not count the layout line as an image", () => {
    expect(parseSlideshow("layout: strip\n![](a.png)")).toMatchObject({ ok: false });
  });

  it("reports title and caption lines, which a block no longer takes", () => {
    const result = parseSlideshow("title: Drei\n![](a.png)\n![](b.png)");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("title: Drei");
  });

  it("rejects an unknown layout, naming the line and the choices", () => {
    const result = parseSlideshow("![](a.png)\nlayout: mosaic\n![](b.png)");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("2");
    expect(result.message).toContain("mosaic");
    for (const layout of SLIDESHOW_LAYOUTS) expect(result.message).toContain(layout);
  });

  it("rejects an empty layout value", () => {
    expect(parseSlideshow("layout:\n![](a.png)\n![](b.png)")).toMatchObject({ ok: false });
  });

  it("keeps the last of repeated option lines", () => {
    const result = parseSlideshow("layout: feature\n![](a.png)\nlayout: strip\n![](b.png)");
    expect(result).toMatchObject({ ok: true, layout: "strip" });
  });

  it("still holds an image whose alt text looks like an option", () => {
    const result = parseSlideshow("![layout: strip](a.png)\n![](b.png)");
    expect(result).toMatchObject({ ok: true, layout: "slideshow" });
    if (!result.ok) return;
    expect(result.images[0]?.alt).toBe("layout: strip");
  });

  it("reads option lines with CRLF endings", () => {
    expect(parseSlideshow("layout: strip\r\n![](a.png)\r\n![](b.png)\r\n")).toMatchObject({
      ok: true,
      layout: "strip"
    });
  });
});

describe("parseLayout", () => {
  it("names each layout", () => {
    for (const layout of SLIDESHOW_LAYOUTS) expect(parseLayout(layout)).toBe(layout);
  });

  it("ignores case and surrounding space", () => {
    expect(parseLayout("  Strip ")).toBe("strip");
  });

  it("answers null for anything else", () => {
    expect(parseLayout("carousel")).toBeNull();
    expect(parseLayout("")).toBeNull();
  });
});

describe("stripColumns", () => {
  it("sets up to the maximum side by side", () => {
    for (let count = 2; count <= MAX_STRIP_COLUMNS; count++) {
      expect(stripColumns(count)).toBe(count);
    }
  });

  it("wraps a longer strip to the wrap width", () => {
    expect(stripColumns(MAX_STRIP_COLUMNS + 1)).toBe(STRIP_WRAP_COLUMNS);
    expect(stripColumns(9)).toBe(STRIP_WRAP_COLUMNS);
  });

  it("never answers zero", () => {
    expect(stripColumns(0)).toBe(1);
  });
});

describe("featureDetails", () => {
  it("shows the two images after the featured one", () => {
    expect(featureDetails(6, 0)).toEqual([1, 2]);
    expect(featureDetails(6, 3)).toEqual([4, 5]);
  });

  it("wraps round to the start", () => {
    expect(featureDetails(6, 5)).toEqual([0, 1]);
    expect(featureDetails(3, 2)).toEqual([0, 1]);
  });

  it("has one detail for two images", () => {
    expect(featureDetails(2, 0)).toEqual([1]);
    expect(featureDetails(2, 1)).toEqual([0]);
  });

  it("never repeats the featured image", () => {
    for (let count = 2; count <= 6; count++) {
      for (let active = 0; active < count; active++) {
        const details = featureDetails(count, active);
        expect(details).not.toContain(active);
        expect(details.length).toBe(Math.min(FEATURE_DETAIL_COUNT, count - 1));
        expect(new Set(details).size).toBe(details.length);
      }
    }
  });

  it("has nothing to show for one image", () => {
    expect(featureDetails(1, 0)).toEqual([]);
  });
});

describe("stepIndex", () => {
  it("moves forward and back", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(1, -1, 3)).toBe(0);
  });

  it("wraps at both ends", () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });

  it("stays at zero for an empty series", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("slideshowCounter", () => {
  it("counts from one", () => {
    expect(slideshowCounter(0, 3)).toBe("1 / 3");
    expect(slideshowCounter(2, 3)).toBe("3 / 3");
  });
});

describe("buildSlideshowInsertion", () => {
  it("inserts the block on its own lines in an empty note", () => {
    expect(buildSlideshowInsertion("", "")).toBe(`${SLIDESHOW_SNIPPET}\n`);
  });

  it("opens a new line when text precedes the cursor", () => {
    expect(buildSlideshowInsertion("some text", "")).toBe(`\n${SLIDESHOW_SNIPPET}\n`);
  });

  it("closes with a new line when text follows the cursor", () => {
    expect(buildSlideshowInsertion("", "more")).toBe(`${SLIDESHOW_SNIPPET}\n\n`);
  });
});

describe("linkpathCandidates", () => {
  it("offers a plain path once, as written", () => {
    expect(linkpathCandidates("Attachments/photo.png")).toEqual(["Attachments/photo.png"]);
  });

  it("decodes a percent-encoded space after trying the path as written", () => {
    expect(linkpathCandidates("my%20photo.png")).toEqual(["my%20photo.png", "my photo.png"]);
  });

  it("decodes umlauts and other encoded characters", () => {
    expect(linkpathCandidates("Gr%C3%BC%C3%9Fe.jpg")).toContain("Grüße.jpg");
  });

  it("unwraps a CommonMark angle-bracket path", () => {
    expect(linkpathCandidates("<my photo.png>")).toEqual(["<my photo.png>", "my photo.png"]);
  });

  it("keeps a path whose percent sign is not an encoding", () => {
    expect(linkpathCandidates("100%.png")).toEqual(["100%.png"]);
  });
});

describe("imagesForLayout", () => {
  const five = ["a", "b", "c", "d", "e"];

  it("gives a feature its first three images and leaves the rest out", () => {
    expect(imagesForLayout("feature", five)).toEqual(["a", "b", "c"]);
  });

  it("keeps a shorter feature whole", () => {
    expect(imagesForLayout("feature", ["a", "b"])).toEqual(["a", "b"]);
  });

  it("gives a comparison the first two images and leaves the rest out", () => {
    expect(imagesForLayout("compare", five)).toEqual(["a", "b"]);
    expect(imagesForLayout("compare", ["a", "b"])).toEqual(["a", "b"]);
  });

  it("gives every other layout all of them", () => {
    for (const layout of ["slideshow", "filmstrip", "strip", "masonry"] as const) {
      expect(imagesForLayout(layout, five)).toEqual(five);
    }
  });

  it("copies rather than handing back the caller's array", () => {
    expect(imagesForLayout("slideshow", five)).not.toBe(five);
  });
});

describe("clampCompareSplit", () => {
  it("leaves a place inside the frame alone", () => {
    expect(clampCompareSplit(0)).toBe(0);
    expect(clampCompareSplit(37.5)).toBe(37.5);
    expect(clampCompareSplit(100)).toBe(100);
  });

  it("holds a place beyond either edge at that edge", () => {
    expect(clampCompareSplit(-20)).toBe(0);
    expect(clampCompareSplit(140)).toBe(100);
  });

  it("falls back to the middle for a place that is not a number", () => {
    expect(clampCompareSplit(Number.NaN)).toBe(DEFAULT_COMPARE_SPLIT);
    expect(clampCompareSplit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COMPARE_SPLIT);
  });
});

describe("compareSplitAt", () => {
  it("reads a pointer as a share of the frame's width", () => {
    expect(compareSplitAt(100, 100, 400)).toBe(0);
    expect(compareSplitAt(300, 100, 400)).toBe(50);
    expect(compareSplitAt(500, 100, 400)).toBe(100);
  });

  it("holds a pointer dragged past the frame at its edges", () => {
    expect(compareSplitAt(0, 100, 400)).toBe(0);
    expect(compareSplitAt(900, 100, 400)).toBe(100);
  });

  it("leaves the divider in the middle for a frame with no width yet", () => {
    expect(compareSplitAt(300, 100, 0)).toBe(DEFAULT_COMPARE_SPLIT);
  });
});

describe("stepCompareSplit", () => {
  it("moves one step either way", () => {
    expect(stepCompareSplit(50, 1)).toBe(50 + COMPARE_SPLIT_STEP);
    expect(stepCompareSplit(50, -1)).toBe(50 - COMPARE_SPLIT_STEP);
  });

  it("stops at the edges rather than wrapping round", () => {
    expect(stepCompareSplit(100, 1)).toBe(100);
    expect(stepCompareSplit(0, -1)).toBe(0);
  });

  it("crosses the frame in a bounded number of presses", () => {
    let split = 0;
    for (let press = 0; press < 100 && split < 100; press++) split = stepCompareSplit(split, 1);
    expect(split).toBe(100);
  });
});
