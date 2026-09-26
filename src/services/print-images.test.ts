import { describe, expect, it } from "vitest";
import { printAssetName, printImageFormat } from "./print-images";

describe("printImageFormat", () => {
  it("prints what the browser can decode, drawn again as a format Typst reads", () => {
    expect(printImageFormat("jpg")).toEqual({
      kind: "raster",
      sourceType: "image/jpeg",
      outputType: "image/jpeg"
    });
    expect(printImageFormat("PNG")).toMatchObject({ outputType: "image/png" });
    expect(printImageFormat("webp")).toMatchObject({ outputType: "image/webp" });
  });

  it("turns an AVIF or HEIC photo into JPEG, which Typst reads and a phone's photo suits", () => {
    expect(printImageFormat("avif")).toEqual({
      kind: "raster",
      sourceType: "image/avif",
      outputType: "image/jpeg"
    });
    expect(printImageFormat("HEIC")).toMatchObject({ outputType: "image/jpeg" });
  });

  it("turns a GIF or BMP into PNG, since a canvas cannot write either", () => {
    expect(printImageFormat("gif")).toMatchObject({
      sourceType: "image/gif",
      outputType: "image/png"
    });
    expect(printImageFormat("bmp")).toMatchObject({ outputType: "image/png" });
  });

  it("hands an SVG to Typst as it is", () => {
    expect(printImageFormat("svg")).toEqual({ kind: "vector" });
  });

  it("refuses what no print can carry", () => {
    expect(printImageFormat("tiff")).toBeNull();
    expect(printImageFormat("pdf")).toBeNull();
    expect(printImageFormat("")).toBeNull();
  });
});

describe("printAssetName", () => {
  const as = (path: string) => printAssetName(path, printImageFormat(path.split(".").pop() ?? "")!);

  it("keeps a name that already says what the bytes are", () => {
    expect(as("Bilder/foto.jpg")).toBe("Bilder/foto.jpg");
    expect(as("Bilder/foto.JPEG")).toBe("Bilder/foto.JPEG");
    expect(as("scan.png")).toBe("scan.png");
    expect(as("plan.svg")).toBe("plan.svg");
  });

  it("names a picture for what it became, keeping its own extension before", () => {
    // Typst tells a format by its extension: PNG bytes called .gif stopped the document.
    expect(as("Visuals/IMG_2443.avif")).toBe("Visuals/IMG_2443.avif.jpg");
    expect(as("animation.gif")).toBe("animation.gif.png");
    expect(as("scan.bmp")).toBe("scan.bmp.png");
  });

  it("cannot collide with a JPEG of the same name beside it", () => {
    expect(as("IMG_2443.avif")).not.toBe(as("IMG_2443.jpg"));
  });
});
