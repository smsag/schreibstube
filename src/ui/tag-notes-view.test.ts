// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { fakeViewApp } from "../testing/fake-item-view";
import { setLanguage } from "../i18n";
import type { TagCard } from "../services/tag-pins";
import { TagNotesView } from "./tag-notes-view";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ItemView: (await import("../testing/fake-item-view")).FakeItemView
}));

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});

const card = (path: string, open: number): TagCard => ({
  path,
  title: path.replace(/\.md$/, ""),
  folder: "",
  tally: { open, total: 3 },
  modifiedAt: 1
});

async function open(cards: () => TagCard[]) {
  const app = fakeViewApp();
  const view = new TagNotesView({ app } as unknown as WorkspaceLeaf);
  view.connect({ cards, open: async () => undefined, showMenu: () => undefined });
  await view.setState({ tag: "projekt" }, { history: false });
  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  const first = () => view.contentEl.querySelector(".schreibstube-tag-card");
  return { app, view, first };
}

describe("TagNotesView", () => {
  it("leaves the list as it is when a save elsewhere changed none of its cards", async () => {
    const { app, view, first } = await open(() => [card("a.md", 2), card("b.md", 1)]);
    const drawn = first();
    view.contentEl.scrollTop = 40;
    app.emit("changed", { path: "elsewhere.md" });
    await Promise.resolve();
    expect(first()).toBe(drawn);
    expect(view.contentEl.scrollTop).toBe(40);
  });

  it("draws a card again when what it says changed", async () => {
    let open_ = 2;
    const { app, first } = await open(() => [card("a.md", open_)]);
    const drawn = first();
    open_ = 1;
    app.emit("changed", { path: "a.md" });
    await Promise.resolve();
    expect(first()).not.toBe(drawn);
  });
});
