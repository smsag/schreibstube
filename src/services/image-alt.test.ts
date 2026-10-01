import { describe, expect, it } from "vitest";
import { MAX_IMAGE_WIDTH_PX, parseImageAlt } from "./image-alt";

describe("parseImageAlt", () => {
  it("leaves a plain caption alone", () => {
    expect(parseImageAlt("Ein Foto")).toEqual({ caption: "Ein Foto", width: null, align: null });
    expect(parseImageAlt("")).toEqual({ caption: "", width: null, align: null });
  });

  it("takes the width from the last segment, as Obsidian does", () => {
    expect(parseImageAlt("Map | 750")).toEqual({ caption: "Map", width: 750, align: null });
    expect(parseImageAlt("300")).toEqual({ caption: "", width: 300, align: null });
    expect(parseImageAlt("Map|300x200")).toEqual({ caption: "Map", width: 300, align: null });
  });

  it("takes the alignment word before the width, or alone", () => {
    expect(parseImageAlt("Map | center | 750")).toEqual({
      caption: "Map",
      width: 750,
      align: "center"
    });
    expect(parseImageAlt("Map | Right")).toEqual({ caption: "Map", width: null, align: "right" });
    expect(parseImageAlt("left|300")).toEqual({ caption: "", width: 300, align: "left" });
    expect(parseImageAlt("center")).toEqual({ caption: "", width: null, align: "center" });
  });

  it("does not size a picture whose width is not the last segment", () => {
    // On screen this is centred at its natural size: the width is lost, the
    // word still ends the alt text. The print agrees.
    expect(parseImageAlt("Map | 750 | center")).toEqual({
      caption: "Map | 750",
      width: null,
      align: "center"
    });
  });

  it("reads a caption that merely ends in the word as a caption", () => {
    expect(parseImageAlt("Population center | 300")).toEqual({
      caption: "Population center",
      width: 300,
      align: null
    });
  });

  it("ignores a zero width and bounds a huge one", () => {
    expect(parseImageAlt("Map | 0").width).toBeNull();
    expect(parseImageAlt("Map | 99999999999999999999999").width).toBe(MAX_IMAGE_WIDTH_PX);
  });
});
