import { describe, expect, it } from "vitest";
import {
  MAX_PROPERTY_ICONS,
  normalizePropertyIcons,
  propertyIconCss,
  propertyIconKey,
  withPropertyIcon
} from "./property-icons";

describe("propertyIconKey", () => {
  it("folds case and trims, as Obsidian treats keys", () => {
    expect(propertyIconKey("  Status ")).toBe("status");
  });

  it("refuses empty, overlong and control-character keys", () => {
    expect(propertyIconKey("   ")).toBeNull();
    expect(propertyIconKey("x".repeat(101))).toBeNull();
    expect(propertyIconKey("a\nb")).toBeNull();
  });
});

describe("normalizePropertyIcons", () => {
  it("keeps valid entries under their folded key", () => {
    expect(normalizePropertyIcons({ Status: "flag", client: "building" })).toEqual({
      status: "flag",
      client: "building"
    });
  });

  it("drops what a hand-edited file got wrong", () => {
    expect(
      normalizePropertyIcons({ ok: "flag", bad: "<svg>", num: 3, "": "flag", " ": "flag" })
    ).toEqual({ ok: "flag" });
  });

  it("answers an empty map for anything that is not an object", () => {
    expect(normalizePropertyIcons(null)).toEqual({});
    expect(normalizePropertyIcons(["flag"])).toEqual({});
    expect(normalizePropertyIcons("flag")).toEqual({});
  });

  it("stops at the bound", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PROPERTY_ICONS + 10 }, (_, i) => [`k${i}`, "flag"])
    );
    expect(Object.keys(normalizePropertyIcons(many))).toHaveLength(MAX_PROPERTY_ICONS);
  });
});

describe("withPropertyIcon", () => {
  it("sets and removes a key's icon without touching the others", () => {
    const set = withPropertyIcon({ client: "building" }, "Status", "flag");
    expect(set).toEqual({ client: "building", status: "flag" });
    expect(withPropertyIcon(set, "status", null)).toEqual({ client: "building" });
  });

  it("ignores a key that could not be a property", () => {
    const icons = { client: "building" };
    expect(withPropertyIcon(icons, "  ", "flag")).toBe(icons);
  });
});

describe("propertyIconCss", () => {
  const glyphs: Record<string, string> = { flag: "" };
  const glyphOf = (name: string) => glyphs[name];

  it("hides the type icon and draws the glyph for each key", () => {
    const css = propertyIconCss({ status: "flag" }, glyphOf, "icons");
    expect(css).toContain(
      '.metadata-property[data-property-key="status" i] .metadata-property-icon > svg'
    );
    expect(css).toContain('content: "\\ea01"');
    expect(css).toContain('font-family: "icons"');
  });

  it("leaves a key with an unknown icon on its type icon", () => {
    expect(propertyIconCss({ status: "gone" }, glyphOf, "icons")).toBe("");
  });

  it("escapes quotes and backslashes in keys", () => {
    const css = propertyIconCss({ 'a"b\\c': "flag" }, glyphOf, "icons");
    expect(css).toContain('data-property-key="a\\"b\\\\c" i');
  });
});
