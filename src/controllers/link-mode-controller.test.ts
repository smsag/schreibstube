// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "../testing/obsidian-stub";
import { installObsidianDom } from "../testing/obsidian-dom";
import { LinkModeController } from "./link-mode-controller";
import { createLogger } from "../services/logger";

beforeAll(() => installObsidianDom());

type OpenLinkText = (link: string, source: string, newLeaf?: unknown) => Promise<void>;

/** One note open in one leaf, a vault holding it and `Ziel.md`, and a split
 *  that makes a leaf of its own when asked. */
function setup() {
  const source = new TFile("Quelle.md");
  const target = new TFile("Ziel.md");
  const view = Object.assign(new MarkdownView(), { file: source });
  const container = document.body.createDiv();
  const sourceLeaf = { view, containerEl: container } as unknown as WorkspaceLeaf;
  const side = { openFile: vi.fn(async () => undefined), view: { containerEl: container } };
  const original = vi.fn<OpenLinkText>(async () => undefined);
  const workspace = {
    openLinkText: original as OpenLinkText,
    getLeavesOfType: () => [sourceLeaf],
    getMostRecentLeaf: () => sourceLeaf,
    iterateAllLeaves: (visit: (leaf: WorkspaceLeaf) => void) => visit(sourceLeaf),
    createLeafBySplit: vi.fn(() => side),
    setActiveLeaf: vi.fn()
  };
  const app = {
    workspace,
    metadataCache: {
      getFirstLinkpathDest: (path: string) => (path === "Ziel" ? target : null)
    }
  } as unknown as App;
  const controller = new LinkModeController(
    app,
    createLogger(() => false)
  );
  controller.start(document.body.createDiv());
  controller.cycleMode();
  return { controller, workspace, original, side, container, target };
}

describe("LinkModeController", () => {
  it("opens a link to another note beside its note", async () => {
    const { workspace, original, side, target } = setup();
    await workspace.openLinkText("Ziel#Lage", "Quelle.md", false);
    expect(side.openFile).toHaveBeenCalledWith(target, { eState: { subpath: "#Lage" } });
    expect(original).not.toHaveBeenCalled();
  });

  it("leaves a tab asked for with a modifier to Obsidian", async () => {
    const { workspace, original, side } = setup();
    await workspace.openLinkText("Ziel", "Quelle.md", "tab");
    expect(original).toHaveBeenCalledWith("Ziel", "Quelle.md", "tab", undefined);
    expect(side.openFile).not.toHaveBeenCalled();
  });

  it("leaves a heading in the same note and a note not yet written to Obsidian", async () => {
    const { workspace, original, side } = setup();
    await workspace.openLinkText("#Lage", "Quelle.md", false);
    await workspace.openLinkText("Neu", "Quelle.md", false);
    expect(original.mock.calls.map(([link]) => link)).toEqual(["#Lage", "Neu"]);
    expect(side.openFile).not.toHaveBeenCalled();
  });

  it("lets a click on a heading in the same note through", async () => {
    const { controller, container } = setup();
    const link = container.createEl("a", { cls: "internal-link" });
    link.dataset.href = "#Lage";
    const click = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    await controller.handleDocumentClick(click);
    expect(click.defaultPrevented).toBe(false);
  });
});
