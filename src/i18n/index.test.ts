import { describe, expect, it } from "vitest";
import { ICON_GROUPS } from "../ui/icon-font.generated";
import { de } from "./de";
import { en } from "./en";
import { localeFrom } from "./index";

describe("the icon picker's headings", () => {
  // The picker reads its headings by the group's id and falls back to the id
  // itself, so a group added to the icon set without one shows "moods" to a
  // German reader instead of failing anywhere.
  it("name every group in both languages", () => {
    const headings = [en, de].map(
      (messages) => messages.explorer.icons.groups as Record<string, string | undefined>
    );
    for (const group of ICON_GROUPS) {
      for (const heading of headings) expect(heading[group.id], group.id).toBeTruthy();
    }
  });
});

describe("which language Obsidian is in", () => {
  it("follows an explicit choice, whatever the system says", () => {
    expect(localeFrom("de", "en-US")).toBe("de");
    expect(localeFrom("en", "de-DE")).toBe("en");
    expect(localeFrom("fr", "de-DE")).toBe("en");
  });

  it("follows the system when nothing was ever chosen, as Obsidian does", () => {
    expect(localeFrom(null, "de-DE")).toBe("de");
    expect(localeFrom(null, "de-CH")).toBe("de");
    expect(localeFrom(null, "de")).toBe("de");
    expect(localeFrom(null, "en-GB")).toBe("en");
    expect(localeFrom(null, "fr-FR")).toBe("en");
  });

  it("serves English when neither says anything", () => {
    expect(localeFrom(null, "")).toBe("en");
    expect(localeFrom("", "")).toBe("en");
  });
});
