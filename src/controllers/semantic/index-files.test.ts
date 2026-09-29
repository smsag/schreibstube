// The index file on disk: written beside itself and renamed over, so a write
// cut short never leaves a torn file where a whole one was.
import { describe, expect, it } from "vitest";
import type { Plugin } from "obsidian";
import { SemanticIndexFiles, removeRetiredIndexFiles } from "./index-files";

function fakeAdapter(existing: string[] = []) {
  const disk = new Map<string, ArrayBuffer>(existing.map((p) => [p, new ArrayBuffer(1)]));
  const ops: string[] = [];
  const adapter = {
    exists: async (p: string) => disk.has(p) || p === ".obsidian/plugins/schreibstube",
    readBinary: async (p: string) => disk.get(p) ?? new ArrayBuffer(0),
    writeBinary: async (p: string, b: ArrayBuffer) => {
      ops.push(`write ${p}`);
      disk.set(p, b);
    },
    rename: async (from: string, to: string) => {
      ops.push(`rename ${from} -> ${to}`);
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    },
    remove: async (p: string) => {
      ops.push(`remove ${p}`);
      disk.delete(p);
    },
    mkdir: async () => undefined,
    list: async (dir: string) => ({
      files: [...disk.keys()].filter((p) => p.startsWith(`${dir}/`)),
      folders: []
    }),
    stat: async (p: string) => (disk.has(p) ? { size: disk.get(p)!.byteLength, mtime: 1 } : null)
  };
  const plugin = {
    app: { vault: { configDir: ".obsidian", adapter } },
    manifest: { id: "schreibstube", dir: ".obsidian/plugins/schreibstube" }
  } as unknown as Plugin;
  return { disk, ops, plugin };
}

const PATH =
  ".obsidian/plugins/schreibstube/semantic-notes-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin";

describe("SemanticIndexFiles", () => {
  it("writes beside the file and renames over it", async () => {
    const { disk, ops, plugin } = fakeAdapter([PATH]);
    const files = new SemanticIndexFiles(plugin, "xenova-paraphrase-multilingual-MiniLM-L12-v2");
    await files.write(new ArrayBuffer(8));
    expect(ops).toEqual([`write ${PATH}.tmp`, `rename ${PATH}.tmp -> ${PATH}`]);
    expect(disk.get(PATH)?.byteLength).toBe(8);
    expect(disk.has(`${PATH}.tmp`)).toBe(false);
    expect(await files.size()).toBe(8);
  });

  it("removes a stale temporary file from a write that was cut short", async () => {
    const { ops, plugin } = fakeAdapter([`${PATH}.tmp`]);
    const files = new SemanticIndexFiles(plugin, "xenova-paraphrase-multilingual-MiniLM-L12-v2");
    await files.write(new ArrayBuffer(8));
    expect(ops[0]).toBe(`remove ${PATH}.tmp`);
    expect(await files.read()).not.toBeNull();
  });

  it("keeps the journals under the family's name, beside the index", async () => {
    const { plugin } = fakeAdapter();
    const files = new SemanticIndexFiles(
      plugin,
      "xenova-paraphrase-multilingual-MiniLM-L12-v2-latin"
    );
    await files.journal().write(new ArrayBuffer(2));
    await files.phoneJournal().write(new ArrayBuffer(3));
    expect(await files.journal().size()).toBe(2);
    expect(await files.phoneJournal().size()).toBe(3);
    expect(await files.exists()).toBe(false);
  });
});

describe("the index API version 1 kept", () => {
  it("is removed, and nothing else in the folder is", async () => {
    const dir = ".obsidian/plugins/schreibstube";
    const { disk, plugin } = fakeAdapter([
      `${dir}/semantic-conversations-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin`,
      `${dir}/semantic-source-pythia-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin`,
      PATH,
      `${dir}/data.json`
    ]);
    await removeRetiredIndexFiles(plugin);
    expect([...disk.keys()].sort()).toEqual(
      [
        `${dir}/data.json`,
        PATH,
        `${dir}/semantic-source-pythia-xenova-paraphrase-multilingual-MiniLM-L12-v2.bin`
      ].sort()
    );
  });
});
