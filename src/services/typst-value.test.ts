import { describe, expect, it } from "vitest";
import { typstDictionary, typstKey, typstLength, typstString } from "./typst-value";

describe("typstString", () => {
  it("quotes plain text", () => {
    expect(typstString("Steffen Seitz")).toBe('"Steffen Seitz"');
  });

  it("escapes the two characters a literal cannot hold", () => {
    expect(typstString('a "quote" and a \\ backslash')).toBe(
      '"a \\"quote\\" and a \\\\ backslash"'
    );
  });

  it("cannot be closed early by a newline or a control character", () => {
    expect(typstString("Schreinerstr. 21\n10247 Berlin")).toBe('"Schreinerstr. 21\\n10247 Berlin"');
    expect(typstString("a\u0007b")).toBe('"a\\u{7}b"');
    expect(typstString("a\tb")).toBe('"a\\tb"');
  });

  it("leaves markup characters alone, because a literal is not markup", () => {
    expect(typstString("#let x = 1 [$y$]")).toBe('"#let x = 1 [$y$]"');
  });

  it("keeps text outside the basic plane intact", () => {
    expect(typstString("Grüße 🇩🇪")).toBe('"Grüße 🇩🇪"');
  });
});

describe("typstKey", () => {
  it("writes an identifier bare", () => {
    expect(typstKey("senderName")).toBe("senderName");
    expect(typstKey("sender-name")).toBe("sender-name");
    expect(typstKey("_private")).toBe("_private");
  });

  it("quotes anything a dictionary would refuse", () => {
    expect(typstKey("sender name")).toBe('"sender name"');
    expect(typstKey("2nd")).toBe('"2nd"');
    expect(typstKey("trailing-")).toBe('"trailing-"');
    expect(typstKey("")).toBe('""');
  });
});

describe("typstDictionary", () => {
  it("writes the empty dictionary in the form Typst needs", () => {
    expect(typstDictionary({})).toBe("(:)");
  });

  it("keeps the given order and escapes every value", () => {
    expect(typstDictionary({ name: "Ekinci", note: 'say "hi"' })).toBe(
      '(name: "Ekinci", note: "say \\"hi\\"")'
    );
  });
});

describe("typstLength", () => {
  it("accepts the units a page margin is written in", () => {
    expect(typstLength("25mm")).toBe("25mm");
    expect(typstLength(" 1.5cm ")).toBe("1.5cm");
    expect(typstLength("12pt")).toBe("12pt");
  });

  it("refuses anything else, so a bad value cannot reach the source", () => {
    for (const value of ["25", "25 px", "calc(1)", "", "25mm; #panic()"]) {
      expect(typstLength(value)).toBeNull();
    }
  });
});
