import { describe, expect, it } from "vitest";
import {
  IMAGE_EXTENSIONS,
  MAX_TILES,
  folderImages,
  hasFolderImages,
  isImageName
} from "./folder-images";
import type { NamedNode } from "./folder-images";
import { getImageMimeType } from "./image-resize";

const file = (path: string): NamedNode => ({ path, name: path.split("/").pop() ?? path });
const folder = (path: string, children: NamedNode[] = []): NamedNode => ({
  path,
  name: path.split("/").pop() ?? path,
  children
});

describe("isImageName", () => {
  it("knows every extension an <img> can draw, whatever its case", () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(isImageName(`Bild.${ext}`), ext).toBe(true);
      expect(isImageName(`Bild.${ext.toUpperCase()}`), ext).toBe(true);
    }
  });

  it("refuses what an <img> cannot draw", () => {
    for (const name of ["Notiz.md", "Film.mp4", "Ton.mp3", "Tabelle.csv", "Bild.pdf"]) {
      expect(isImageName(name), name).toBe(false);
    }
  });

  it("treats no dot, and a dot only at the front, as no extension", () => {
    expect(isImageName("README")).toBe(false);
    expect(isImageName(".png")).toBe(false);
  });

  it("draws everything image-resize can re-encode, so the two lists cannot drift apart", () => {
    for (const ext of ["jpg", "jpeg", "png", "gif", "webp"]) {
      expect(getImageMimeType(ext)).not.toBeNull();
      expect(IMAGE_EXTENSIONS.has(ext), ext).toBe(true);
    }
  });
});

describe("folderImages", () => {
  it("lists the folder's pictures and nothing else", () => {
    const result = folderImages(
      folder("Fotos", [file("Fotos/a.jpg"), file("Fotos/Notiz.md"), file("Fotos/b.png")])
    );

    expect(result.images.map((image) => image.name)).toEqual(["a.jpg", "b.png"]);
    expect(result.held).toBe(0);
  });

  it("leaves a subfolder's pictures to that folder", () => {
    const result = folderImages(
      folder("Fotos", [file("Fotos/a.jpg"), folder("Fotos/2025", [file("Fotos/2025/b.jpg")])])
    );

    expect(result.images.map((image) => image.path)).toEqual(["Fotos/a.jpg"]);
  });

  it("orders by name the way the tree does: Bild 2 before Bild 10", () => {
    const result = folderImages(
      folder("F", [file("F/Bild 10.jpg"), file("F/bild 2.jpg"), file("F/Bild 1.jpg")])
    );

    expect(result.images.map((image) => image.name)).toEqual([
      "Bild 1.jpg",
      "bild 2.jpg",
      "Bild 10.jpg"
    ]);
  });

  it("does not care about the order the vault happens to hold them in", () => {
    const shuffled = folder("F", [file("F/c.jpg"), file("F/a.jpg"), file("F/b.jpg")]);

    expect(folderImages(shuffled).images.map((image) => image.name)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg"
    ]);
  });

  it("stops at the cap and counts the rest", () => {
    const many = folder(
      "F",
      Array.from({ length: MAX_TILES + 5 }, (_, i) => file(`F/Bild ${i}.jpg`))
    );

    const result = folderImages(many);

    expect(result.images).toHaveLength(MAX_TILES);
    expect(result.held).toBe(5);
  });

  it("takes a cap from the caller, and a cap of nothing holds everything back", () => {
    const three = folder("F", [file("F/a.jpg"), file("F/b.jpg"), file("F/c.jpg")]);

    expect(folderImages(three, { max: 2 })).toMatchObject({ held: 1 });
    expect(folderImages(three, { max: 0 })).toEqual({ images: [], held: 3 });
    expect(folderImages(three, { max: 10 })).toMatchObject({ held: 0 });
  });

  it("leaves out a picture the pane has already taken away", () => {
    const result = folderImages(folder("F", [file("F/a.jpg"), file("F/b.jpg")]), {
      gone: (path) => path === "F/a.jpg"
    });

    expect(result.images.map((image) => image.name)).toEqual(["b.jpg"]);
  });

  it("answers an empty folder, and a folder of notes, with nothing", () => {
    expect(folderImages(folder("F"))).toEqual({ images: [], held: 0 });
    expect(folderImages(folder("F", [file("F/a.md")]))).toEqual({ images: [], held: 0 });
  });
});

describe("hasFolderImages", () => {
  it("is true for a folder with a picture of its own", () => {
    expect(hasFolderImages(folder("F", [file("F/Notiz.md"), file("F/a.jpg")]))).toBe(true);
  });

  it("is false when the only pictures sit in a subfolder", () => {
    expect(hasFolderImages(folder("F", [folder("F/Sub", [file("F/Sub/a.jpg")])]))).toBe(false);
  });

  it("is false when the only picture has been taken away", () => {
    expect(hasFolderImages(folder("F", [file("F/a.jpg")]), (path) => path === "F/a.jpg")).toBe(
      false
    );
  });
});
