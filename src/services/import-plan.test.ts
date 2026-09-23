import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES, planImport } from "./import-plan";
import type { DroppedFile } from "./import-plan";

const file = (name: string, size = 100): DroppedFile => ({ name, size });
const taken = (...paths: string[]): ReadonlySet<string> => new Set(paths);

describe("planImport", () => {
  it("puts a file in the folder it was dropped on", () => {
    const plan = planImport([file("Scan.pdf")], "Anhänge", taken());

    expect(plan.imports).toEqual([{ index: 0, name: "Scan.pdf", path: "Anhänge/Scan.pdf" }]);
    expect(plan.refused).toEqual([]);
  });

  it("puts a file dropped on the root at the root", () => {
    expect(planImport([file("Scan.pdf")], "", taken()).imports[0]?.path).toBe("Scan.pdf");
  });

  it("gives a taken name the next free one, the way a new note is named", () => {
    const plan = planImport([file("Scan.pdf")], "", taken("Scan.pdf", "Scan 1.pdf"));

    expect(plan.imports[0]?.path).toBe("Scan 2.pdf");
  });

  it("keeps two files of one name in a drop apart", () => {
    const plan = planImport([file("Foto.jpg"), file("Foto.jpg")], "", taken());

    expect(plan.imports.map((entry) => entry.path)).toEqual(["Foto.jpg", "Foto 1.jpg"]);
    // Each keeps its place in the drop, which is the only thing that tells
    // their bytes apart.
    expect(plan.imports.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it("refuses a path hidden in the extension", () => {
    const plan = planImport([file("a.b/../../x"), file("a.b\\c")], "Anhänge", taken());

    expect(plan.imports).toEqual([]);
    expect(plan.refused.map((entry) => entry.reason)).toEqual(["bad-name", "bad-name"]);
  });

  it("splits the extension where the vault does, so archive.tar.gz keeps its .gz", () => {
    const plan = planImport([file("archive.tar.gz")], "", taken("archive.tar.gz"));

    expect(plan.imports[0]?.path).toBe("archive.tar 1.gz");
  });

  it("refuses a folder, which has a name and nothing behind it", () => {
    const plan = planImport([{ name: "Photos", size: 0, isFolder: true }], "", taken());

    expect(plan.imports).toEqual([]);
    expect(plan.refused).toEqual([{ name: "Photos", reason: "folder" }]);
  });

  it("refuses a file too large to read into memory", () => {
    const plan = planImport([file("Film.mov", MAX_IMPORT_BYTES + 1)], "", taken());

    expect(plan.refused).toEqual([{ name: "Film.mov", reason: "too-large" }]);
  });

  it("refuses a name the vault would refuse", () => {
    const plan = planImport([file("Was?.pdf"), file(".versteckt")], "", taken());

    expect(plan.refused.map((entry) => entry.reason)).toEqual(["bad-name", "bad-name"]);
  });

  it("stops at the drop's limit and says so for the rest", () => {
    const many = Array.from({ length: MAX_IMPORT_FILES + 2 }, (_, i) => file(`Bild ${i}.jpg`));
    const plan = planImport(many, "", taken());

    expect(plan.imports).toHaveLength(MAX_IMPORT_FILES);
    expect(plan.refused).toHaveLength(2);
    expect(plan.refused[0]?.reason).toBe("too-many");
  });

  it("keeps the good files of a drop that also held bad ones", () => {
    const plan = planImport(
      [file("Gut.pdf"), { name: "Ordner", size: 0, isFolder: true }, file("Auch gut.pdf")],
      "",
      taken()
    );

    expect(plan.imports.map((entry) => entry.name)).toEqual(["Gut.pdf", "Auch gut.pdf"]);
    expect(plan.refused).toHaveLength(1);
  });
});
