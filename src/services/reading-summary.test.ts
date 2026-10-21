import { describe, expect, it } from "vitest";
import {
  cleanReadingSummary,
  MAX_SUMMARY_INPUT_CHARS,
  READING_SUMMARY_MAX_CHARS,
  readingSummaryInput,
  readingSummaryPrompt
} from "./reading-summary";

describe("readingSummaryPrompt", () => {
  it("asks for one line in the article's own language, within the limit", () => {
    expect(readingSummaryPrompt()).toContain("in the language the passages are written in");
    expect(readingSummaryPrompt()).toContain(`at most ${READING_SUMMARY_MAX_CHARS} characters`);
  });
});

describe("readingSummaryInput", () => {
  it("lists the passages with their notes under the title", () => {
    expect(
      readingSummaryInput("An  Article", [
        { text: "First\npassage.", note: "Mine." },
        { text: "Second.", note: "" }
      ])
    ).toBe("Article: An Article\n\nHighlights:\n- First passage.\n  (note: Mine.)\n- Second.");
  });

  it("has nothing to summarize without passages", () => {
    expect(readingSummaryInput("T", [])).toBeNull();
    expect(readingSummaryInput("T", [{ text: "  ", note: "" }])).toBeNull();
  });

  it("stays within its budget, cutting a single passage that would not fit", () => {
    const many = Array.from({ length: 200 }, () => ({ text: "x".repeat(100), note: "" }));
    expect(readingSummaryInput("T", many)?.length).toBeLessThanOrEqual(MAX_SUMMARY_INPUT_CHARS);

    const huge = readingSummaryInput("T", [
      { text: "y".repeat(MAX_SUMMARY_INPUT_CHARS * 2), note: "" }
    ]);
    expect(huge?.length).toBeLessThanOrEqual(MAX_SUMMARY_INPUT_CHARS);
    expect(huge).toContain("yyy");
  });
});

describe("cleanReadingSummary", () => {
  it("keeps a sentence that is already right", () => {
    expect(cleanReadingSummary("Remote teams need written decisions.")).toBe(
      "Remote teams need written decisions."
    );
  });

  it("flattens lines and drops list marks and wrapping quotes", () => {
    expect(cleanReadingSummary('> "Remote teams\nneed written decisions."')).toBe(
      "Remote teams need written decisions."
    );
    expect(cleanReadingSummary("- „Schreiben schlägt Reden.“")).toBe("Schreiben schlägt Reden.");
  });

  it("cuts at a word near the limit", () => {
    const long = "word ".repeat(60);
    const line = cleanReadingSummary(long) ?? "";
    expect([...line].length).toBeLessThanOrEqual(READING_SUMMARY_MAX_CHARS);
    expect(line.endsWith("word…")).toBe(true);
  });

  it("cuts a single overlong word where it must", () => {
    const line = cleanReadingSummary("a".repeat(300)) ?? "";
    expect([...line].length).toBe(READING_SUMMARY_MAX_CHARS);
  });

  it("escapes what would build something in the note", () => {
    expect(cleanReadingSummary("See ![[secret]] and `code` %% hidden")).toBe(
      "See !\\[\\[secret]] and &#96;code&#96; %&#37; hidden"
    );
  });

  it("answers nothing for an empty answer", () => {
    expect(cleanReadingSummary("  \n ")).toBeNull();
    expect(cleanReadingSummary('""')).toBeNull();
  });
});
