import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "../testing/obsidian-stub";
import { OrphanRepair } from "./orphan-repair";
import { descriptionNotePath, hashImageBytes } from "../services/image-description";
import { NULL_LOGGER } from "../services/logger";

const FOLDER = "Bildbeschreibungen";
const bytes = (seed: number, size = 64) =>
  Uint8Array.from({ length: size }, (_, i) => (i * seed) % 251);

/** Pictures with bytes, notes with text, and orphans as the pairing named them. */
function vault(pictures: Record<string, Uint8Array>, notes: Record<string, string>) {
  const text = new Map(Object.entries(notes));
  const handles = new Map<string, TFile>();
  const file = (path: string): TFile => {
    let handle = handles.get(path);
    if (!handle) {
      handle = new TFile(path);
      const data = pictures[path];
      if (data) handle.stat.size = data.byteLength;
      handles.set(path, handle);
    }
    return handle;
  };
  const exists = (path: string) => path in pictures || text.has(path);
  const reads: string[] = [];
  const renameFile = vi.fn(async (f: TFile, to: string) => {
    text.set(to, text.get(f.path) ?? "");
    text.delete(f.path);
  });
  const app = {
    vault: {
      getFiles: () => [...Object.keys(pictures), ...text.keys()].map(file),
      getAbstractFileByPath: (path: string) => (exists(path) ? file(path) : null),
      readBinary: async (f: TFile) => {
        reads.push(f.path);
        const data = pictures[f.path] ?? new Uint8Array();
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
      process: async (f: TFile, fn: (t: string) => string) => {
        text.set(f.path, fn(text.get(f.path) ?? ""));
      }
    },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const body = text.get(f.path) ?? "";
        const image = /^schreibstubeImage: "(.*)"$/m.exec(body)?.[1];
        const hash = /^schreibstubeImageHash: "(.*)"$/m.exec(body)?.[1];
        const size = /^schreibstubeImageSize: (\d+)$/m.exec(body)?.[1];
        return {
          frontmatter: {
            schreibstubeImage: image,
            schreibstubeImageHash: hash,
            schreibstubeImageSize: size === undefined ? undefined : Number(size)
          }
        };
      }
    },
    fileManager: { renameFile }
  } as unknown as App;
  return { app, text, reads, renameFile };
}

const noteFor = (image: string, data: Uint8Array) =>
  [
    "---",
    `schreibstubeImage: "[[${image}]]"`,
    `schreibstubeImageHash: "${hashImageBytes(data)}"`,
    `schreibstubeImageSize: ${data.byteLength}`,
    "---",
    "",
    `![[${image}]]`
  ].join("\n");

function repair(v: ReturnType<typeof vault>, orphans: string[], described: string[] = []) {
  const changed = vi.fn();
  const pairs = () => ({
    byImage: new Map(described.map((p) => [p, "x.md"])),
    notes: new Set<string>(),
    orphans,
    duplicates: []
  });
  return { run: new OrphanRepair(v.app, pairs, changed, NULL_LOGGER), changed };
}

describe("repairing orphaned descriptions", () => {
  it("re-links a note to the picture that moved, and renames it to match", async () => {
    const see = bytes(3);
    const old = descriptionNotePath(FOLDER, "Alt/see.jpg");
    const v = vault(
      { "Neu/see-2.jpg": see, "berg.jpg": bytes(7) },
      { [old]: noteFor("Alt/see.jpg", see) }
    );
    const { run, changed } = repair(v, [old]);

    const result = await run.repair();

    expect(result).toEqual({ repaired: 1, remaining: [] });
    const renamed = descriptionNotePath(FOLDER, "Neu/see-2.jpg");
    expect(v.text.get(renamed)).toContain("![[Neu/see-2.jpg]]");
    expect(changed).toHaveBeenCalledOnce();
  });

  it("lists a note whose picture is gone, and changes nothing", async () => {
    const note = descriptionNotePath(FOLDER, "Alt/see.jpg");
    const v = vault({ "berg.jpg": bytes(7) }, { [note]: noteFor("Alt/see.jpg", bytes(3)) });
    const { run, changed } = repair(v, [note]);

    expect(await run.repair()).toEqual({ repaired: 0, remaining: [note] });
    expect(v.renameFile).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("does not read a picture of another size, or one already described", async () => {
    const see = bytes(3, 64);
    const note = descriptionNotePath(FOLDER, "Alt/see.jpg");
    const v = vault(
      { "gross.jpg": bytes(5, 128), "schon.jpg": bytes(9, 64) },
      { [note]: noteFor("Alt/see.jpg", see) }
    );

    await repair(v, [note], ["schon.jpg"]).run.repair();

    expect(v.reads).toEqual([]);
  });

  it("does nothing, and reads nothing, without orphans", async () => {
    const v = vault({ "a.jpg": bytes(1) }, {});
    expect(await repair(v, []).run.repair()).toEqual({ repaired: 0, remaining: [] });
    expect(v.reads).toEqual([]);
  });

  it("runs once when asked twice at the same time", async () => {
    const see = bytes(3);
    const old = descriptionNotePath(FOLDER, "Alt/see.jpg");
    const v = vault({ "Neu/see.jpg": see }, { [old]: noteFor("Alt/see.jpg", see) });
    const { run } = repair(v, [old]);

    const [a, b] = await Promise.all([run.repair(), run.repair()]);

    expect(a).toBe(b);
    expect(v.reads).toEqual(["Neu/see.jpg"]);
  });
});
