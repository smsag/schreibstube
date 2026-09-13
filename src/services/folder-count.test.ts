import { describe, expect, it } from "vitest";
import { countFilesUnder, folderCountLabel, type CountableNode } from "./folder-count";

function file(path: string): CountableNode {
  return { path };
}

function folder(path: string, ...children: CountableNode[]): CountableNode {
  return { path, children };
}

describe("countFilesUnder", () => {
  it("counts the files directly inside", () => {
    expect(countFilesUnder(folder("Objekte", file("a.md"), file("b.md")))).toBe(2);
  });

  it("counts the files in every folder underneath as well", () => {
    const vault = folder(
      "Objekte",
      file("Exposé.md"),
      folder("Bilder", file("1.png"), file("2.png")),
      folder("Verträge", folder("2026", file("Kauf.pdf")))
    );

    expect(countFilesUnder(vault)).toBe(4);
  });

  it("does not count the folders themselves", () => {
    expect(countFilesUnder(folder("Leer", folder("Auch leer"), folder("Ebenfalls")))).toBe(0);
  });

  it("counts an empty folder as nothing", () => {
    expect(countFilesUnder(folder("Leer"))).toBe(0);
    expect(countFilesUnder({ path: "Ohne Kinder" })).toBe(0);
  });
});

describe("folderCountLabel", () => {
  it("is the number itself while it is short enough to read", () => {
    expect(folderCountLabel(1)).toBe("1");
    expect(folderCountLabel(99)).toBe("99");
  });

  it("says 99+ past the point where digits stop fitting on an icon", () => {
    expect(folderCountLabel(100)).toBe("99+");
    expect(folderCountLabel(2451)).toBe("99+");
  });

  it("says nothing for an empty folder", () => {
    // A nought says nothing a folder opening on nothing does not already say.
    expect(folderCountLabel(0)).toBeNull();
    expect(folderCountLabel(-1)).toBeNull();
    expect(folderCountLabel(Number.NaN)).toBeNull();
  });
});

describe("counting around a file that is already gone", () => {
  it("leaves out what the pane has stopped drawing", () => {
    const vault = folder(
      "Objekte",
      file("Objekte/a.md"),
      file("Objekte/b.md"),
      folder("Objekte/Bilder", file("Objekte/Bilder/1.png"))
    );
    const gone = (path: string): boolean =>
      path === "Objekte/b.md" || path === "Objekte/Bilder/1.png";

    expect(countFilesUnder(vault, gone)).toBe(1);
  });

  it("leaves out a whole folder that went with it", () => {
    const vault = folder(
      "Objekte",
      file("Objekte/a.md"),
      folder("Objekte/Alt", file("Objekte/Alt/x.md"), file("Objekte/Alt/y.md"))
    );

    expect(countFilesUnder(vault, (path) => path === "Objekte/Alt")).toBe(1);
  });
});
