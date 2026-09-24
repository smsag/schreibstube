// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registeredIcons, setIconIds } from "../testing/obsidian-stub";
import { parseBookmarkFile, type Bookmark } from "../services/bookmark-file";
import { installObsidianDom } from "../testing/obsidian-dom";
import { renderBookmarkRows, type BookmarkRowsHost } from "./bookmark-section";

const FILE = [
  "- [Loose](https://example.com)",
  "# Work",
  "- [[Brief]]",
  "## Design",
  "- [Resume](obsidian://pythia?vault=Vault%202.0&cmd=resume&id=1)",
  "# Work",
  "- [Other](https://other.example)"
].join("\n");

function host(overrides: Partial<BookmarkRowsHost> = {}) {
  const pane: BookmarkRowsHost = {
    isFolded: () => false,
    isShown: () => true,
    pluginIconFor: (bookmark) =>
      bookmark.url.startsWith("obsidian://pythia") ? "pythia-logo" : null,
    fold: vi.fn(),
    open: vi.fn(),
    ...overrides
  };
  const body = document.body.createDiv();
  const drawn = renderBookmarkRows(body, parseBookmarkFile(FILE), pane);
  const rows = Array.from(body.querySelectorAll<HTMLElement>(".schreibstube-explorer-row"));
  const names = rows.map(
    (row) => row.querySelector(".schreibstube-explorer-name")?.textContent ?? ""
  );
  return { pane, body, drawn, rows, names };
}

const glyphOf = (row: HTMLElement): HTMLElement =>
  row.querySelector<HTMLElement>(".schreibstube-explorer-glyph")!;

beforeAll(() => installObsidianDom());

beforeEach(() => {
  setIconIds(["library"]);
  registeredIcons.set("pythia-logo", "<svg/>");
});

afterEach(() => {
  document.body.innerHTML = "";
  registeredIcons.clear();
  setIconIds([]);
});

describe("the bookmark rows", () => {
  it("draws loose bookmarks first, then each folder with what is in it", () => {
    const { names, drawn } = host();

    expect(names).toEqual(["Loose", "Work", "Brief", "Design", "Resume", "Work", "Other"]);
    expect(drawn).toBe(7);
  });

  it("indents a row by how deep its folder sits", () => {
    const { rows } = host();
    const depths = rows.map((row) => row.style.getPropertyValue("--schreibstube-depth"));

    // Loose, Work, Brief, Design, Resume, Work, Other.
    expect(depths).toEqual(["0", "0", "1", "1", "2", "0", "1"]);
  });

  it("leaves the rows of a folded folder out, and folds by the folder's own key", () => {
    const { rows, pane } = host({ isFolded: (key) => key === "Work" });

    // The first "Work" is folded; the second, of the same name, is not.
    expect(rows).toHaveLength(4);
    rows[1]?.click();
    rows[2]?.click();
    expect(pane.fold).toHaveBeenNthCalledWith(1, "Work");
    expect(pane.fold).toHaveBeenNthCalledWith(2, "Work\u001e2");
  });

  it("draws no folder the filter left nothing in", () => {
    const { rows } = host({ isShown: (bookmark: Bookmark) => bookmark.name === "Other" });

    expect(rows.map((row) => row.getAttribute("data-bookmark-folder") ?? row.title)).toEqual([
      "Work\u001e2",
      "https://other.example"
    ]);
  });

  it("opens a bookmark on a press", () => {
    const { rows, pane } = host();
    rows[0]?.click();

    expect(pane.open).toHaveBeenCalledWith({
      name: "Loose",
      url: "https://example.com",
      kind: "web"
    });
  });
});

describe("the three icons", () => {
  it("draws a web link with the bundled globe", () => {
    const glyph = glyphOf(host().rows[0]!);

    expect(glyph.querySelector("svg")).toBeNull();
    expect(glyph.textContent?.length).toBeGreaterThan(0);
  });

  it("draws a note with Obsidian's library icon", () => {
    const glyph = glyphOf(host().rows[2]!);

    expect(glyph.querySelector("svg")?.getAttribute("data-icon")).toBe("library");
    expect(glyph.classList.contains("is-obsidian-icon")).toBe(true);
  });

  it("draws a plugin link with the plugin's own icon", () => {
    const glyph = glyphOf(host().rows[4]!);

    expect(glyph.querySelector("svg")?.getAttribute("data-icon")).toBe("pythia-logo");
  });

  it("falls back to the library icon when Obsidian does not know the plugin's", () => {
    registeredIcons.clear();
    const glyph = glyphOf(host().rows[4]!);

    expect(glyph.querySelector("svg")?.getAttribute("data-icon")).toBe("library");
  });

  it("falls back to the bundled icon when Obsidian knows neither", () => {
    registeredIcons.clear();
    setIconIds([]);
    const glyph = glyphOf(host().rows[2]!);

    expect(glyph.querySelector("svg")).toBeNull();
    expect(glyph.textContent?.length).toBeGreaterThan(0);
  });
});
