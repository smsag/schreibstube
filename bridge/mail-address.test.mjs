import { describe, expect, it } from "vitest";
import { MAX_SENDER_CHARS, parseSender, senderDomain } from "./mail-address.mjs";

describe("parseSender", () => {
  it("reads a bare address", () => {
    expect(parseSender(" post@example.com ")).toEqual({ name: "", address: "post@example.com" });
  });

  it("reads a name before an address in angle brackets", () => {
    expect(parseSender("Steffen Seitz <s@grembl.de>")).toEqual({
      name: "Steffen Seitz",
      address: "s@grembl.de"
    });
  });

  it("drops the quotes around a quoted name", () => {
    expect(parseSender('"Seitz, Steffen" <s@grembl.de>')?.name).toBe("Seitz, Steffen");
  });

  it.each([
    ["a name alone", "Steffen Seitz"],
    ["empty brackets", "Steffen Seitz <>"],
    ["a spelled-out at", "Steffen <s at grembl.de>"],
    ["no dot in the domain", "s@localhost"],
    ["two addresses", "a@example.com, b@example.com"],
    ["the whole value quoted", '"Steffen Seitz <s@grembl.de>"'],
    ["the name in the brackets", "<Steffen Seitz> s@grembl.de"],
    ["a line break", "Steffen <s@grembl.de>\r\nBcc: x@example.com"],
    ["blank", "   "],
    ["not a string", 42]
  ])("refuses %s", (_, value) => {
    expect(parseSender(value)).toBeNull();
  });

  it("refuses a sender longer than any real one", () => {
    const long = `${"n".repeat(MAX_SENDER_CHARS)} <s@grembl.de>`;
    expect(parseSender(long)).toBeNull();
  });
});

describe("senderDomain", () => {
  it("is the part after the last @", () => {
    expect(senderDomain({ name: "", address: "s@mail.grembl.de" })).toBe("mail.grembl.de");
  });
});
