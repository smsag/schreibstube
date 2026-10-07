import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { MarkdownView, TFile } from "../testing/obsidian-stub";
import { sectionKey } from "../services/semantic/passage-focus";
import { RecommendPlaces } from "./recommend-place";

const TEXT = ["# Plan", "intro", "## Kitchen", "tiles", "## Garden", "beds"].join("\n");

function view(path: string, mode: "source" | "preview", line: number, text = TEXT): MarkdownView {
  return Object.assign(new MarkdownView(), {
    file: new TFile(path),
    getMode: () => mode,
    getViewData: () => text,
    editor: { getValue: () => text, getCursor: () => ({ line, ch: 0 }) }
  });
}

function places(
  active: MarkdownView | null,
  others: MarkdownView[] = [],
  disk = "on disk",
  recent: MarkdownView | null = active
) {
  const app = {
    workspace: {
      getActiveViewOfType: () => active,
      getMostRecentLeaf: () => (recent ? { view: recent } : null),
      getLeavesOfType: () => [active, ...others].filter(Boolean).map((v) => ({ view: v }))
    },
    vault: {
      getAbstractFileByPath: (path: string) => (path.endsWith(".md") ? new TFile(path) : null),
      cachedRead: async (file: TFile) => {
        if (file.path === "broken.md") throw new Error("unreadable");
        return disk;
      }
    }
  } as unknown as App;
  return new RecommendPlaces(app);
}

describe("RecommendPlaces", () => {
  it("follows the cursor of the note being edited in front", async () => {
    const at = places(view("a.md", "source", 3));
    expect(at.key("a.md", "cursor")).toBe(`section:${sectionKey(TEXT, 3)}`);
    expect(await at.focus("a.md", "cursor")).toEqual({
      markdown: TEXT,
      at: 3,
      fallback: "opening"
    });
  });

  it("keeps following the last note pane while the sidebar has the focus", () => {
    const at = places(null, [], "on disk", view("a.md", "source", 3));
    expect(at.key("a.md", "cursor")).toBe(`section:${sectionKey(TEXT, 3)}`);
  });

  it("ranks from the opening in Reading view, or for a note not in front", async () => {
    for (const at of [
      places(view("a.md", "preview", 3)),
      places(view("b.md", "source", 3)),
      places(null)
    ]) {
      expect(at.key("a.md", "cursor")).toBe("opening");
      expect(await at.focus("a.md", "cursor")).toBeUndefined();
    }
    expect(await places(null).focus("a.md", undefined)).toBeUndefined();
  });

  it("ranks the footer from the end, with the text on screen, in any view showing the note", async () => {
    const shown = places(view("b.md", "source", 0), [view("a.md", "preview", 0, "shown text")]);
    expect(shown.key("a.md", "end")).toBe("end");
    expect(await shown.focus("a.md", "end")).toEqual({
      markdown: "shown text",
      at: "end",
      fallback: "end"
    });
  });

  it("reads the footer's note from the vault when no view shows it, and copes when it cannot", async () => {
    expect((await places(null).focus("a.md", "end"))?.markdown).toBe("on disk");
    expect((await places(null).focus("broken.md", "end"))?.markdown).toBe("");
    expect((await places(null).focus("folder", "end"))?.markdown).toBe("");
  });
});
