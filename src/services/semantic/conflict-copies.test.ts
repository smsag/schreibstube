import { describe, expect, it } from "vitest";
import { conflictCopies, conflictCopyNumber, MAX_CONFLICT_COPIES } from "./conflict-copies";

const JOURNAL = "semantic-notes-xenova-paraphrase-multilingual-MiniLM-L12-v2.journal.bin";
const copy = (n: number): string =>
  `semantic-notes-xenova-paraphrase-multilingual-MiniLM-L12-v2.journal ${n}.bin`;

describe("conflictCopyNumber — iCloud's name for a second file under one name", () => {
  it("reads the number iCloud puts before the last extension", () => {
    expect(conflictCopyNumber(copy(2), JOURNAL)).toBe(2);
    expect(conflictCopyNumber(copy(14), JOURNAL)).toBe(14);
    expect(conflictCopyNumber("data 3.json", "data.json")).toBe(3);
    expect(conflictCopyNumber("README 2", "README")).toBe(2);
  });

  it("is not a copy: the file itself, another file, or a number iCloud never writes", () => {
    expect(conflictCopyNumber(JOURNAL, JOURNAL)).toBeNull();
    expect(
      conflictCopyNumber(
        "semantic-notes-xenova-paraphrase-multilingual-MiniLM-L12-v2.phone-journal 2.bin",
        JOURNAL
      )
    ).toBeNull();
    expect(
      conflictCopyNumber(
        "semantic-notes-xenova-paraphrase-multilingual-MiniLM-L12-v2 2.bin",
        JOURNAL
      )
    ).toBeNull();
    for (const n of ["1", "0", "02", "x", "", "2 2", "-2", "1234567"])
      expect(
        conflictCopyNumber(
          `semantic-notes-xenova-paraphrase-multilingual-MiniLM-L12-v2.journal ${n}.bin`,
          JOURNAL
        )
      ).toBeNull();
    expect(conflictCopyNumber(`${JOURNAL} 2`, JOURNAL)).toBeNull();
  });
});

describe("conflictCopies", () => {
  it("lists the copies of one file, newest first", () => {
    expect(conflictCopies([JOURNAL, copy(2), "data.json", copy(10), copy(3)], JOURNAL)).toEqual([
      copy(10),
      copy(3),
      copy(2)
    ]);
  });

  it("reads no more than its budget, keeping the newest", () => {
    const names = Array.from({ length: MAX_CONFLICT_COPIES + 8 }, (_, i) => copy(i + 2));
    const out = conflictCopies(names, JOURNAL);
    expect(out).toHaveLength(MAX_CONFLICT_COPIES);
    expect(out[0]).toBe(copy(MAX_CONFLICT_COPIES + 9));
  });
});
