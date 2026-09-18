import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstReadable, generatorAssets } from "./assets.mjs";

describe("firstReadable", () => {
  it("returns the first candidate that exists, in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "schreibstube-assets-"));
    const second = join(dir, "second.js");
    await writeFile(second, "second");
    const first = join(dir, "first.js");
    await writeFile(first, "first");

    expect((await firstReadable([join(dir, "missing.js"), first, second])).toString()).toBe(
      "first"
    );
  });

  it("only resolves a lazy candidate once the ones before it have failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "schreibstube-assets-"));
    const present = join(dir, "present.js");
    await writeFile(present, "present");

    let resolved = false;
    const lazy = () => {
      resolved = true;
      throw new Error("package not installed");
    };
    expect((await firstReadable([present, lazy])).toString()).toBe("present");
    expect(resolved).toBe(false);
  });

  it("names the last failure when nothing can be read", async () => {
    await expect(firstReadable(["/nowhere/at/all.js"])).rejects.toThrow(/No readable candidate/);
  });
});

describe("generatorAssets", () => {
  it("ships the Mermaid bundle only when a page used a diagram", async () => {
    const without = await generatorAssets({ math: false, mermaid: false });
    expect(without.has("assets/mermaid.min.js")).toBe(false);

    const withDiagram = await generatorAssets({ math: false, mermaid: true });
    expect(withDiagram.get("assets/mermaid.min.js").length).toBeGreaterThan(1_000_000);
  });
});
