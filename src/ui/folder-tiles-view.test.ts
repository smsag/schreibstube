// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { fakeViewApp } from "../testing/fake-item-view";
import { setLanguage } from "../i18n";
import { FolderTilesView, type FolderTilesHost } from "./folder-tiles-view";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ItemView: (await import("../testing/fake-item-view")).FakeItemView
}));

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});

async function open(folder: string) {
  const app = fakeViewApp();
  const leaf = { app, updateHeader: vi.fn() };
  const view = new FolderTilesView(leaf as unknown as WorkspaceLeaf);
  const host: FolderTilesHost = {
    tiles: () => ({ images: [], held: 0 }),
    resourceUrl: () => null,
    open: async () => undefined,
    showMenu: () => undefined,
    onFolderChosen: () => () => undefined
  };
  view.connect(host);
  await view.setState({ folder }, { history: false });
  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  return { app, leaf, view };
}

describe("FolderTilesView, its folder moved", () => {
  it("names the tab after the folder's new name and keeps it for a restart", async () => {
    const { app, leaf, view } = await open("Fotos/2025");
    app.emit("rename", { path: "Bilder" }, "Fotos");
    expect(view.getState().folder).toBe("Bilder/2025");
    expect(app.saves).toBe(1);
    expect(leaf.updateHeader).toHaveBeenCalled();
  });

  it("leaves the tab alone when something else moved", async () => {
    const { app, leaf, view } = await open("Fotos");
    app.emit("rename", { path: "Fotografie.md" }, "Fotos.md");
    expect(view.getState().folder).toBe("Fotos");
    expect(app.saves).toBe(0);
    expect(leaf.updateHeader).not.toHaveBeenCalled();
  });
});
