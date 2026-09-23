import { describe, expect, it } from "vitest";
import { checkFileName } from "./file-name";

describe("checkFileName", () => {
  it("accepts an ordinary name, and hands it back", () => {
    expect(checkFileName("Quartalsbericht")).toEqual({ ok: true, name: "Quartalsbericht" });
  });

  it("trims what surrounds the name, since that is never meant", () => {
    expect(checkFileName("  Entwurf ")).toEqual({ ok: true, name: "Entwurf" });
  });

  it("refuses nothing, and whitespace alone", () => {
    expect(checkFileName("")).toEqual({ ok: false, problem: "empty" });
    expect(checkFileName("   ")).toEqual({ ok: false, problem: "empty" });
  });

  it("refuses every character the vault refuses", () => {
    for (const char of ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]) {
      expect(checkFileName(`Ein${char}Name`), char).toEqual({ ok: false, problem: "characters" });
    }
  });

  it("refuses a control character, which no keyboard types on purpose", () => {
    expect(checkFileName("Ein\tName")).toEqual({ ok: false, problem: "characters" });
  });

  it("refuses the characters that would break links to the file, and says which", () => {
    for (const char of ["#", "^", "[", "]"]) {
      expect(checkFileName(`Ein${char}Name`), char).toEqual({
        ok: false,
        problem: "link-characters"
      });
    }
  });

  it("refuses a name the vault would hide", () => {
    expect(checkFileName(".versteckt")).toEqual({ ok: false, problem: "hidden" });
    expect(checkFileName(".")).toEqual({ ok: false, problem: "hidden" });
    expect(checkFileName("..")).toEqual({ ok: false, problem: "hidden" });
  });

  it("refuses a trailing dot, which one filesystem keeps and another drops", () => {
    expect(checkFileName("Entwurf.")).toEqual({ ok: false, problem: "trailing-dot" });
  });

  it("keeps a dot inside the name: that is a version, not a hidden file", () => {
    expect(checkFileName("Fassung 2.1")).toEqual({ ok: true, name: "Fassung 2.1" });
  });

  it("keeps a hyphen or an umlaut, which are names not problems", () => {
    expect(checkFileName("Straßen-Übersicht")).toEqual({ ok: true, name: "Straßen-Übersicht" });
  });
});
