/**
 * Deciding what gets published, and what it is called.
 *
 * The bridge has no vault: it is told which notes exist, what they are named
 * and where they will be served. Everything in that telling is decided here:
 * a wrong slug is a broken link on a public site, and a wrong publish flag is
 * a note that should not be one.
 */

import { t } from "../i18n";
import {
  linkpathCandidates,
  parseSlideshow,
  SLIDESHOW_LANGUAGE,
  type SlideshowLayout
} from "./slideshow";
import { splitFrontmatter } from "./frontmatter-block";
import { fencedLines } from "./markdown-fence";
import { printableText } from "./typst-value";
import { checkTag, tagIncludes } from "./tag-pins";

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
  language: string;
  publishedAt: string;
  publishedUrl: string;
}

export const DEFAULT_PUBLISH_KEYS: PublishKeyMap = {
  published: "published",
  title: "title",
  date: "date",
  description: "description",
  slug: "slug",
  // Schreibstube's own, unlike the rest: `lang` is a key other tools write
  // for their own ends, and a glossary's `schreibstubeLanguage` says what its
  // terms are in. Read by default, either would set a page's language without
  // anyone having asked; a vault that means it maps the role to it.
  language: "schreibstubePageLanguage",
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
 * plugin would have no way to tell which meaning was intended. A role left at
 * its default keeps it, since nobody moved it; a role mapped onto a key that
 * is taken falls back to its default, and to a key of Schreibstube's own when
 * that is taken too.
 */
export function normalizePublishKeys(value: unknown): PublishKeyMap {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  const wanted = { ...DEFAULT_PUBLISH_KEYS };
  for (const role of PUBLISH_KEY_ROLES) {
    const configured = typeof record[role] === "string" ? (record[role] as string).trim() : "";
    if (configured) wanted[role] = configured;
  }

  const keys = { ...DEFAULT_PUBLISH_KEYS };
  // The defaults differ from each other, so the roles that kept theirs never collide.
  const taken = new Set(
    PUBLISH_KEY_ROLES.filter((role) => wanted[role] === DEFAULT_PUBLISH_KEYS[role]).map(
      (role) => DEFAULT_PUBLISH_KEYS[role]
    )
  );
  for (const role of PUBLISH_KEY_ROLES) {
    if (wanted[role] === DEFAULT_PUBLISH_KEYS[role]) continue;
    keys[role] =
      [wanted[role], DEFAULT_PUBLISH_KEYS[role]].find((key) => !taken.has(key)) ??
      ownKey(role, taken);
    taken.add(keys[role]);
  }

  return keys;
}

/** A key nobody configured, for a role whose own two were both taken. */
function ownKey(role: keyof PublishKeyMap, taken: ReadonlySet<string>): string {
  const base = `schreibstube${role[0]!.toUpperCase()}${role.slice(1)}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}${n}`;
  return key;
}

export interface PublishFields {
  published: boolean;
  title: string;
  date: string;
  description: string;
  slug: string;
  language: string;
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
    slug: text(record[keys.slug]),
    language: text(record[keys.language])
  };
}

function isTrue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string")
    return ["true", "yes", "ja", "1"].includes(value.trim().toLowerCase());
  return value === 1;
}

/**
 * A field as text. A date is the day YAML wrote, which it reads as midnight
 * UTC: read back in local time, as it was, a page west of Greenwich went out
 * dated the day before, and a date that is none went out as "NaN-NaN-NaN".
 */
function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value instanceof Date || typeof value === "number" ? (printableText(value) ?? "") : "";
}

/**
 * Reduce a name to something that can appear in a URL.
 *
 * This has to agree with the bridge, which refuses anything it did not expect
 * to see in a directory name. Umlauts are transliterated rather than stripped,
 * because a slug that loses its vowels reads as a mistake rather than a name.
 */
