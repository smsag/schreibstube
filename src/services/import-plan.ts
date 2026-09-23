/**
 * What becomes of files dragged in from outside the vault.
 *
 * A drop from the desktop is a list of names and sizes, and a folder to put
 * them in. Before a byte is read, every one of them is decided here: the
 * path it will take, or the reason it will not be taken at all. The reasons
 * are the same ones the rest of the pane already applies — a name the vault
 * refuses, a size no phone should be handed — plus one of the drop's own:
 * a folder dropped from the desktop arrives as a name with nothing behind
 * it, and is refused rather than written as an empty file called "Photos".
 *
 * Nothing here reads a file or touches the vault. The view hands in what it
 * was given and the controller writes what comes back, so the deciding is a
 * test and the two halves that talk to the platform stay thin.
 */

import { checkFileName } from "./file-name";
import { joinVaultPath, nextFreeName } from "./new-note";

/**
 * The most one dropped file may weigh.
 *
 * Reading a file into memory to write it is what `createBinary` needs, and a
 * two-gigabyte video read into a phone's memory is a crash rather than an
 * import. Generous enough for a scanned document or a long recording.
 */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/**
 * How many files one drop may bring.
 *
 * A folder's worth of photos selected by accident is the usual way a drop is
 * larger than meant, and fifty writes is already a long moment; past that
 * the answer is a sync client, not a drag.
 */
export const MAX_IMPORT_FILES = 50;

export interface DroppedFile {
  name: string;
  size: number;
  /** A folder from the desktop: it has a name and no bytes to read. */
  isFolder?: boolean;
}

export type ImportRefusal = "folder" | "too-large" | "bad-name" | "too-many";

export interface ImportPlan {
  imports: { name: string; path: string }[];
  refused: { name: string; reason: ImportRefusal }[];
}

/** The name split where the vault splits it: `archive.tar.gz` keeps `.gz`. */
function splitName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/**
 * Where each dropped file goes, or why it does not.
 *
 * A name already taken is not refused: it is given the next free one, `Scan
 * 1.pdf` beside `Scan.pdf`, the way a new note is named. Two files of the
 * same name in one drop are handled the same way, against each other.
 */
export function planImport(
  files: readonly DroppedFile[],
  folder: string,
  taken: ReadonlySet<string>
): ImportPlan {
  const plan: ImportPlan = { imports: [], refused: [] };
  const claimed = new Set<string>();

  for (const [index, file] of files.entries()) {
    if (index >= MAX_IMPORT_FILES) {
      plan.refused.push({ name: file.name, reason: "too-many" });
      continue;
    }
    if (file.isFolder) {
      plan.refused.push({ name: file.name, reason: "folder" });
      continue;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      plan.refused.push({ name: file.name, reason: "too-large" });
      continue;
    }

    const { stem, extension } = splitName(file.name.trim());
    const checked = checkFileName(stem);
    if (!checked.ok) {
      plan.refused.push({ name: file.name, reason: "bad-name" });
      continue;
    }

    const free = nextFreeName(checked.name, (candidate) => {
      const path = joinVaultPath(folder, `${candidate}${extension}`);
      return taken.has(path) || claimed.has(path);
    });
    const path = joinVaultPath(folder, `${free}${extension}`);
    claimed.add(path);
    plan.imports.push({ name: file.name, path });
  }

  return plan;
}
