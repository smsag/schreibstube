import { describe, expect, it } from "vitest";
import { arrivedReceipt, LOCAL_TRASH, localTrashPath } from "./trash-receipt";

describe("localTrashPath", () => {
  it("puts the file's name straight under the trash folder", () => {
    expect(localTrashPath("Entwurf.md")).toBe(`${LOCAL_TRASH}/Entwurf.md`);
  });
});

describe("arrivedReceipt", () => {
  it("names the entry that arrived", () => {
    expect(arrivedReceipt("a.md", [".trash/x.md"], [".trash/x.md", ".trash/a.md"])).toBe(
      ".trash/a.md"
    );
  });

  it("believes the arrival carrying the file's own name before any other", () => {
    const after = [".trash/Fremd.md", ".trash/a.md"];
    expect(arrivedReceipt("a.md", [], after)).toBe(".trash/a.md");
  });

  it("takes the one arrival there is when the trash renamed the file", () => {
    expect(arrivedReceipt("a.md", [".trash/a.md"], [".trash/a.md", ".trash/a 1.md"])).toBe(
      ".trash/a 1.md"
    );
  });

  it("has no receipt when nothing arrived", () => {
    expect(arrivedReceipt("a.md", [".trash/a.md"], [".trash/a.md"])).toBeNull();
  });
});
