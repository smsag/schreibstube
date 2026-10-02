import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { TFile as StubFile } from "../testing/obsidian-stub";
import { createLogger } from "../services/logger";
import { MAX_PASSAGE_NOTE_BYTES } from "../services/passages";
import { PassagesController } from "./passages";

function setup(text: string) {
  const file = new StubFile("Notizen/Vertrag.md") as unknown as TFile;
  file.stat.size = text.length;
  const cachedRead = vi.fn(async () => text);
  const openFile = vi.fn(async () => {});
  const app = {
    vault: { cachedRead },
    workspace: { getLeaf: () => ({ openFile }) }
  } as unknown as App;
  return {
    file,
    cachedRead,
    openFile,
    controller: new PassagesController(
      app,
      createLogger(() => false)
    )
  };
}

describe("PassagesController", () => {
  it("reads a note's passages once per version of the note", async () => {
    const { file, cachedRead, controller } = setup("> [!warning] Frist\n> Ende Mai");
    expect((await controller.passages(file))?.callouts).toHaveLength(1);
    await controller.passages(file);
    expect(cachedRead).toHaveBeenCalledTimes(1);

    file.stat.mtime += 1;
    await controller.passages(file);
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it("reads again after a note was forgotten, and not at all one too large to be a note", async () => {
    const { file, cachedRead, controller } = setup("==x==");
    await controller.passages(file);
    controller.forget(file.path);
    await controller.passages(file);
    expect(cachedRead).toHaveBeenCalledTimes(2);

    file.stat.size = MAX_PASSAGE_NOTE_BYTES + 1;
    expect(await controller.passages(file)).toBeNull();
  });

  it("opens the note at the passage, for reading when the view says so", async () => {
    const { file, openFile, controller } = setup("");
    await controller.open(file, 12, false, true);
    expect(openFile).toHaveBeenLastCalledWith(file, {
      state: { mode: "preview" },
      eState: { line: 12 }
    });
    await controller.open(file, 3, false, false);
    expect(openFile).toHaveBeenLastCalledWith(file, { eState: { line: 3 } });
  });
});
