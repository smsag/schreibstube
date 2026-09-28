/**
 * The `tags` key as it is found, and as it is left after tags were added.
 *
 * Frontmatter is written by hand and by every plugin, and Obsidian reads
 * `tags` in several shapes: a list, a single string, a string of tags
 * separated by commas or spaces, a number somebody typed, nothing at all.
 * Adding a tag must keep every tag that was there in whichever of those
 * shapes, and must not add one twice because it was spelt with a `#` or a
 * capital letter the first time.
 */
import { tagKey } from "./tag-suggestions";

/** The most tags the key is read as holding; past this it is not a tag list. */
const MAX_TAGS = 500;

/** The tags a `tags` value holds, as written, without a leading `#`. */
export function frontmatterTagList(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : typeof value === "number"
        ? [String(value)]
        : [];

  const tags: string[] = [];
  for (const item of items.slice(0, MAX_TAGS)) {
    const text = typeof item === "number" ? String(item) : item;
    if (typeof text !== "string") continue;
    const tag = text.trim().replace(/^#+/, "");
    if (tag.length > 0) tags.push(tag);
  }
  return tags;
}

/**
 * The key's new value: every tag it had, in its order, then each added one
 * that is not already there by Obsidian's comparison. Always a list, which is
 * the shape Obsidian itself writes.
 */
export function withAddedTags(
  value: unknown,
  add: readonly string[]
): { tags: string[]; added: string[] } {
  const tags = frontmatterTagList(value);
  const present = new Set(tags.map(tagKey));
  const added: string[] = [];
  for (const raw of add) {
    const tag = raw.trim().replace(/^#+/, "");
    const key = tagKey(tag);
    if (key.length === 0 || present.has(key)) continue;
    present.add(key);
    tags.push(tag);
    added.push(tag);
  }
  return { tags, added };
}
