/**
 * Puts a changed drawing into the vault: its pictures beside it, then the
 * note, then the pictures it no longer shows into the trash.
 *
 * In that order so that a write cut short leaves a note pointing at pictures
 * that exist. The note's hash is written last, with the note, so a board left
 * half written is fetched and written again on the next check.
 */
import { FileView, TFile, TFolder, type App, type WorkspaceLeaf } from "obsidian";

import { t } from "../i18n";
import {
  buildDrawingNote,
  decodeBase64,
  drawingImageFolder,
  drawingImagePath,
  isMirroredNote,
  listedImageLinks,
  retiredImages,
  sameBytes,
  withDrawingEtag,
  type Drawing
} from "../services/drawing-mirror";
import type { Logger } from "../services/logger";

/** The view the Excalidraw plugin opens a drawing in. */
const EXCALIDRAW_VIEW = "excalidraw";

export interface DrawingWrite {
  drawing: Drawing;
  sourceHash: string;
  etag: string;
  /** Whether the source moved, as against a board written again on request. */
  changed: boolean;
}

/**
 * Write a drawing note with no Excalidraw tab holding it.
 *
 * An open drawing merges a file written under it with the scene it holds,
 * by element id, and saves the merge: the Excalidraw plugin gives text
 * elements ids of its own when it loads them, so every text of the old board
 * stayed beside the new one, and the note was saved doubled. That holds for
 * any write to the note, a property as much as a board, so every write goes
 * through here: the tabs are emptied first and given the note back after.
 */
export async function processDrawingNote(
  app: App,
  file: TFile,
  apply: (text: string) => string
): Promise<void> {
  const open = app.workspace
    .getLeavesOfType(EXCALIDRAW_VIEW)
    .filter((leaf) => leaf.view instanceof FileView && leaf.view.file?.path === file.path);
  const emptied: WorkspaceLeaf[] = [];

  try {
    for (const leaf of open) {
      await leaf.setViewState({ type: "empty" });
      emptied.push(leaf);
    }
    await app.vault.process(file, apply);
  } finally {
    for (const leaf of emptied) await leaf.openFile(file, { active: false });
  }
}

export class DrawingWriter {
  constructor(
    private readonly app: App,
    private readonly logger: Logger
  ) {}

  async write(file: TFile, update: DrawingWrite): Promise<void> {
    // Only what this mirror wrote before is its own to replace or give up:
    // the pictures the note listed the last time the mirror wrote it, found
    // wherever they are now, in a folder since renamed or beside a note since
    // moved.
    const before = await this.app.vault.read(file);
    const owned = isMirroredNote(before) ? this.resolve(listedImageLinks(before), file) : [];

    const folder = drawingImageFolder(file.path);
    const imagePaths = await this.writeImages(folder, update.drawing, new Set(owned));

    await processDrawingNote(this.app, file, (noteText) =>
      buildDrawingNote({ noteText, imagePaths, now: new Date(), ...update })
    );

    await this.retire(retiredImages(owned, new Set(imagePaths.values())));
  }

  /** The same board answered in full under a new validator: keep the validator. */
  async rememberEtag(file: TFile, etag: string): Promise<void> {
    if (withDrawingEtag(await this.app.vault.read(file), etag) === null) return;
    await processDrawingNote(
      this.app,
      file,
      (noteText) => withDrawingEtag(noteText, etag) ?? noteText
    );
  }

  private resolve(links: readonly string[], file: TFile): string[] {
    return links.flatMap((link) => {
      const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
      return target instanceof TFile ? [target.path] : [];
    });
  }

  private async writeImages(
    folder: string,
    drawing: Drawing,
    owned: ReadonlySet<string>
  ): Promise<Map<string, string>> {
    const planned = drawing.images.map((image) => ({
      id: image.id,
      path: drawingImagePath(folder, image),
      bytes: decodeBase64(image.base64)
    }));

    // Every place is looked at before anything is written, so a file in the
    // way stops the update before a single picture has changed.
    const writes: { path: string; bytes: Uint8Array<ArrayBuffer>; file: TFile | null }[] = [];
    for (const { path, bytes } of planned) {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing === null) {
        writes.push({ path, bytes, file: null });
        continue;
      }
      if (!(existing instanceof TFile)) throw new Error(t().source.drawingPathTaken(path));
      // Content-addressed ids keep a picture the same size until it changes,
      // so most of a board is settled by its size without being read.
      if (
        existing.stat.size === bytes.byteLength &&
        sameBytes(await this.app.vault.readBinary(existing), bytes)
      ) {
        continue;
      }
      if (!owned.has(path)) throw new Error(t().source.drawingPathTaken(path));
      writes.push({ path, bytes, file: existing });
    }

    if (
      writes.some((write) => write.file === null) &&
      this.app.vault.getAbstractFileByPath(folder) === null
    ) {
      await this.app.vault.createFolder(folder);
    }

    // One picture at a time: a board of a hundred screenshots written at once
    // is a hundred writes in one breath for the vault's sync to take up.
    for (const { path, bytes, file } of writes) {
      if (file) await this.app.vault.modifyBinary(file, bytes.buffer);
      else await this.app.vault.createBinary(path, bytes.buffer);
    }

    return new Map(planned.map(({ id, path }) => [id, path]));
  }

  private async retire(paths: readonly string[]): Promise<void> {
    const folders = new Set<TFolder>();
    for (const path of paths) {
      const image = this.app.vault.getAbstractFileByPath(path);
      if (!(image instanceof TFile)) continue;
      if (image.parent) folders.add(image.parent);
      await this.trash(image);
    }

    // A folder the board's pictures have all left — the old one, after the
    // drawing was renamed — goes with them; one holding anything else stays.
    for (const folder of folders) {
      if (folder.children.length === 0) await this.trash(folder);
    }
  }

  private async trash(file: TFile | TFolder): Promise<void> {
    try {
      await this.app.fileManager.trashFile(file);
    } catch (err) {
      // A picture left behind costs space, not the board.
      this.logger.warn(`Could not move ${file.path} to the trash:`, err);
    }
  }
}
