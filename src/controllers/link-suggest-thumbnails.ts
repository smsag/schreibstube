import { TFile, type App } from "obsidian";

import type { Logger } from "../services/logger";
import { suggestedImage } from "../services/link-suggest-image";
import { installLinkSuggestRowHook } from "../services/workspace-internals";

/**
 * Draws a thumbnail into the rows of Obsidian's link suggestions that stand
 * for a picture, so `![[IMG_20` can be answered by looking.
 *
 * Which rows are pictures is `suggestedImage`'s decision; how to get at
 * Obsidian's list is `installLinkSuggestRowHook`'s. This only draws.
 */
export class LinkSuggestThumbnails {
  private unhook: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly logger: Logger
  ) {}

  start(): void {
    this.unhook ??= installLinkSuggestRowHook(
      this.app.workspace,
      (item, slot) => this.draw(item, slot),
      this.logger
    );
  }

  stop(): void {
    this.unhook?.();
    this.unhook = null;
  }

  private draw(item: unknown, slot: HTMLElement): void {
    const image = suggestedImage(item);
    if (!image) return;

    // Asked of the vault rather than taken from the row: the row is
    // Obsidian's undeclared record, the vault's answer is a file for certain.
    const file = this.app.vault.getAbstractFileByPath(image.path);
    if (!(file instanceof TFile)) return;

    // The name stands beside it, so the picture says nothing a screen reader
    // needs twice.
    const img = slot.createEl("img", {
      cls:
        image.fit === "contain"
          ? ["schreibstube-link-suggest-thumb", "schreibstube-link-suggest-thumb-contain"]
          : "schreibstube-link-suggest-thumb",
      attr: { src: this.app.vault.getResourcePath(file), alt: "" }
    });
    // Lazy, because the list can run to dozens of rows and shows nine.
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    // A file the browser cannot draw leaves the row as it was, not a broken frame.
    img.addEventListener("error", () => img.remove());
  }
}
