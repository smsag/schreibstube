/**
 * Which pictures in a folder a "Describe pictures" run sends.
 *
 * Every picture under the folder, subfolders included, that has no
 * description note paired with it. An orphaned note — one whose picture was
 * renamed outside Obsidian — has lost its pairing, so its picture counts as
 * undescribed here; the caller re-links the orphans it can by content first,
 * because a match costs a hash and a new description costs a request.
 *
 * Every picture sent is a request someone pays for and a picture that leaves
 * the vault, so the run is bounded and the plan says what it left out: the
 * pictures too large to send, and those beyond the cap.
 */

/** A run describes at most this many pictures; a second run takes the rest. */
export const MAX_FOLDER_DESCRIPTIONS = 100;

export interface FolderPicture {
  path: string;
  size: number;
}

export interface FolderDescriptionPlan {
  /** In path order, at most MAX_FOLDER_DESCRIPTIONS. */
  describe: string[];
  /** Pictures under the folder that already have a description. */
  described: number;
  /** Pictures over the size a picture may be sent at. */
  tooLarge: string[];
  /** Undescribed pictures left for a later run by the cap. */
  deferred: number;
}

/** Whether a path lies under a folder; the vault root holds everything. */
export function isUnderFolder(path: string, folder: string): boolean {
  return folder === "" || folder === "/" || path.startsWith(`${folder}/`);
}

export function planFolderDescriptions(
  folder: string,
  pictures: readonly FolderPicture[],
  hasDescription: (path: string) => boolean,
  maxBytes: number,
  cap: number = MAX_FOLDER_DESCRIPTIONS
): FolderDescriptionPlan {
  const inFolder = pictures
    .filter((picture) => isUnderFolder(picture.path, folder))
    .sort((a, b) => a.path.localeCompare(b.path));

  let described = 0;
  const tooLarge: string[] = [];
  const pending: string[] = [];
  for (const picture of inFolder) {
    if (hasDescription(picture.path)) described++;
    else if (picture.size > maxBytes) tooLarge.push(picture.path);
    else pending.push(picture.path);
  }
  return {
    describe: pending.slice(0, cap),
    described,
    tooLarge,
    deferred: Math.max(0, pending.length - cap)
  };
}
