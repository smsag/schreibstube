import { describe, expect, it } from "vitest";
import { isOpenableAddress } from "./open-address";

describe("isOpenableAddress", () => {
  it("opens the web, mail, Obsidian and other apps' own schemes", () => {
    for (const href of [
      "https://example.org/a",
      "http://example.org",
      "mailto:anna@example.org",
      "obsidian://open?vault=V&file=Note",
      "zotero://select/items/ABC"
    ]) {
      expect(isOpenableAddress(href)).toBe(true);
    }
  });

  it("refuses a scheme that runs or reads something, however it is spelled", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "blob:https://example.org/1"
    ]) {
      expect(isOpenableAddress(href)).toBe(false);
    }
  });

  it("refuses what is no address at all", () => {
    expect(isOpenableAddress("")).toBe(false);
    expect(isOpenableAddress("Ablage.md")).toBe(false);
  });
});
