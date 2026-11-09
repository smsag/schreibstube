// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../testing/obsidian-dom";
import { setLanguage } from "../i18n";
import { RecentPanel, type RecentHost } from "./recent-panel";

beforeAll(() => installObsidianDom());
beforeEach(() => setLanguage("en"));

function setup(lastOpen: unknown, gone: string[] = []) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let list = lastOpen;
  const host: RecentHost = {
    lastOpened: () => list,
    titleOf: (path) =>
      gone.includes(path) ? null : path.replace(/^.*\//, "").replace(/\.md$/, ""),
    folderOf: (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""),
    glyphOf: () => "file-text",
    open: vi.fn(async () => undefined),
    showMenu: vi.fn()
  };
  const panel = new RecentPanel(root, host);
  return { root, host, panel, setList: (next: unknown) => (list = next) };
}

const titles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll(".schreibstube-related-card-title")).map((el) => el.textContent);
const more = (root: HTMLElement) => root.querySelector<HTMLElement>(".schreibstube-recent-more");
const press = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

const FIVE = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"];

describe("RecentPanel", () => {
  it("lists the files opened before, not the note it is under, three at first", () => {
    const { root, panel } = setup(FIVE);
    panel.show("a.md");
    expect(titles(root)).toEqual(["b", "c", "d"]);
    expect(more(root)?.textContent).toBe("Show 2 more");
    expect(root.querySelector(".schreibstube-related-section-count")?.textContent).toBe("5");
  });

  it("shows the rest on request, and three again on the next press", () => {
    const { root, panel } = setup(FIVE);
    panel.show("a.md");
    press(more(root));
    expect(titles(root)).toEqual(["b", "c", "d", "e", "f"]);
    expect(more(root)?.textContent).toBe("Show three again");
    press(more(root));
    expect(titles(root)).toEqual(["b", "c", "d"]);
  });

  it("opens with three again for another note", () => {
    const { root, panel } = setup(FIVE);
    panel.show("a.md");
    press(more(root));
    panel.show("b.md");
    expect(titles(root)).toEqual(["a", "c", "d"]);
  });

  it("offers no more row when three or fewer are left", () => {
    const { root, panel } = setup(["a.md", "b.md", "c.md", "d.md"]);
    panel.show("a.md");
    expect(titles(root)).toEqual(["b", "c", "d"]);
    expect(more(root)).toBeNull();
  });

  it("leaves out what is gone and names the folder", () => {
    const { root, panel } = setup(["Drafts/one.md", "gone.md", "two.md"], ["gone.md"]);
    panel.show(null);
    expect(titles(root)).toEqual(["one", "two"]);
    const folders = Array.from(root.querySelectorAll(".schreibstube-related-card-folder")).map(
      (el) => el.textContent
    );
    expect(folders).toEqual(["Drafts", "Vault root"]);
  });

  it("draws nothing at all when nothing was opened before", () => {
    const { root, panel } = setup(["a.md"]);
    panel.show("a.md");
    expect(root.children).toHaveLength(0);
    expect(root.hasClass("is-empty")).toBe(true);
  });

  it("folds away under its heading", () => {
    const { root, panel } = setup(FIVE);
    panel.show("a.md");
    press(root.querySelector(".schreibstube-related-section"));
    expect(titles(root)).toEqual([]);
    expect(root.querySelector(".schreibstube-related-section")?.getAttribute("aria-expanded")).toBe(
      "false"
    );
  });

  it("opens an entry in place, or where the modifier says", () => {
    const { root, host, panel } = setup(FIVE);
    panel.show("a.md");
    press(root.querySelector('[data-key="file:b.md"]'));
    expect(host.open).toHaveBeenCalledWith("b.md", false);
    root
      .querySelector('[data-key="file:c.md"]')
      ?.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(host.open).toHaveBeenCalledWith("c.md", "tab");
  });

  it("hands a right click to the file menu", () => {
    const { root, host, panel } = setup(FIVE);
    panel.show("a.md");
    root
      .querySelector('[data-key="file:b.md"]')
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(host.showMenu).toHaveBeenCalledWith("b.md", expect.any(MouseEvent));
  });

  it("follows the list when another file is opened, and redraws nothing when it did not move", () => {
    const { root, panel, setList } = setup(FIVE);
    panel.show("a.md");
    const first = root.querySelector(".schreibstube-related-list");
    panel.refresh();
    expect(root.querySelector(".schreibstube-related-list")).toBe(first);
    setList(["z.md", ...FIVE]);
    panel.refresh();
    expect(titles(root)).toEqual(["z", "b", "c"]);
  });
});