export function slugify(value: string): string {
  const transliterated = value
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

/**
 * The first heading of a note, which is what a reader would call it. Not a
 * `# comment` in a code block above it: a note opening with a shell sample was
 * published under the name of its first command.
 */
export function firstHeading(content: string): string {
  const lines = stripFrontmatter(content).split(/\r?\n/);
  const fenced = fencedLines(lines);
  for (const [at, line] of lines.entries()) {
    // A closing run of hashes is set off by a space; one glued to the text, as
    // in `# C#`, is the text.
    const match = fenced[at] ? null : /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

export function stripFrontmatter(content: string): string {
  return splitFrontmatter(content).body;
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
  language?: string;
}

/** Fill in everything the frontmatter left out, so the bridge never guesses. */
export function resolveNote(input: NoteInput, keys: PublishKeyMap): ResolvedNote {
  const fields = readPublishFields(input.frontmatter, keys);
  const title = fields.title || firstHeading(input.content) || input.basename;
  const language = checkLanguage(fields.language);

  return {
    sourcePath: input.path,
    slug: fields.slug ? slugify(fields.slug) : slugify(input.basename),
    title,
    date: fields.date || isoDate(input.createdMs),
    ...(fields.description ? { description: fields.description } : {}),
    // A language that is no language tag is left out rather than refused: the
    // page then takes the site's, which is what an unset one would do.
    ...(language ? { language } : {})
  };
}

/**
 * The key that makes a note the site's start page. Schreibstube's own, so
 * prefixed rather than mapped: no vault has a convention for it to collide
 * with. Its value names the kind of site, so the note says what it does:
 * `list`, the list of notes with this note's text above it, or `marketing`,
 * this note alone. A folder where no note carries it has the plain list.
 */
export const HOME_KEY = "schreibstubeHome";
export const HOME_LIST = "list";
export const HOME_MARKETING = "marketing";
/** The note drawn beneath every page, with no page of its own. */
export const FOOTER_KEY = "schreibstubeFooter";

export interface HomeFields {
  home: boolean;
  homeList: boolean;
}

/**
 * Whether a note is the start page, and whether the list of notes goes
 * beneath it. Only the two named values count; anything else leaves the note
 * an ordinary page, as silence does.
 */
export function readHomeFields(frontmatter: unknown): HomeFields {
  const value =
    typeof frontmatter === "object" && frontmatter !== null
      ? (frontmatter as Record<string, unknown>)[HOME_KEY]
      : undefined;
  const word = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (word === HOME_LIST) return { home: true, homeList: true };
  if (word === HOME_MARKETING) return { home: true, homeList: false };
  return { home: false, homeList: false };
}

/**
 * A site has one start page. Two would leave the bridge to pick, and the
 * message here names notes the user can open.
 */
export function findHomeCollision(
  notes: readonly { sourcePath: string; home?: boolean }[]
): string | null {
  const homes = notes.filter((note) => note.home);
  const [first, second] = homes;
  return first && second ? t().publish.homeCollision(first.sourcePath, second.sourcePath) : null;
}

/** Whether a note is the footer of every page. */
export function readFooter(frontmatter: unknown): boolean {
  return (
    typeof frontmatter === "object" &&
    frontmatter !== null &&
    isTrue((frontmatter as Record<string, unknown>)[FOOTER_KEY])
  );
}

/**
 * A site has one footer, and it is no page, so it cannot be the start page
 * as well. The message names notes the user can open.
 */
export function findFooterCollision(
  notes: readonly { sourcePath: string; home?: boolean; footer?: boolean }[]
): string | null {
  const footers = notes.filter((note) => note.footer);
  const [first, second] = footers;
  if (first && second) return t().publish.footerCollision(first.sourcePath, second.sourcePath);
  const both = footers.find((note) => note.home);
  return both ? t().publish.footerIsHome(both.sourcePath) : null;
}

/**
 * Where a published note can be read: the site's root for the start page,
 * nowhere for the footer, which has no page of its own.
 */
export function publishedUrl(
  baseUrl: string,
  note: { slug: string; home?: boolean; footer?: boolean }
): string | null {
  if (note.footer) return null;
  return note.home ? `${baseUrl}/` : `${baseUrl}/${note.slug}/`;
}

/** The longest language tag sent: room for a language, a script, a region and a variant. */
export const MAX_LANGUAGE_CHARS = 35;

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

/**
 * A language tag as a page's `lang` takes it: `de`, `en`, `en-GB`. The bridge
 * refuses an index carrying anything else, so both read the same table
 * (contracts/language-cases.json).
 */
export function checkLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim();
  return tag.length <= MAX_LANGUAGE_CHARS && LANGUAGE_TAG.test(tag) ? tag : null;
}

/**
 * What the site's language field saves once it is left: the tag, nothing for
 * an empty field — German, as an account without one always was — or null
 * for anything else, which is refused whole rather than kept in part.
 */
export function readLanguageField(typed: string): string | null {
  const value = typed.trim();
  return value === "" ? "" : checkLanguage(value);
}

/**
 * Two notes cannot share an address.
 *
 * Caught here rather than on the bridge as well, so the message names vault
 * paths the user can open instead of whatever the index happened to carry.
 * The start page is served from the root and the footer from nowhere, so
 * neither takes its slug's address from a note that wants it.
 */
export function findSlugCollision(
  notes: readonly { sourcePath: string; slug: string; home?: boolean; footer?: boolean }[]
): string | null {
  const seen = new Map<string, string>();
  for (const note of notes) {
    if (note.home || note.footer) continue;
    const previous = seen.get(note.slug);
    if (previous) {
      return t().publish.slugCollision(note.slug, previous, note.sourcePath);
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
    const start = open.index + open[0].length + 1;
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
    const tag = checkTag(entry);
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
    const tag = checkTag(entry);
    if (tag !== null) found.push(tag);
  }
  for (const entry of cache?.tags ?? []) {
    const tag = checkTag(entry.tag);
    if (tag !== null) found.push(tag);
  }
  return found;
}
