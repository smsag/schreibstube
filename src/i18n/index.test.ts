import { describe, expect, it } from "vitest";
import { localeFrom } from "./index";

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
