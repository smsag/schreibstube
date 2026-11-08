/**
 * An empty tab becomes the start page.
 *
 * Obsidian has no hook for the empty tab, but it says when the layout or the
 * current tab changes, and the view an empty tab shows has a type of its own.
 * So after each such event the current tab is looked at once, and
 * `services/start-page` decides whether it turns into the configured file.
 * Opening a file in an empty tab leaves nothing in its history — the empty
 * view is not one Obsidian navigates back to — so Back never lands on an
 * empty tab that would turn into the page again.
 */
import { Notice, TFile, type App, type EventRef, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import { folderOfPath, missingAncestors } from "../services/ensure-folder";
import {
  opensStartPage,
  START_PAGE_SETTLE_MS,
  startPageViewState,
  starterNote,
  starterPath
} from "../services/start-page";
import type { SchreibstubeSettings } from "../types";

/** What the controller needs of the plugin to stay registered for its lifetime. */
export interface StartPageLifetime {
  registerEvent(ref: EventRef): void;
  register(cleanup: () => void): void;
}

export class StartPageController {
  /** Tabs the start page could not open in; left as Obsidian drew them. */
  private readonly failed = new WeakSet<WorkspaceLeaf>();
  /** Tabs the start page is opening in right now, which the events it sets off must not open again. */
  private readonly opening = new WeakSet<WorkspaceLeaf>();
  /** The look waiting for the events of one change to settle. */
  private timer: number | null = null;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {}

  start(lifetime: StartPageLifetime): void {
    const workspace = this.app.workspace;
    // A tab closed, a tab opened, the last tab gone: each is one of these,
    // and most changes are several at once.
    lifetime.registerEvent(workspace.on("active-leaf-change", () => this.lookSoon()));
    lifetime.registerEvent(workspace.on("layout-change", () => this.lookSoon()));
    lifetime.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = null;
    });
    // At launch with nothing open, the first tab is an empty one.
    workspace.onLayoutReady(() => this.lookSoon());
  }

  /** The file the settings name, when it is one in the vault. */
  file(): TFile | null {
    const path = this.getSettings().startPageFile;
    if (path === "") return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  /** Open the start page in the current tab, as the command does. */
  async open(): Promise<void> {
    const file = this.file();
    if (!file) {
      const path = this.getSettings().startPageFile;
      if (path !== "") new Notice(t().common.notice(t().startPage.openFailed(path)));
      return;
    }
    await this.openIn(this.app.workspace.getLeaf(false), file);
  }

  /**
   * Write the starter note where the settings point, with any folder it
   * needs, and say where it went: the path as typed, or with `.md` added.
   * Null when the vault refused, which the caller says out loud.
   */
  async create(): Promise<string | null> {
    const configured = this.getSettings().startPageFile;
    if (configured === "") return null;
    const path = starterPath(configured);
    try {
      const exists = (folder: string) => this.app.vault.getAbstractFileByPath(folder) !== null;
      for (const folder of missingAncestors(folderOfPath(path), exists)) {
        await this.app.vault.createFolder(folder);
      }
      await this.app.vault.create(path, starterNote({ hint: t().startPage.starterHint }));
      return path;
    } catch (error) {
      this.logger.warn(`Could not create the start page ${path}:`, error);
      new Notice(t().common.notice(t().startPage.createFailed(path)));
      return null;
    }
  }

  /**
   * Looked at once the events of one change have stopped coming. Each event
   * starts the wait again: a link opened into a new tab shows an empty view
   * for a moment before its note loads, and the events of that load keep
   * pushing the look past it, so the tab is seen with its note in it.
   */
  private lookSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.look();
    }, START_PAGE_SETTLE_MS);
  }

  async look(): Promise<void> {
    const workspace = this.app.workspace;
    const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!leaf || this.opening.has(leaf)) return;

    const path = this.getSettings().startPageFile;
    const file = this.file();
    const root = leaf.getRoot();
    if (
      !opensStartPage({
        path,
        exists: file !== null,
        // The state, not the view: a tab restored at launch keeps a stand-in
        // view until it is shown, and its state says what it really holds.
        viewType: leaf.getViewState().type,
        deferred: leaf.isDeferred,
        inMainArea: root !== workspace.leftSplit && root !== workspace.rightSplit,
        failedBefore: this.failed.has(leaf)
      }) ||
      !file
    ) {
      return;
    }

    await this.openIn(leaf, file);
  }

  private async openIn(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    this.opening.add(leaf);
    try {
      const state = startPageViewState(file.extension);
      if (state) await leaf.openFile(file, state);
      else await leaf.openFile(file);
    } catch (error) {
      this.failed.add(leaf);
      this.logger.warn(`Could not open the start page ${file.path}:`, error);
      new Notice(t().common.notice(t().startPage.openFailed(file.path)));
    } finally {
      this.opening.delete(leaf);
    }
  }
}
