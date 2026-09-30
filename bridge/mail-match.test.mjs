import { describe, expect, it } from "vitest";
import { addressText, matchableWithoutServer, matchesCriteria } from "./mail-match.mjs";

const REPLY = {
  from: "<info@nascor-hausverwaltung.de>",
  to: "<steffen@smsag.de>",
  subject:
    "AW: Fristsetzung – Offene Punkte WE 6, Schreinerstraße 21 (Ihre Bestellung seit 12/2025)",
  date: new Date("2026-09-28T13:18:27Z"),
  headers:
    "References: <c6383404-7860-49fc-be5d-65ffefca9677@localhost>\r\n" +
    "In-Reply-To: <c6383404-7860-49fc-be5d-65ffefca9677@localhost>\r\n"
};

describe("matchesCriteria", () => {
  it("matches everything when no criterion is given", () => {
    expect(matchesCriteria(REPLY, {})).toBe(true);
  });

  it("takes a message on or after the since date", () => {
    expect(matchesCriteria(REPLY, { since: "2026-09-25" })).toBe(true);
    expect(matchesCriteria(REPLY, { since: "2026-09-28" })).toBe(true);
    expect(matchesCriteria(REPLY, { since: "2026-09-29" })).toBe(false);
  });

  it("leaves out a message with no readable date when a since date is asked for", () => {
    expect(matchesCriteria({ ...REPLY, date: null }, { since: "2026-09-25" })).toBe(false);
  });

  it("ignores an unparseable since date, as the query builder does", () => {
    expect(matchesCriteria(REPLY, { since: "irgendwann" })).toBe(true);
  });

  it("matches the subject as a case-insensitive part", () => {
    expect(matchesCriteria(REPLY, { subject: "fristsetzung" })).toBe(true);
    expect(matchesCriteria(REPLY, { subject: "Mahnung" })).toBe(false);
  });

  it("matches sender and recipient by part of name or address", () => {
    expect(matchesCriteria(REPLY, { from: "nascor" })).toBe(true);
    expect(matchesCriteria(REPLY, { to: "STEFFEN@smsag.de" })).toBe(true);
    expect(matchesCriteria(REPLY, { from: "steffen" })).toBe(false);
  });

  it("finds a reply by the Message-ID it cites", () => {
    expect(
      matchesCriteria(REPLY, { references: " <c6383404-7860-49fc-be5d-65ffefca9677@localhost> " })
    ).toBe(true);
    expect(matchesCriteria(REPLY, { references: "<other@example.com>" })).toBe(false);
    expect(matchesCriteria({ ...REPLY, headers: undefined }, { references: "<a@b>" })).toBe(false);
  });

  it("requires every criterion", () => {
    expect(matchesCriteria(REPLY, { from: "nascor", since: "2026-09-29" })).toBe(false);
  });

  it("ignores blank criteria", () => {
    expect(matchesCriteria(REPLY, { from: "  ", subject: "" })).toBe(true);
  });
});

describe("matchableWithoutServer", () => {
  it("answers everything an envelope holds", () => {
    expect(matchableWithoutServer({ from: "a", since: "2026-09-25", references: "<a@b>" })).toBe(
      true
    );
  });

  it("cannot answer a body text", () => {
    expect(matchableWithoutServer({ text: "Objekt" })).toBe(false);
    expect(matchableWithoutServer({ text: "  " })).toBe(true);
  });
});

describe("addressText", () => {
  it("writes names and addresses the way a header holds them", () => {
    expect(
      addressText([{ name: "Nascor", address: "info@nascor.de" }, { address: "b@example.com" }])
    ).toBe("Nascor <info@nascor.de>, <b@example.com>");
  });

  it("reads a missing list as empty", () => {
    expect(addressText(undefined)).toBe("");
  });
});
