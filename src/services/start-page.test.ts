import { describe, expect, it } from "vitest";
import { HOME_LANGUAGE, parseHomeBlock } from "./home-block";
import {
  EMPTY_VIEW_TYPE,
  MAX_START_PAGE_PATH,
  normalizeStartPagePath,
  opensStartPage,
  startPageViewState,
  starterNote,
  starterPath,
  type TabSnapshot
} from "./start-page";

describe("normalizeStartPagePath", () => {
  it("keeps a vault path, without its outer slashes and spaces", () => {
    expect(normalizeStartPagePath("Startseite.md")).toBe("Startseite.md");
    expect(normalizeStartPagePath(" /Home/Start.md/ ")).toBe("Home/Start.md");
  });

  it("is off for anything that is no usable path", () => {
    expect(normalizeStartPagePath(undefined)).toBe("");
    expect(normalizeStartPagePath(42)).toBe("");
    expect(normalizeStartPagePath("")).toBe("");
    expect(normalizeStartPagePath(".obsidian/workspace.json")).toBe("");
    expect(normalizeStartPagePath("a\\b.md")).toBe("");
    expect(normalizeStartPagePath("a\nb.md")).toBe("");
    expect(normalizeStartPagePath("a//b.md")).toBe("");
    expect(normalizeStartPagePath(`${"a".repeat(MAX_START_PAGE_PATH)}.md`)).toBe("");
  });
});

describe("opensStartPage", () => {
  const empty: TabSnapshot = {
    path: "Start.md",
    exists: true,
    viewType: EMPTY_VIEW_TYPE,
    deferred: false,
    inMainArea: true,
    failedBefore: false
  };

  it("turns an empty tab in the main area into the start page", () => {
    expect(opensStartPage(empty)).toBe(true);
  });

  it("leaves the tab alone when there is no start page to open", () => {
    expect(opensStartPage({ ...empty, path: "" })).toBe(false);
    expect(opensStartPage({ ...empty, exists: false })).toBe(false);
  });

  it("leaves a tab that shows something, or sits in a sidebar", () => {
    expect(opensStartPage({ ...empty, viewType: "markdown" })).toBe(false);
    expect(opensStartPage({ ...empty, viewType: null })).toBe(false);
    expect(opensStartPage({ ...empty, inMainArea: false })).toBe(false);
  });

  it("leaves a tab restored at launch that has not loaded yet", () => {
    expect(opensStartPage({ ...empty, deferred: true })).toBe(false);
  });

  it("tries a tab once: a failed open is not repeated on every event", () => {
    expect(opensStartPage({ ...empty, failedBefore: true })).toBe(false);
  });
});

describe("startPageViewState", () => {
  it("opens a note in Reading view and anything else as it opens", () => {
    expect(startPageViewState("md")).toEqual({ state: { mode: "preview" } });
    expect(startPageViewState("MD")).toEqual({ state: { mode: "preview" } });
    expect(startPageViewState("base")).toBeNull();
    expect(startPageViewState("canvas")).toBeNull();
  });
});

describe("starterNote", () => {
  it("writes a block that names every section, and the hint as a hidden comment", () => {
    const note = starterNote({ hint: "Embed a base here." });
    const block = /```schreibstube-home\n([\s\S]*?)```/.exec(note)?.[1] ?? "";
    expect(note.startsWith("```" + HOME_LANGUAGE)).toBe(true);
    expect(parseHomeBlock(block).sections.map((section) => section.kind)).toEqual([
      "actions",
      "bookmarks",
      "updated",
      "due"
    ]);
    expect(note).toContain("%% Embed a base here. %%");
  });

  it("cannot close the comment early from the hint", () => {
    expect(starterNote({ hint: "a %% b" })).toContain("%% a  b %%");
  });
});

describe("starterPath", () => {
  it("adds .md to a path that names no extension", () => {
    expect(starterPath("Start")).toBe("Start.md");
    expect(starterPath("Home/v1.2/Start")).toBe("Home/v1.2/Start.md");
  });

  it("keeps a path that names one", () => {
    expect(starterPath("Home/Start.md")).toBe("Home/Start.md");
    expect(starterPath("Start.base")).toBe("Start.base");
  });
});
