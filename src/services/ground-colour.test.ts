import { describe, expect, it } from "vitest";
import { groundColour, parseCssColour } from "./ground-colour";

describe("parseCssColour", () => {
  it("reads the forms a computed style can take", () => {
    expect(parseCssColour("rgb(26, 26, 26)")).toEqual({ r: 26, g: 26, b: 26, a: 1 });
    expect(parseCssColour("rgba(255, 255, 255, 0.85)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.85
    });
    expect(parseCssColour("rgb(10 20 30 / 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColour("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColour("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColour("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("refuses what the browser would not have painted", () => {
    expect(parseCssColour("")).toBeNull();
    expect(parseCssColour("inherit")).toBeNull();
    expect(parseCssColour("#1a1a1a")).toBeNull();
  });
});

describe("groundColour", () => {
  it("takes the element's own background when it is opaque", () => {
    expect(groundColour(["rgb(26, 26, 26)", "rgb(255, 255, 255)"])).toBe("rgb(26, 26, 26)");
  });

  it("looks outward past transparent ancestors to the first that paints", () => {
    expect(
      groundColour(["rgba(0, 0, 0, 0)", "transparent", "rgb(34, 34, 34)", "rgb(0, 0, 0)"])
    ).toBe("rgb(34, 34, 34)");
  });

  it("lays a translucent layer over the opaque one behind it", () => {
    expect(groundColour(["rgba(255, 255, 255, 0.5)", "rgb(0, 0, 0)"])).toBe("rgb(128, 128, 128)");
    expect(groundColour(["rgba(255, 255, 255, 0.04)", "rgb(26, 26, 26)"])).toBe("rgb(35, 35, 35)");
  });

  it("composites several translucent layers in order, innermost on top", () => {
    // 50% white over 50% black over solid red: red → (128,0,0) → (191,128,128)
    expect(groundColour(["rgba(255, 255, 255, 0.5)", "rgba(0, 0, 0, 0.5)", "rgb(255, 0, 0)"])).toBe(
      "rgb(191, 128, 128)"
    );
  });

  it("treats the outermost tint as solid when nothing is opaque", () => {
    expect(groundColour(["transparent", "rgba(30, 30, 30, 0.85)", "transparent"])).toBe(
      "rgb(30, 30, 30)"
    );
    expect(groundColour(["rgba(255, 255, 255, 0.5)", "rgba(0, 0, 0, 0.8)"])).toBe(
      "rgb(128, 128, 128)"
    );
  });

  it("has no answer when nothing paints", () => {
    expect(groundColour([])).toBeNull();
    expect(groundColour(["transparent", "rgba(0, 0, 0, 0)"])).toBeNull();
    expect(groundColour(["", "inherit"])).toBeNull();
  });
});
