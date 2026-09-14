import { describe, it, expect } from "vitest";
import {
  buildSlideshowInsertion,
  MAX_SLIDESHOW_IMAGES,
  parseSlideshow,
  SLIDESHOW_SNIPPET
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
