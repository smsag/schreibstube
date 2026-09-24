/**
 * Deciding what gets published, and what it is called.
 *
 * The bridge has no vault: it is told which notes exist, what they are named
 * and where they will be served. Everything in that telling is decided here,
 * which is why this module is pure and tested — a wrong slug is a broken link
 * on a public site, and a wrong publish flag is a note that should not be one.
 */

import {
  linkpathCandidates,
  parseSlideshow,
  SLIDESHOW_LANGUAGE,
  type SlideshowLayout
} from "./slideshow";
import { normalizeTag, tagIncludes } from "./tag-pins";

/**
 * Which frontmatter key carries which meaning.
 *
 * A vault that already has its own conventions should not have to adopt ours,
 * so every key is a setting. The defaults are therefore the plain names most
 * vaults already use: a collision with another plugin's property is exactly
 * what the mapping is there to resolve, and paying for it up front with a
 * prefix would make the common case read worse.
 */
export interface PublishKeyMap {
  published: string;
  title: string;
  date: string;
  description: string;
  slug: string;
  publishedAt: string;
  publishedUrl: string;
}

export const DEFAULT_PUBLISH_KEYS: PublishKeyMap = {
  published: "published",
  title: "title",
  date: "date",
  description: "description",
  slug: "slug",
  publishedAt: "publishedAt",
  publishedUrl: "publishedUrl"
};

/** The roles in the order the settings tab shows them. */
export const PUBLISH_KEY_ROLES = Object.keys(DEFAULT_PUBLISH_KEYS) as (keyof PublishKeyMap)[];

/**
 * Reduce a configured map to one that can be used.
 *
 * A blank field means "unchanged", so a half-cleared setting cannot silently
 * stop a role from being read at all. Two roles cannot share a key either: the
 * plugin would have no way to tell which meaning was intended, so the later
 * role falls back to its default.
 */
export function normalizePublishKeys(value: unknown): PublishKeyMap {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  const keys = { ...DEFAULT_PUBLISH_KEYS };
  const taken = new Set<string>();

  for (const role of PUBLISH_KEY_ROLES) {
    const configured = typeof record[role] === "string" ? (record[role] as string).trim() : "";
    const key = configured || DEFAULT_PUBLISH_KEYS[role];
    keys[role] = taken.has(key) ? DEFAULT_PUBLISH_KEYS[role] : key;
    taken.add(keys[role]);
  }

  return keys;
}

export interface PublishFields {
  published: boolean;
  title: string;
  date: string;
  description: string;
  slug: string;
}

/**
 * Read the publish frontmatter of one note.
 *
 * Publishing is opt-in: a note without the flag is not published, and one that
 * had it and lost it is taken down on the next publish. Silence has to mean
 * "no", because the alternative is publishing a vault by accident.
 */
export function readPublishFields(frontmatter: unknown, keys: PublishKeyMap): PublishFields {
  const record =
    typeof frontmatter === "object" && frontmatter !== null
      ? (frontmatter as Record<string, unknown>)
      : {};

  return {
    published: isTrue(record[keys.published]),
    title: text(record[keys.title]),
    date: text(record[keys.date]),
    description: text(record[keys.description]),
    slug: text(record[keys.slug])
  };
}

function isTrue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string")
    return ["true", "yes", "ja", "1"].includes(value.trim().toLowerCase());
  return value === 1;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value instanceof Date) return isoDate(value.getTime());
  if (typeof value === "number") return String(value);
  return "";
}

/**
 * Reduce a name to something that can appear in a URL.
 *
 * This has to agree with the bridge, which refuses anything it did not expect
 * to see in a directory name. Umlauts are transliterated rather than stripped,
 * because a slug that loses its vowels reads as a mistake rather than a name.
 */
export function slugify(value: string): string {
  const transliterated = (value ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const slug = transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug || "datei";
}

/** The first heading of a note, which is what a reader would call it. */
export function firstHeading(content: string): string {
  const match = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(stripFrontmatter(content));
  return match?.[1]?.trim() ?? "";
}

export function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content ?? "");
  return match ? content.slice(match[0].length) : (content ?? "");
}

/** `2026-09-12`, in local time, because a publication date is a calendar date. */
export function isoDate(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface NoteInput {
  path: string;
  basename: string;
  content: string;
  createdMs: number;
  frontmatter: unknown;
}

export interface ResolvedNote {
  sourcePath: string;
  slug: string;
  title: string;
  date: string;
  description?: string;
}

/** Fill in everything the frontmatter left out, so the bridge never guesses. */
export function resolveNote(input: NoteInput, keys: PublishKeyMap): ResolvedNote {
  const fields = readPublishFields(input.frontmatter, keys);
  const title = fields.title || firstHeading(input.content) || input.basename;

  return {
    sourcePath: input.path,
    slug: fields.slug ? slugify(fields.slug) : slugify(input.basename),
    title,
    date: fields.date || isoDate(input.createdMs),
    ...(fields.description ? { description: fields.description } : {})
  };
}

/**
 * Two notes cannot share an address.
 *
 * Caught here rather than on the bridge as well, so the message names vault
 * paths the user can open instead of whatever the index happened to carry.
 */
export function findSlugCollision(notes: ResolvedNote[]): string | null {
  const seen = new Map<string, string>();
  for (const note of notes) {
    const previous = seen.get(note.slug);
    if (previous) {
      return `"${note.slug}" wird von zwei Notizen beansprucht: ${previous} und ${note.sourcePath}.`;
    }
    seen.set(note.slug, note.sourcePath);
  }
  return null;
}

/**
 * The embeds and images a note refers to.
 *
 * Only what a published note actually uses is uploaded: an attachments folder
 * is usually far larger than the notes, and none of the rest belongs on a
 * public site.
 */
export function referencedAttachments(content: string): string[] {
  const body = stripFrontmatter(content);
  const found = new Set<string>();

  for (const match of body.matchAll(/!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)) {
    const target = match[1]?.split("#")[0]?.trim();
    if (target) found.add(target);
  }

  // A path in angle brackets may hold spaces; a bare one may not.
  for (const match of body.matchAll(/!\[[^\]]*\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)) {
    const target = decodeTarget(match[1] ?? match[2] ?? "").trim();
    // A remote image is already served from somewhere; only vault files travel.
    if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) found.add(target);
  }

  for (const reference of slideshowReferences(content)) found.add(reference);

  return [...found];
}

