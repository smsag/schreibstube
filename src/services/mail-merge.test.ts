import { describe, expect, it } from "vitest";
import type { MailMessage } from "./mail-protocol";
import {
  appendToSection,
  formatMessage,
  formatMessages,
  mergeKey,
  selectUnmerged
} from "./mail-merge";

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    uid: 1,
    messageId: "<r1@example.com>",
    inReplyTo: null,
    references: [],
    from: "Kunde <k@example.com>",
    to: "me@example.de",
    subject: "Re: Angebot",
    date: "2026-09-07T10:12:00.000Z",
    text: "Passt so.",
    truncated: false,
    ...overrides
  };
}

describe("selectUnmerged", () => {
  it("drops messages already recorded in the note", () => {
    const messages = [message(), message({ messageId: "<r2@example.com>", uid: 2 })];
    expect(selectUnmerged(messages, ["<r1@example.com>"])).toHaveLength(1);
    expect(selectUnmerged(messages, ["<r1@example.com>"])[0].messageId).toBe(
      "<r2@example.com>"
    );
  });

  it("is a no-op when everything was merged before — the command stays idempotent", () => {
    const messages = [message()];
    expect(selectUnmerged(messages, ["<r1@example.com>"])).toEqual([]);
  });

  it("collapses a duplicate appearing twice in one response", () => {
    expect(selectUnmerged([message(), message()], [])).toHaveLength(1);
  });

  it("falls back to the UID when the server returned no Message-ID", () => {
    const anonymous = message({ messageId: null, uid: 77 });
    expect(mergeKey(anonymous)).toBe("uid:77");
    expect(selectUnmerged([anonymous], ["uid:77"])).toEqual([]);
  });
});

describe("formatMessage", () => {
  it("renders subject, metadata and a quoted body", () => {
    const rendered = formatMessage(message());
    expect(rendered).toContain("### Re: Angebot");
    expect(rendered).toContain("**From:** Kunde <k@example.com>");
    expect(rendered).toContain("**Date:** 2026-09-07 10:12");
    expect(rendered).toContain("> Passt so.");
  });

  it("quotes every line so email content cannot inject headings into the note", () => {
    const rendered = formatMessage(message({ text: "# Not a heading\n\n- not a list" }));
    expect(rendered).toContain("> # Not a heading");
    expect(rendered).toContain("> - not a list");
    expect(rendered.split("\n").filter((line) => line.startsWith("# "))).toEqual([]);
  });

  it("marks a body the bridge truncated", () => {
    expect(formatMessage(message({ truncated: true }))).toMatch(/truncated/i);
  });

  it("handles an empty subject and body", () => {
    const rendered = formatMessage(message({ subject: "", text: "" }));
    expect(rendered).toContain("### (no subject)");
    expect(rendered).toContain("no text content");
  });
});

describe("formatMessages", () => {
  it("separates messages with a blank line", () => {
    const rendered = formatMessages([message(), message({ subject: "Re: Zweites" })]);
    expect(rendered).toContain("### Re: Angebot");
    expect(rendered).toContain("### Re: Zweites");
  });
});

describe("appendToSection", () => {
  it("creates the section when the note has none", () => {
    const result = appendToSection("Body text", "Correspondence", "### Reply");
    expect(result).toBe("Body text\n\n## Correspondence\n\n### Reply\n");
  });

  it("appends into an existing section", () => {
    const note = "Body\n\n## Correspondence\n\n### First\n";
    const result = appendToSection(note, "Correspondence", "### Second");
    expect(result).toBe("Body\n\n## Correspondence\n\n### First\n\n### Second\n");
  });

  it("keeps content that follows the section", () => {
    const note = "Body\n\n## Correspondence\n\n### First\n\n## Notes\n\nAfterwards";
    const result = appendToSection(note, "Correspondence", "### Second");
    expect(result).toBe(
      "Body\n\n## Correspondence\n\n### First\n\n### Second\n\n## Notes\n\nAfterwards\n"
    );
  });

  it("does not treat a deeper heading inside the section as its end", () => {
    const note = "## Correspondence\n\n### First\n\n#### Detail";
    const result = appendToSection(note, "Correspondence", "### Second");
    expect(result).toBe("## Correspondence\n\n### First\n\n#### Detail\n\n### Second\n");
  });

  it("creates the section on an empty note without leading blank lines", () => {
    expect(appendToSection("", "Correspondence", "### Reply")).toBe(
      "## Correspondence\n\n### Reply\n"
    );
  });
});

describe("appendToSection — heading whitespace", () => {
  it("re-uses the section when the configured heading has stray whitespace", () => {
    // Regression: an untrimmed heading never matched the section it wrote last
    // time, so every run appended another "## Correspondence" block.
    const first = appendToSection("Body", "Correspondence ", "### One");
    const second = appendToSection(first, "Correspondence ", "### Two");

    expect(second.match(/## Correspondence/g)).toHaveLength(1);
    expect(second).toContain("### One");
    expect(second).toContain("### Two");
  });

  it("matches a section written with the trimmed heading", () => {
    const note = "Body\n\n## Correspondence\n\n### One\n";
    expect(appendToSection(note, "  Correspondence  ", "### Two")).toBe(
      "Body\n\n## Correspondence\n\n### One\n\n### Two\n"
    );
  });
});
