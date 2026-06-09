import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "./llm-rename";

describe("sanitizeFilename", () => {
  it("returns clean input unchanged", () => {
    expect(sanitizeFilename("my-note-title", 60)).toBe("my-note-title");
  });

  it("strips illegal characters", () => {
    expect(sanitizeFilename('note: with/slashes*and?questions"', 60)).toBe(
      "note-withslashesandquestions"
    );
  });

  it("converts whitespace to hyphens", () => {
    expect(sanitizeFilename("my note title", 60)).toBe("my-note-title");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeFilename("my--note---title", 60)).toBe("my-note-title");
  });

  it("trims leading and trailing hyphens", () => {
    expect(sanitizeFilename("-my-note-", 60)).toBe("my-note");
  });

  it("trims leading and trailing dots", () => {
    expect(sanitizeFilename("...my-note...", 60)).toBe("my-note");
  });

  it("truncates to maxLength", () => {
    expect(sanitizeFilename("a-very-long-filename-that-exceeds-the-limit", 10)).toHaveLength(10);
  });

  it("removes trailing hyphen introduced by truncation", () => {
    expect(sanitizeFilename("hello-world", 6)).toBe("hello");
  });

  it("returns empty string for all-illegal input", () => {
    expect(sanitizeFilename("///***???", 60)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeFilename("", 60)).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeFilename("   ", 60)).toBe("");
  });
});
