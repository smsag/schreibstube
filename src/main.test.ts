/**
 * The two side panes, and what happens when the workspace has nowhere to put
 * one.
 *
 * `onload` wires the whole plugin together and is not what these cover. The
 * plugin is constructed and the activation methods are called directly, which
 * is enough to exercise the decision each one makes: reuse an open pane, ask
 * the sidebar for a leaf, or say why nothing appeared.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "./testing/obsidian-stub";
import SchreibstubePlugin from "./main";
import { setLanguage } from "./i18n";

interface FakeLeaf {
  setViewState: (state: { type: string; active: boolean }) => Promise<void>;
  view?: unknown;
}

/**
 * A workspace with as many sidebars as the test says.
 *
 * `getLeftLeaf` and `getRightLeaf` return null on a workspace that has no such
 * sidebar, which is the case these tests are about: Obsidian answers with
 * nothing and the command has to account for it.
 */
function fakeWorkspace({ open = [] as string[], left = true, right = true } = {}) {
  const created: { type: string; leaf: FakeLeaf }[] = [];
  const revealed: unknown[] = [];

  const leafFor = (): FakeLeaf => {
    const leaf: FakeLeaf = {
      setViewState: async (state) => {
        created.push({ type: state.type, leaf });
      }
    };
    return leaf;
  };

  return {
    created,
    revealed,
    workspace: {
      getLeavesOfType: (type: string) =>
        open.filter((entry) => entry === type).map(() => leafFor()),
      getLeftLeaf: () => (left ? leafFor() : null),
      getRightLeaf: () => (right ? leafFor() : null),
      revealLeaf: async (leaf: unknown) => {
        revealed.push(leaf);
      }
    }
  };
}

function pluginWith(app: unknown): SchreibstubePlugin {
  const plugin = new SchreibstubePlugin(app as never, { id: "schreibstube" } as never);
  return plugin;
}

const EXPLORER = "schreibstube-explorer";
const REVIEW = "schreibstube-review";

beforeEach(() => {
  Notice.shown = [];
  setLanguage("en");
});

describe("activateExplorerPane", () => {
  it("puts the pane in the left sidebar and reveals it", async () => {
    const fake = fakeWorkspace();
    await pluginWith(fake).activateExplorerPane();

    expect(fake.created.map((entry) => entry.type)).toEqual([EXPLORER]);
    expect(fake.revealed).toHaveLength(1);
    expect(Notice.shown).toEqual([]);
  });

  it("reuses the pane that is already open rather than opening a second", async () => {
    const fake = fakeWorkspace({ open: [EXPLORER] });
    await pluginWith(fake).activateExplorerPane();

    expect(fake.created).toEqual([]);
    expect(fake.revealed).toHaveLength(1);
  });

  it("says which pane could not be placed when there is no left sidebar", async () => {
    const fake = fakeWorkspace({ left: false });
    await pluginWith(fake).activateExplorerPane();

    expect(fake.created).toEqual([]);
    expect(Notice.shown.join(" ")).toContain("Schreibstube files");
    expect(Notice.shown.join(" ")).toMatch(/no sidebar is available/i);
  });

  it("reports in the language the plugin is set to", async () => {
    setLanguage("de");
    const fake = fakeWorkspace({ left: false });
    await pluginWith(fake).activateExplorerPane();

    expect(Notice.shown.join(" ")).toMatch(/keine Seitenleiste/);
  });
});

describe("activateReviewPanel", () => {
  it("puts the sidebar in the right sidebar and reveals it", async () => {
    const fake = fakeWorkspace();
    await pluginWith(fake).activateReviewPanel();

    expect(fake.created.map((entry) => entry.type)).toEqual([REVIEW]);
    expect(fake.revealed).toHaveLength(1);
    expect(Notice.shown).toEqual([]);
  });

  it("says which pane could not be placed when there is no right sidebar", async () => {
    const fake = fakeWorkspace({ right: false });
    await pluginWith(fake).activateReviewPanel();

    expect(fake.created).toEqual([]);
    expect(Notice.shown.join(" ")).toMatch(/no sidebar is available/i);
    expect(Notice.shown.join(" ")).toContain("proofreading");
  });

  it("does not take the left sidebar when the right one is missing", async () => {
    // The two panes are not interchangeable: the review sidebar belongs on the
    // right, and falling back to the left would move the file pane out of view.
    const fake = fakeWorkspace({ right: false });
    const spy = vi.spyOn(fake.workspace, "getLeftLeaf");
    await pluginWith(fake).activateReviewPanel();

    expect(spy).not.toHaveBeenCalled();
  });
});
