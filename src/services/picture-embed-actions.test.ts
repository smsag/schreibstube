import { describe, expect, it } from "vitest";
import { embedLinkpath, isFavorite, pictureActionState } from "./picture-embed-actions";

describe("pictureActionState", () => {
  it("opens the description and offers the star once there is a note", () => {
    expect(
      pictureActionState({ described: true, describingEnabled: true, favorite: true })
    ).toEqual({ describe: "open", favorite: true });
    expect(
      pictureActionState({ described: true, describingEnabled: false, favorite: undefined })
    ).toEqual({ describe: "open", favorite: false });
  });

  it("offers to describe a picture without one, with no star to keep", () => {
    expect(
      pictureActionState({ described: false, describingEnabled: true, favorite: true })
    ).toEqual({ describe: "describe", favorite: null });
  });

  it("offers nothing to a picture without one while describing is off", () => {
    expect(
      pictureActionState({ described: false, describingEnabled: false, favorite: undefined })
    ).toEqual({ describe: null, favorite: null });
  });
});

describe("isFavorite", () => {
  it("is yes for true, as the star writes it, and for the word typed by hand", () => {
    expect(isFavorite(true)).toBe(true);
    expect(isFavorite("true")).toBe(true);
    expect(isFavorite(" TRUE ")).toBe(true);
  });

  it("is no for anything else", () => {
    for (const value of [false, "false", "yes", 1, null, undefined, [true], {}]) {
      expect(isFavorite(value)).toBe(false);
    }
  });
});

describe("embedLinkpath", () => {
  it("takes the path, without a heading, a block or a size", () => {
    expect(embedLinkpath("Bilder/kueche.png")).toBe("Bilder/kueche.png");
    expect(embedLinkpath("kueche.png|300")).toBe("kueche.png");
    expect(embedLinkpath("kueche.png#^block")).toBe("kueche.png");
    expect(embedLinkpath("  kueche.png ")).toBe("kueche.png");
  });

  it("is nothing for a web address, an empty link or no link at all", () => {
    expect(embedLinkpath("https://example.com/bild.png")).toBeNull();
    expect(embedLinkpath("app://local/bild.png")).toBeNull();
    expect(embedLinkpath("|300")).toBeNull();
    expect(embedLinkpath("")).toBeNull();
    expect(embedLinkpath(null)).toBeNull();
    expect(embedLinkpath("a".repeat(2000))).toBeNull();
  });
});
