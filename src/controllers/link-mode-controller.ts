import { MarkdownView, type App, type WorkspaceLeaf } from "obsidian";
import type { Logger } from "../services/logger";
import {
  createLeafBySplit,
  installOpenLinkTextPatch,
  leafContainerContains
} from "../services/workspace-internals";

export type LinkOpenMode = "default" | "left" | "right";

/**
 * Owns the "open links in a side pane" feature: the current mode, its status
 * bar indicator, the `openLinkText` patch, and click interception. Extracted
 * from the plugin so the fragile Obsidian-internal interactions live behind one
 * small, cohesive surface (see workspace-internals for the guarded casts).
 */
export class LinkModeController {
  private mode: LinkOpenMode = "default";
  private targetLeaf: WorkspaceLeaf | null = null;
  private statusEl: HTMLElement | null = null;
  private unpatch: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly logger: Logger
  ) {}

  /** Install the status bar indicator and patch `openLinkText`. */
  start(statusEl: HTMLElement): void {
    this.statusEl = statusEl;
    this.updateStatus();
    this.unpatch = installOpenLinkTextPatch(
      this.app.workspace,
      (original) => async (linkText, sourcePath, newLeaf, openViewState) => {
        if (this.mode === "default") {
          return original(linkText, sourcePath, newLeaf, openViewState);
        }
        const sourceLeaf = this.findSourceLeafByPath(sourcePath);
        if (sourceLeaf) {
          await this.openInSidePane(linkText, sourceLeaf);
        }
      },
      this.logger
    );
  }

  stop(): void {
    this.unpatch?.();
    this.unpatch = null;
  }

  setMode(mode: LinkOpenMode): void {
    this.mode = mode;
    this.targetLeaf = null;
    this.updateStatus();
    this.logger.debug("Link-open mode set to", mode);
  }

  /** Handle a document-level click; intercepts internal links when a side-pane
   *  mode is active. */
  async handleDocumentClick(event: MouseEvent): Promise<void> {
    if (this.mode === "default") {
      return;
    }

    const target = event.target as HTMLElement;
    const linkEl = target.closest("a.internal-link") as HTMLAnchorElement | null;
    if (!linkEl) {
      return;
    }

    const href = linkEl.dataset.href ?? linkEl.getAttribute("href") ?? "";
    if (!href || /^https?:\/\//.test(href)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const sourceLeaf = this.findLeafContainingNode(target);
    if (!sourceLeaf) {
      return;
    }

    await this.openInSidePane(href, sourceLeaf);
  }

  private findSourceLeafByPath(sourcePath: string): WorkspaceLeaf | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if ((leaf.view as MarkdownView).file?.path === sourcePath) {
        return leaf;
      }
    }
    return this.app.workspace.getMostRecentLeaf();
  }

  private findLeafContainingNode(node: Node): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leafContainerContains(leaf, node)) {
        found = leaf;
      }
    });
    return found;
  }

  private async openInSidePane(linkText: string, sourceLeaf: WorkspaceLeaf): Promise<void> {
    const sourcePath =
      sourceLeaf.view instanceof MarkdownView ? (sourceLeaf.view.file?.path ?? "") : "";

    // Separate the file path from any heading/block subpath.
    const subpathMatch = linkText.match(/^([^#^]*)([#^].*)?$/);
    const linkPath = subpathMatch?.[1] ?? linkText;
    const subpath = subpathMatch?.[2] ?? "";

    const file = this.app.metadataCache.getFirstLinkpathDest(linkPath || linkText, sourcePath);
    if (!file) {
      this.logger.debug("No link target resolved for", linkText);
      return;
    }

    // Reuse the existing side pane if still open, otherwise create one.
    if (this.targetLeaf && !this.targetLeaf.view.containerEl.isConnected) {
      this.targetLeaf = null;
    }
    if (!this.targetLeaf) {
      this.targetLeaf = createLeafBySplit(
        this.app.workspace,
        sourceLeaf,
        "vertical",
        this.mode === "left",
        this.logger
      );
    }
    if (!this.targetLeaf) {
      return;
    }

    await this.targetLeaf.openFile(file, subpath ? { eState: { subpath } } : undefined);

    // Return focus to the note the user was reading.
    this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
  }

  private updateStatus(): void {
    if (!this.statusEl) {
      return;
    }
    if (this.mode === "default") {
      this.statusEl.style.display = "none";
      this.statusEl.setText("");
    } else {
      this.statusEl.style.display = "";
      this.statusEl.setText(this.mode === "left" ? "← links" : "links →");
    }
  }
}
