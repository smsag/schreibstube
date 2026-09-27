import { describe, expect, it } from "vitest";
import {
  isUnderFolder,
  MAX_FOLDER_DESCRIPTIONS,
  planFolderDescriptions
} from "./folder-descriptions";

const MB = 1024 * 1024;

describe("isUnderFolder", () => {
  it("takes the folder's subfolders, not a sibling that shares the prefix", () => {
    expect(isUnderFolder("Fotos/Urlaub/a.jpg", "Fotos")).toBe(true);
    expect(isUnderFolder("Fotos2/a.jpg", "Fotos")).toBe(false);
  });
  it("treats the vault root as holding everything", () => {
    expect(isUnderFolder("a.jpg", "")).toBe(true);
    expect(isUnderFolder("a.jpg", "/")).toBe(true);
  });
});

describe("planFolderDescriptions", () => {
  const pictures = [
    { path: "Fotos/c.jpg", size: 1 * MB },
    { path: "Fotos/a.jpg", size: 1 * MB },
    { path: "Fotos/Urlaub/b.png", size: 2 * MB },
    { path: "Fotos/big.jpg", size: 20 * MB },
    { path: "Anderes/d.jpg", size: 1 * MB }
  ];

  it("sends the undescribed pictures under the folder, in path order", () => {
    const plan = planFolderDescriptions(
      "Fotos",
      pictures,
      (path) => path === "Fotos/c.jpg",
      10 * MB
    );
    expect(plan).toEqual({
      describe: ["Fotos/a.jpg", "Fotos/Urlaub/b.png"],
      described: 1,
      tooLarge: ["Fotos/big.jpg"],
      deferred: 0
    });
  });

  it("describes nothing when every picture has its description", () => {
    const plan = planFolderDescriptions("Fotos", pictures, () => true, 10 * MB);
    expect(plan.describe).toEqual([]);
    expect(plan.described).toBe(4);
  });

  it("caps a run and counts what it left for the next", () => {
    const many = Array.from({ length: MAX_FOLDER_DESCRIPTIONS + 7 }, (_, i) => ({
      path: `F/${String(i).padStart(3, "0")}.jpg`,
      size: 1
    }));
    const plan = planFolderDescriptions("F", many, () => false, 10);
    expect(plan.describe).toHaveLength(MAX_FOLDER_DESCRIPTIONS);
    expect(plan.describe[0]).toBe("F/000.jpg");
    expect(plan.deferred).toBe(7);
  });
});
