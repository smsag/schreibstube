/**
 * Finding the picture an orphaned description note was about.
 *
 * A note is orphaned when its link finds no file: the picture was renamed
 * outside Obsidian, or deleted while the plugin was off. The note recorded the
 * picture's bytes when it was written — a hash and a size — so a picture that
 * only moved can be recognised by its content, whatever it is called now.
 *
 * Reading a picture to hash it is the expensive part, so the size decides first:
 * only pictures of exactly the recorded size are read, and only so many of them
 * per run. A match is taken only when it is certain both ways — one picture for
 * the note, one note for the picture. Anything less stays an orphan, listed for
 * the person to look at, and is never removed.
 */
import { linkTarget } from "./description-pairs";

/** At most this many pictures are read per run: a vault of thousands of
 *  photos from one camera has many of one size, and a phone pays for each. */
export const MAX_ORPHAN_HASH_READS = 100;

/** A picture larger than this is not read to be matched. */
export const MAX_ORPHAN_PICTURE_BYTES = 50 * 1024 * 1024;

export interface OrphanFacts {
  /** The note's path. */
  path: string;
  /** Its link as written, the part that is replaced on repair. */
  link: string;
  hash: string;
  size: number;
}

export interface PictureFacts {
  path: string;
  size: number;
}

export interface OrphanRepairPlan {
  note: string;
  link: string;
  image: string;
}

/**
 * What an orphan's frontmatter says about its picture, or null when it does
 * not say enough to match on. Frontmatter is anyone's to edit, so each value is
 * checked for the shape `hashImageBytes` and a file size have.
 */
export function orphanFacts(
  path: string,
  frontmatter: Record<string, unknown> | undefined,
  keys: { image: string; hash: string; size: string }
): OrphanFacts | null {
  if (!frontmatter) return null;
  const link = linkTarget(frontmatter[keys.image]);
  const hash = frontmatter[keys.hash];
  const size = frontmatter[keys.size];
  if (link === null) return null;
  if (typeof hash !== "string" || !/^[0-9a-f]{16}$/.test(hash)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return null;
  return { path, link, hash, size };
}

/**
 * The pictures worth reading: of an orphan's exact size and within the byte
 * bound, in the order the orphans come, each once, at most `cap` of them.
 */
export function picturesToHash(
  orphans: readonly OrphanFacts[],
  pictures: readonly PictureFacts[],
  cap = MAX_ORPHAN_HASH_READS
): string[] {
  const bySize = new Map<number, string[]>();
  for (const picture of pictures) {
    if (picture.size > MAX_ORPHAN_PICTURE_BYTES) continue;
    const list = bySize.get(picture.size) ?? [];
    list.push(picture.path);
    bySize.set(picture.size, list);
  }
  const out = new Set<string>();
  for (const orphan of orphans) {
    for (const path of bySize.get(orphan.size) ?? []) {
      if (out.size >= cap) return [...out];
      out.add(path);
    }
  }
  return [...out];
}

/**
 * The repairs that are certain. `hashes` holds what reading the pictures gave,
 * so a picture that was not read cannot match. Two orphans with the same
 * content, or two copies of one picture, are left alone: the choice between
 * them is a guess, and a wrong link is worse than a listed orphan.
 */
export function matchOrphans(
  orphans: readonly OrphanFacts[],
  hashes: ReadonlyMap<string, string>
): OrphanRepairPlan[] {
  const picturesByHash = new Map<string, string[]>();
  for (const [path, hash] of hashes) {
    const list = picturesByHash.get(hash) ?? [];
    list.push(path);
    picturesByHash.set(hash, list);
  }
  const orphansByHash = new Map<string, number>();
  for (const orphan of orphans) {
    orphansByHash.set(orphan.hash, (orphansByHash.get(orphan.hash) ?? 0) + 1);
  }
  const plans: OrphanRepairPlan[] = [];
  for (const orphan of orphans) {
    const found = picturesByHash.get(orphan.hash) ?? [];
    if (found.length !== 1 || orphansByHash.get(orphan.hash) !== 1) continue;
    const image = found[0];
    if (image !== undefined) plans.push({ note: orphan.path, link: orphan.link, image });
  }
  return plans;
}
