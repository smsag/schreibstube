import { describe, expect, it } from "vitest";
import { isSourceFileName } from "./source-files";

const FAMILY = "xenova-paraphrase-multilingual-MiniLM-L12-v2";
const file = (id: string, ending = ".bin") => `semantic-source-${id}-${FAMILY}${ending}`;

describe("a source's files", () => {
  it("are its index, journals, a write's leftovers and iCloud's copies, for any model", () => {
    for (const ending of [
      ".bin",
      ".journal.bin",
      ".phone-journal.bin",
      ".bin.tmp",
      ".bin.old",
      " 2.bin",
      ".journal 3.bin"
    ]) {
      expect(isSourceFileName(file("reader", ending), "reader")).toBe(true);
    }
    expect(isSourceFileName("semantic-source-reader-xenova-all-MiniLM-L6-v2.bin", "reader")).toBe(
      true
    );
  });

  it("are never those of a source whose id begins with its own", () => {
    expect(isSourceFileName(file("reader-sync"), "reader")).toBe(false);
    expect(isSourceFileName(file("reader-sync", ".journal.bin"), "reader")).toBe(false);
    expect(isSourceFileName(file("reader-sync"), "reader-sync")).toBe(true);
  });

  it("are not the vault's index, another file, or a model this version does not know", () => {
    expect(isSourceFileName(`semantic-notes-${FAMILY}.bin`, "reader")).toBe(false);
    expect(isSourceFileName(file("reader", ".json"), "reader")).toBe(false);
    expect(isSourceFileName("semantic-source-reader-retired-model.bin", "reader")).toBe(false);
    expect(isSourceFileName(`${file("reader")}.bak`, "reader")).toBe(false);
  });
});
