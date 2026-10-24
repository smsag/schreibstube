import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./escape-regexp";

describe("escapeRegExp", () => {
  it("matches every special character literally, in every flag set the matchers use", () => {
    const text = "a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o";
    for (const flags of ["", "g", "giu"]) {
      expect(new RegExp(`^${escapeRegExp(text)}$`, flags).test(text)).toBe(true);
    }
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
  });

  it("leaves a tag's hyphen and slash as they are", () => {
    expect(escapeRegExp("projekt/alpha-2")).toBe("projekt/alpha-2");
  });
});
