/**
 * Puts a changed drawing into the vault: its pictures beside it, then the
 * note, then the pictures it no longer shows into the trash.
 *
 * In that order so that a write cut short leaves a note pointing at pictures
 * that exist. The note's hash is written last, with the note, so a board left
 * half written is fetched and written again on the next check.
 */
import { FileView, TFile, TFolder, type App } from "obsidian";

import {
  buildDrawingNote,
  decodeBase64,
  drawingImageFolder,
  drawingImagePath,
  retiredImages,
  sameBytes,
  withDrawingEtag,
  type Drawing
} from "../services/drawing-mirror";
import type { Logger } from "../services/logger";

/** The view the Excalidraw plugin opens a drawing in. */
const EXCALIDRAW_VIEW = "excalidraw";

export class DrawingWriter {
  constructor(
    private readonly app: App,
    private readonly logger: Logger
  ) {}

  async write(file: TFile, drawing: Drawing, sourceText: string, etag: string): Promise<void> {
    const folder = drawingImageFolder(file.path);
    const imagePaths = await this.writeImages(folder, drawing);

    // An open drawing merges a file written under it with the scene it holds,
    // by element id, and saves the merge: the Excalidraw plugin gives text
    // elements ids of its own when it loads them, so every text of the old
    // board stayed beside the new one, and the note was saved doubled. The tab
    // is emptied for the write and given the new board after it.
    const open = this.app.workspace
      .getLeavesOfType(EXCALIDRAW_VIEW)
      .filter((leaf) => leaf.view instanceof FileView && leaf.view.file?.path === file.path);
    for (const leaf of open) await leaf.setViewState({ type: "empty" });

    try {
      await this.app.vault.process(file, (noteText) =>
        buildDrawingNote({ noteText, drawing, imagePaths, sourceText, etag, now: new Date() })
      );
    } finally {
      for (const leaf of open) await leaf.openFile(file, { active: false });
    }

    await this.retire(folder, new Set(imagePaths.values()));
  }

  /** The same board answered in full under a new validator: keep the validator. */
  async rememberEtag(file: TFile, etag: string): Promise<void> {
    await this.app.vault.process(file, (noteText) => withDrawingEtag(noteText, etag) ?? noteText);
  }

  private async writeImages(folder: string, drawing: Drawing): Promise<Map<string, string>> {
    const paths = new Map<string, string>();
    if (drawing.images.length === 0) return paths;

    if (this.app.vault.getAbstractFileByPath(folder) === null) {
      await this.app.vault.createFolder(folder);
    }

    // One picture at a time: a board of a hundred screenshots written at once
    // is a hundred writes in one breath for the vault's sync to take up.
    for (const image of drawing.images) {
      const path = drawingImagePath(folder, image);
      const bytes = decodeBase64(image.base64);
      const existing = this.app.vault.getAbstractFileByPath(path);

      if (existing instanceof TFile) {
        if (!sameBytes(await this.app.vault.readBinary(existing), bytes)) {
          await this.app.vault.modifyBinary(existing, bytes.buffer);
        }
      } else {
        await this.app.vault.createBinary(path, bytes.buffer);
      }
      paths.set(image.id, path);
    }
    return paths;
  }

  private async retire(folder: string, kept: ReadonlySet<string>): Promise<void> {
    const parent = this.app.vault.getAbstractFileByPath(folder);
    if (!(parent instanceof TFolder)) return;

    const paths = parent.children.flatMap((child) => (child instanceof TFile ? [child.path] : []));
    for (const path of retiredImages(paths, folder, kept)) {
      const image = this.app.vault.getAbstractFileByPath(path);
      if (!(image instanceof TFile)) continue;
      try {
        await this.app.fileManager.trashFile(image);
      } catch (err) {
        // A picture left behind costs space, not the board.
        this.logger.warn(`Could not move ${path} to the trash:`, err);
      }
    }
  }
}
