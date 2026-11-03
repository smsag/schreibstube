import { describe, expect, it } from "vitest";
import { coverImageUrl, edgeColor } from "./cover-backdrop";

type Rgba = [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

/** A picture as rows of pixels, flattened the way a canvas hands them over. */
function picture(rows: Rgba[][]): { pixels: number[]; width: number; height: number } {
  return { pixels: rows.flat(2), width: rows[0]?.length ?? 0, height: rows.length };
}

function filled(width: number, height: number, pixel: Rgba): Rgba[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => pixel));
}

/** Sets one pixel; rows come from `filled`, so every one is there. */
function set(rows: Rgba[][], x: number, y: number, pixel: Rgba): void {
  (rows[y] as Rgba[])[x] = pixel;
}

function colourOf(rows: Rgba[][]): string | null {
  const { pixels, width, height } = picture(rows);
  return edgeColor(pixels, width, height);
}

describe("coverImageUrl", () => {
  it("reads the picture out of a quoted url()", () => {
    expect(coverImageUrl('url("app://local/Bilder/Kreis.png?123")')).toBe(
      "app://local/Bilder/Kreis.png?123"
    );
  });

  it("reads single-quoted and bare urls", () => {
    expect(coverImageUrl("url('data:image/png;base64,AAAA')")).toBe("data:image/png;base64,AAAA");
    expect(coverImageUrl("url(https://example.com/a.jpg)")).toBe("https://example.com/a.jpg");
  });

  it("is null when the cover draws no picture", () => {
    expect(coverImageUrl("")).toBeNull();
    expect(coverImageUrl("none")).toBeNull();
  });
});

describe("edgeColor", () => {
  it("is the colour of a plain picture", () => {
    expect(colourOf(filled(4, 3, [250, 240, 200, 255]))).toBe("rgb(250, 240, 200)");
  });

  it("ignores what is inside the edge", () => {
    const rows = filled(5, 5, WHITE);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) set(rows, x, y, [0, 0, 255, 255]);
    expect(colourOf(rows)).toBe("rgb(255, 255, 255)");
  });

  it("takes the colour most of the edge shares, not the mean", () => {
    const rows = filled(6, 6, WHITE);
    for (let x = 0; x < 3; x++) set(rows, x, 0, [200, 0, 0, 255]);
    expect(colourOf(rows)).toBe("rgb(255, 255, 255)");
  });

  it("counts the grain of a scan as one colour and averages it", () => {
    const rows = filled(4, 4, [250, 250, 250, 255]);
    set(rows, 0, 0, [254, 254, 254, 255]);
    set(rows, 3, 3, [246, 246, 246, 255]);
    expect(colourOf(rows)).toBe("rgb(250, 250, 250)");
  });

  it("is null when most of the edge is clear", () => {
    const rows = filled(4, 4, CLEAR);
    set(rows, 1, 1, WHITE);
    set(rows, 2, 1, WHITE);
    set(rows, 0, 0, WHITE);
    expect(colourOf(rows)).toBeNull();
  });

  it("takes the opaque part when only some of the edge is clear", () => {
    const rows = filled(4, 4, [10, 20, 30, 255]);
    set(rows, 0, 0, CLEAR);
    set(rows, 3, 0, CLEAR);
    expect(colourOf(rows)).toBe("rgb(10, 20, 30)");
  });

  it("reads a picture one pixel wide or high", () => {
    expect(colourOf(filled(1, 3, [1, 2, 3, 255]))).toBe("rgb(1, 2, 3)");
    expect(colourOf(filled(3, 1, [1, 2, 3, 255]))).toBe("rgb(1, 2, 3)");
    expect(colourOf(filled(1, 1, [1, 2, 3, 255]))).toBe("rgb(1, 2, 3)");
  });

  it("is null for no picture or too few pixels", () => {
    expect(edgeColor([], 0, 0)).toBeNull();
    expect(edgeColor([255, 255, 255, 255], 2, 2)).toBeNull();
  });
});
