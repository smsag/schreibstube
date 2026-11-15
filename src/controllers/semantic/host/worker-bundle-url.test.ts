import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";

vi.mock("./embedding-bundle", () => ({ getEmbeddingBundle: () => "the bundle" }));

import { embeddingWorkerUrl } from "./worker-bundle-url";

function plugin(files: Map<string, string>) {
  return {
    app: {
      vault: {
        configDir: ".obsidian",
        adapter: {
          exists: async (p: string) => files.has(p),
          read: async (p: string) => files.get(p) ?? "",
          write: async (p: string, text: string) => void files.set(p, text),
          list: async () => ({ files: [...files.keys()], folders: [] }),
          remove: async (p: string) => void files.delete(p),
          getResourcePath: (p: string) => `app://${p}`
        }
      }
    },
    manifest: { id: "s", dir: ".obsidian/plugins/s", version: "1.0.0" }
  } as unknown as Plugin;
}

describe("the Worker script on disk", () => {
  it("is written again when the file under its name is not the script", async () => {
    const files = new Map<string, string>();
    const p = plugin(files);
    const url = await embeddingWorkerUrl(p);
    const [path] = [...files.keys()];
    const script = files.get(path!)!;
    files.set(path!, script.slice(0, 5)); // cut short by a sync, say
    expect(await embeddingWorkerUrl(p)).toBe(url);
    expect(files.get(path!)).toBe(script);
  });
});
