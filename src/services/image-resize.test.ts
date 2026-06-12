import { describe, expect, it } from "vitest";
import { getImageMimeType, scaleDimensions } from "./image-resize";

describe("getImageMimeType", () => {
  it("returns correct MIME type for jpg", () => {
    expect(getImageMimeType("jpg")).toBe("image/jpeg");
  });

  it("returns correct MIME type for jpeg", () => {
    expect(getImageMimeType("jpeg")).toBe("image/jpeg");
  });

  it("returns correct MIME type for png", () => {
    expect(getImageMimeType("png")).toBe("image/png");
  });

  it("returns correct MIME type for gif", () => {
    expect(getImageMimeType("gif")).toBe("image/gif");
  });

  it("returns correct MIME type for webp", () => {
    expect(getImageMimeType("webp")).toBe("image/webp");
  });

  it("is case-insensitive", () => {
    expect(getImageMimeType("PNG")).toBe("image/png");
    expect(getImageMimeType("JPG")).toBe("image/jpeg");
  });

  it("returns null for unsupported formats", () => {
    expect(getImageMimeType("svg")).toBeNull();
    expect(getImageMimeType("bmp")).toBeNull();
    expect(getImageMimeType("tiff")).toBeNull();
    expect(getImageMimeType("md")).toBeNull();
  });
});

describe("scaleDimensions", () => {
  it("returns original dimensions when both sides are within maxPx", () => {
    expect(scaleDimensions(400, 300, 768)).toEqual({ width: 400, height: 300 });
  });

  it("returns original dimensions when exactly at maxPx", () => {
    expect(scaleDimensions(768, 512, 768)).toEqual({ width: 768, height: 512 });
  });

  it("scales down a landscape image by its longest side", () => {
    const result = scaleDimensions(1536, 1024, 768);
    expect(result.width).toBe(768);
    expect(result.height).toBe(512);
  });

  it("scales down a portrait image by its longest side", () => {
    const result = scaleDimensions(1024, 2048, 768);
    expect(result.width).toBe(384);
    expect(result.height).toBe(768);
  });

  it("scales a square image uniformly", () => {
    const result = scaleDimensions(2000, 2000, 500);
    expect(result.width).toBe(500);
    expect(result.height).toBe(500);
  });
});
