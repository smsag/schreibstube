/**
 * Deciding what gets published, and what it is called.
 *
 * The bridge has no vault: it is told which notes exist, what they are named
 * and where they will be served. Everything in that telling is decided here,
 * which is why this module is pure and tested — a wrong slug is a broken link
 * on a public site, and a wrong publish flag is a note that should not be one.
 */

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
  if (typeof value === "string") return ["true", "yes", "ja", "1"].includes(value.trim().toLowerCase());
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
  return match ? match[1].trim() : "";
}

export function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content ?? "");
  return match ? content.slice(match[0].length) : content ?? "";
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
    description: fields.description || undefined
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
    const target = match[1].split("#")[0].trim();
    if (target) found.add(target);
  }

  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = decodeURI(match[1]).trim();
    // A remote image is already served from somewhere; only vault files travel.
    if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) found.add(target);
  }

  return [...found];
}

/** Whether a vault file is something a site may serve as an attachment. */
export function isPublishableAttachment(name: string, extensions: Set<string>): boolean {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match ? extensions.has(match[1].toLowerCase()) : false;
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
