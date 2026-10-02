import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { TFile as StubFile } from "../testing/obsidian-stub";
import { createLogger } from "../services/logger";
import { BASE_READING_KEY, MAX_BASE_FILE_BYTES } from "../services/bases-reading";
import { BaseReadingFlags, isBaseFile } from "./base-reading-flags";

const SHOWN = "views:\n  - type: cards\n    name: Favoriten\n";

/** A vault of base files, by path and text, written through `process` as Obsidian does. */
function vault(files: Record<string, string>) {
  const texts = new Map(Object.entries(files));
  const objects = new Map(
    [...texts.keys()].map((path) => {
      const file = new StubFile(path);
      file.stat.size = (texts.get(path) ?? "").length;
      return [path, file as unknown as TFile];
    })
  );
  const process = vi.fn(async (file: TFile, edit: (text: string) => string) => {
    texts.set(file.path, edit(texts.get(file.path) ?? ""));
  });
  const app = {
    vault: {
      getFiles: () => [...objects.values()],
      cachedRead: async (file: TFile) => texts.get(file.path) ?? "",
      process
    }
  } as unknown as App;
  const flags = new BaseReadingFlags(
    app,
    createLogger(() => false)
  );
  const file = (path: string) => objects.get(path) as TFile;
  return { flags, texts, file, process };
}

describe("BaseReadingFlags", () => {
  it("reads every base once, and only `true` at the top of a base as yes", async () => {
    const { flags, file } = vault({
      "Lesen.base": `${BASE_READING_KEY}: true\n${SHOWN}`,
      "Bearbeiten.base": SHOWN,
      "Kaputt.base": `${BASE_READING_KEY}: true\nviews: [unclosed\n`,
      "Notiz.md": `${BASE_READING_KEY}: true\n`
    });
    await flags.scan();
    expect(flags.reads(file("Lesen.base"))).toBe(true);
    expect(flags.reads(file("Bearbeiten.base"))).toBe(false);
    // A base Obsidian cannot read either opens nothing differently.
    expect(flags.reads(file("Kaputt.base"))).toBe(false);
    expect(flags.reads(file("Notiz.md"))).toBe(false);
  });

  it("does not read a base too large to be one", async () => {
    const { flags, file } = vault({ "Gross.base": `${BASE_READING_KEY}: true\n` });
    file("Gross.base").stat.size = MAX_BASE_FILE_BYTES + 1;
    await flags.read(file("Gross.base"));
    expect(flags.reads(file("Gross.base"))).toBe(false);
  });

  it("writes the choice into the base's file, and takes it out again", async () => {
    const { flags, texts, file } = vault({ "Favoriten.base": SHOWN });
    expect(await flags.toggle(file("Favoriten.base"))).toBe(true);
    expect(texts.get("Favoriten.base")).toBe(`${BASE_READING_KEY}: true\n${SHOWN}`);
    expect(flags.reads(file("Favoriten.base"))).toBe(true);

    expect(await flags.toggle(file("Favoriten.base"))).toBe(false);
    expect(texts.get("Favoriten.base")).toBe(SHOWN);
    expect(flags.reads(file("Favoriten.base"))).toBe(false);
  });

  it("writes nothing into a base whose file does not read as YAML", async () => {
    const broken = "views: [unclosed\n";
    const { flags, texts, file } = vault({ "Kaputt.base": broken });
    await expect(flags.toggle(file("Kaputt.base"))).rejects.toThrow();
    expect(texts.get("Kaputt.base")).toBe(broken);
    expect(flags.reads(file("Kaputt.base"))).toBe(false);
  });

  it("follows a base that is renamed or deleted", async () => {
    const { flags, file } = vault({ "Alt.base": `${BASE_READING_KEY}: true\n` });
    await flags.scan();
    const moved = new StubFile("Neu/Alt.base") as unknown as TFile;
    flags.renamed(moved, "Alt.base");
    expect(flags.reads(moved)).toBe(true);
    expect(flags.reads(file("Alt.base"))).toBe(false);
    flags.deleted("Neu/Alt.base");
    expect(flags.reads(moved)).toBe(false);
  });

  it("tells a base from any other file", () => {
    expect(isBaseFile(new StubFile("a.base") as unknown as TFile)).toBe(true);
    expect(isBaseFile(new StubFile("a.md") as unknown as TFile)).toBe(false);
    expect(isBaseFile(null)).toBe(false);
  });
});