/**
 * The pictures a slideshow block shows, read by the block's own rules.
 *
 * A slideshow line is not quite a Markdown image: the block accepts a bare
 * space in a path (`![](my photo.png)`), which the pattern above cannot, so a
 * picture the note showed in the vault was never uploaded and went missing on
 * the site without a word. Every path the block would try is offered; the
 * caller keeps only those that name a file. With a `layout`, only the blocks
 * of that layout count: a filmstrip's pictures are the ones with thumbnails.
 */
export function slideshowReferences(content: string, layout?: SlideshowLayout): string[] {
  const body = stripFrontmatter(content);
  const found: string[] = [];
  const fence = new RegExp("^ {0,3}(`{3,}|~{3,})[ \\t]*" + SLIDESHOW_LANGUAGE + "[ \\t]*$", "gm");

  for (const open of body.matchAll(fence)) {
    const marker = open[1] ?? "```";
    const start = (open.index ?? 0) + open[0].length + 1;
    const close = new RegExp("^ {0,3}" + marker[0] + "{" + marker.length + ",}[ \\t]*$", "m");
    const rest = body.slice(start);
    const end = close.exec(rest);
    const block = parseSlideshow(end ? rest.slice(0, end.index) : rest);
    if (!block.ok || (layout !== undefined && block.layout !== layout)) continue;
    for (const image of block.images) {
      for (const candidate of linkpathCandidates(image.src)) {
        // The path with its angle brackets still on names nothing anyone wrote.
        if (/^<.*>$/.test(candidate) || /^[a-z][a-z0-9+.-]*:/i.test(candidate)) continue;
        found.push(candidate);
      }
    }
  }

  return found;
}

/**
 * A link target as written, with percent escapes resolved where they are valid.
 *
 * `decodeURI` throws on a stray percent, and a stray percent is an ordinary
 * thing for a filename to contain — `100%-Finanzierung.png` is a file somebody
 * has. Thrown from here it took the whole publish with it, for every note,
 * naming nothing. A name that cannot be decoded is simply a name.
 */
function decodeTarget(raw: string): string {
  try {
    return decodeURI(raw);
  } catch {
    return raw;
  }
}

/** Whether a vault file is something a site may serve as an attachment. */
export function isPublishableAttachment(name: string, extensions: Set<string>): boolean {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1];
  return extension !== undefined && extensions.has(extension.toLowerCase());
}

export const ATTACHMENT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "mp4",
  "webm",
  "ogv",
  "mov",
  "m4v"
]);

/** A vault path is inside a folder when it is the folder or below it. */
export function isInsideFolder(path: string, folder: string): boolean {
  const normalized = folder.replace(/^\/+|\/+$/g, "");
  if (!normalized) return true;
  return path === normalized || path.startsWith(`${normalized}/`);
}

/** How many tags the site's header links to. More would crowd out the title. */
export const MAX_HEADER_TAGS = 3;

/**
 * The header tags a connection asks for, from its settings.
 *
 * The settings share a file a person can edit, so each entry is read as a tag
 * the way Obsidian reads one, without its `#`; anything that is not one, and a
 * second spelling of one already listed, is dropped, and at most three stay.
 */
export function normalizeHeaderTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = normalizeTag(entry);
    if (tag === null || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === MAX_HEADER_TAGS) break;
  }
  return tags;
}

/**
 * The header tags a note falls under, as Obsidian counts tags: case aside, and
 * a note tagged `#projekt/alpha` under a header tag `projekt`.
 *
 * Only these travel to the bridge. A note's other tags are the vault's
 * business, and a published site has no use for them.
 */
export function headerTagsOf(carried: readonly string[], headerTags: readonly string[]): string[] {
  return headerTags.filter((tag) => carried.some((note) => tagIncludes(tag, note)));
}

/**
 * Every tag a note carries, as Obsidian's metadata has it: the `tags`
 * property — a list, or one string of tags separated by commas or spaces —
 * and the `#tags` written in the text. What Obsidian's own `getAllTags`
 * reads, taken from the same cache so the publish needs nothing more.
 */
export function noteTags(
  cache:
    | {
        frontmatter?: Record<string, unknown> | undefined;
        tags?: readonly { tag: string }[] | undefined;
      }
    | null
    | undefined
): string[] {
  const found: string[] = [];
  const property = cache?.frontmatter?.tags ?? cache?.frontmatter?.tag;
  const written = Array.isArray(property)
    ? property
    : typeof property === "string"
      ? property.split(/[,\s]+/)
      : [];
  for (const entry of written) {
    if (typeof entry !== "string") continue;
    const tag = normalizeTag(entry);
    if (tag !== null) found.push(tag);
  }
  for (const entry of cache?.tags ?? []) {
    const tag = normalizeTag(entry.tag);
    if (tag !== null) found.push(tag);
  }
  return found;
}
