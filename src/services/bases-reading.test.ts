import { describe, expect, it } from "vitest";
import {
  BASE_PRESS_WINDOW_MS,
  BASE_READING_KEY,
  opensForReading,
  readsForReading,
  withReadingView,
  type OpenedNote
} from "./bases-reading";

/** A note that opened 200 ms after a press in a base, shown for editing. */
const opened = (over: Partial<OpenedNote> = {}): OpenedNote => ({
  enabled: true,
  pressedAt: 1000,
  now: 1200,
  extension: "md",
  mode: "source",
  ...over
});

describe("opensForReading", () => {
  it("switches a note that opened right after a press in a base", () => {
    expect(opensForReading(opened())).toBe(true);
  });

  it("leaves it alone when the base pressed does not open notes for reading", () => {
    expect(opensForReading(opened({ enabled: false }))).toBe(false);
  });

  it("leaves a note alone that opened after a press elsewhere", () => {
    expect(opensForReading(opened({ pressedAt: null }))).toBe(false);
  });

  it("counts an opening within the window, and none after it", () => {
    expect(opensForReading(opened({ now: 1000 + BASE_PRESS_WINDOW_MS }))).toBe(true);
    expect(opensForReading(opened({ now: 1001 + BASE_PRESS_WINDOW_MS }))).toBe(false);
  });

  it("does not trust a clock that went backwards", () => {
    expect(opensForReading(opened({ now: 900 }))).toBe(false);
  });

  it("switches only a Markdown note, and one not already in Reading view", () => {
    expect(opensForReading(opened({ extension: "png" }))).toBe(false);
    expect(opensForReading(opened({ extension: "MD" }))).toBe(true);
    expect(opensForReading(opened({ mode: "preview" }))).toBe(false);
    expect(opensForReading(opened({ mode: null }))).toBe(false);
  });
});

describe("readsForReading", () => {
  it("reads the key at the top of a base's YAML, and only `true` as yes", () => {
    expect(readsForReading({ [BASE_READING_KEY]: true, views: [] })).toBe(true);
    for (const value of [false, "true", "yes", 1, null, undefined]) {
      expect(readsForReading({ [BASE_READING_KEY]: value })).toBe(false);
    }
  });

  it("reads no from a file that is not a map", () => {
    for (const config of [null, undefined, "text", 3, [true]]) {
      expect(readsForReading(config)).toBe(false);
    }
  });
});

describe("withReadingView", () => {
  const BASE =
    "filters:\n  and:\n    - schreibstubeFavorite == true\n# meine Ansichten\nviews:\n  - type: cards\n    name: Favoriten\n";

  it("sets the key as the first line and leaves the rest as it was, comments too", () => {
    expect(withReadingView(BASE, true)).toBe(`${BASE_READING_KEY}: true\n${BASE}`);
  });

  it("takes it away again, wherever it stands at the top level", () => {
    expect(withReadingView(withReadingView(BASE, true), false)).toBe(BASE);
    const middle = BASE.replace("views:", `${BASE_READING_KEY}: false\nviews:`);
    expect(withReadingView(middle, false)).toBe(BASE);
  });

  it("writes the key once, however often it is set", () => {
    const twice = withReadingView(withReadingView(BASE, true), true);
    expect(twice.split(BASE_READING_KEY)).toHaveLength(2);
  });

  it("leaves a key of the same name inside a view alone, which is not the base's", () => {
    const nested = `views:\n  - type: table\n    ${BASE_READING_KEY}: true\n`;
    expect(withReadingView(nested, false)).toBe(nested);
  });

  it("keeps a file's own line endings, and sets the key in an empty file", () => {
    expect(withReadingView("views: []\r\n", true)).toBe(
      `${BASE_READING_KEY}: true\r\nviews: []\r\n`
    );
    expect(withReadingView("", true)).toBe(`${BASE_READING_KEY}: true\n`);
    expect(withReadingView(`${BASE_READING_KEY}: true`, false)).toBe("");
  });
});
