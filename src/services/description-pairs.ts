/**
 * Which note describes which picture.
 *
 * A description note is a note because of the key it carries, not because of
 * the folder it sits in: a note moved out of the description folder keeps
 * describing its picture, and a note somebody wrote by hand inside that folder
 * is left alone. The key holds a link, and Obsidian resolves links, so the
 * pairing asks the vault through `resolve` and never guesses from a name.
 *
 * Pure: the view hands over what the metadata cache says, and the answer is a
 * table the Explorer reads to hide the notes and to find a picture by its words.
 */

export interface DescriptionCandidate {
  /** The note's path. */
  path: string;
  /** What its frontmatter holds under the image key — untrusted, any shape. */
  imageLink: unknown;
  /** When it was written, for choosing between two notes about one picture. */
  describedAt: unknown;
}

export interface DescriptionPairs {
  /** Picture path → the note describing it. */
  byImage: ReadonlyMap<string, string>;
  /** Every note that describes a picture that exists. */
  notes: ReadonlySet<string>;
  /** Notes whose link resolves to no file: the picture was renamed outside
   *  Obsidian or deleted while the plugin was off. Never hidden, never removed. */
  orphans: readonly string[];
  /** Notes about a picture another, newer note also describes. */
  duplicates: readonly string[];
}

/**
 * The link target a frontmatter value names: `[[path]]`, `[[path|alias]]` or
 * `[[path#heading]]`, the path trimmed. Anything else — a bare string, a list,
 * a number — is not a pairing, because a link is what survives a rename.
 */
export function linkTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\s*!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(value);
  const target = match?.[1]?.trim();
  return target ? target : null;
}

/** An ISO timestamp as a number to compare by; anything else sorts first. */
function writtenAt(value: unknown): number {
  if (typeof value !== "string") return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

/**
 * Pair every candidate with the picture its link resolves to.
 *
 * Two notes about one picture keep the newer as the description (the later
 * `describedAt`, then the path, so the answer does not depend on the order the
 * vault listed them). The other is a duplicate: reported, and hidden like any
 * description note, since it too is about a picture that is shown.
 */
export function pairDescriptions(
  candidates: readonly DescriptionCandidate[],
  resolve: (link: string, fromPath: string) => string | null
): DescriptionPairs {
  const byImage = new Map<string, DescriptionCandidate>();
  const notes = new Set<string>();
  const orphans: string[] = [];
  const duplicates: string[] = [];

  for (const candidate of candidates) {
    const link = linkTarget(candidate.imageLink);
    if (link === null) continue;
    const image = resolve(link, candidate.path);
    if (image === null || image === candidate.path) {
      orphans.push(candidate.path);
      continue;
    }
    notes.add(candidate.path);

    const current = byImage.get(image);
    if (!current) {
      byImage.set(image, candidate);
      continue;
    }
    const newer =
      writtenAt(candidate.describedAt) - writtenAt(current.describedAt) ||
      current.path.localeCompare(candidate.path);
    if (newer > 0) {
      duplicates.push(current.path);
      byImage.set(image, candidate);
    } else {
      duplicates.push(candidate.path);
    }
  }

  return {
    byImage: new Map([...byImage].map(([image, note]) => [image, note.path])),
    notes,
    orphans,
    duplicates
  };
}
