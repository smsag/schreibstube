/**
 * Turning an index and a pile of sources into a site.
 *
 * Uploads are incremental; rendering is total. Every commit renders every note,
 * because a title, a date or a slug that changed in one note changes the index
 * page and every link pointing at it. Output is hashed afterwards, so a page
 * that came out the same is not written again and the transfer stays
 * proportional to what actually changed.
 */
import { createHash } from "node:crypto";
import { createRenderer, renderMarkdown } from "./render/markdown.mjs";
import { indexPage, notePage, tagPage } from "./render/page.mjs";
import {
  assetPath,
  extensionOf,
  isValidSlug,
  pagePath,
  isHeaderTag,
  MAX_HEADER_TAGS,
  slugify,
  tagLabel,
  tagPagePath,
  thumbnailPath,
  VIDEO_EXTENSIONS
} from "./path.mjs";
import { generatorAssets } from "./assets.mjs";
import { siteIconFromTheme } from "./site-icon.mjs";
import { key } from "./render/obsidian.mjs";

export class IndexError extends Error {}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Check an index before anything is uploaded on the strength of it.
 *
 * Slug collisions are the important one: two notes claiming the same address
 * would publish as one page, and the loser would vanish with no signal.
 */
export function checkIndex(index) {
  if (!index || typeof index !== "object") throw new IndexError("An index is required.");
  if (!Array.isArray(index.notes)) throw new IndexError("The index needs a notes array.");
  if (!Array.isArray(index.assets)) throw new IndexError("The index needs an assets array.");

  const headerTags = checkHeaderTags(index.headerTags);

  const seen = new Map();
  for (const note of index.notes) {
    if (!note?.sourcePath) throw new IndexError("A note is missing its sourcePath.");
    if (!isHash(note.sha256)) throw new IndexError(`${note.sourcePath}: missing content hash.`);
    if (!isValidSlug(note.slug)) {
      throw new IndexError(`${note.sourcePath}: unusable slug ${JSON.stringify(note.slug)}.`);
    }
    const previous = seen.get(note.slug);
    if (previous) {
      throw new IndexError(
        `Two notes claim the slug "${note.slug}": ${previous} and ${note.sourcePath}.`
      );
    }
    seen.set(note.slug, note.sourcePath);
    if (note.tags !== undefined) {
      if (!Array.isArray(note.tags) || note.tags.some((tag) => !headerTags.includes(tag))) {
        throw new IndexError(`${note.sourcePath}: tags must be among the header tags.`);
      }
    }
  }

  for (const asset of index.assets) {
    if (!asset?.sourcePath) throw new IndexError("An asset is missing its sourcePath.");
    if (!isHash(asset.sha256)) throw new IndexError(`${asset.sourcePath}: missing content hash.`);
    if (asset.thumbnail !== undefined && typeof asset.thumbnail !== "boolean") {
      throw new IndexError(`${asset.sourcePath}: thumbnail must be true or false.`);
    }
  }

  return index;
}

/**
 * The header tags, checked: at most three, each one the bridge can name a
 * page after, and no two that would share one — `a-b` and `a/b` are both
 * `tag/a-b/`, and the second would overwrite the first.
 */
function checkHeaderTags(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HEADER_TAGS) {
    throw new IndexError(`The header takes at most ${MAX_HEADER_TAGS} tags.`);
  }
  const pages = new Map();
  for (const tag of value) {
    if (!isHeaderTag(tag)) throw new IndexError(`Unusable header tag: ${JSON.stringify(tag)}.`);
    const page = tagPagePath(tag);
    if (pages.has(page)) {
      throw new IndexError(`The header tags ${pages.get(page)} and ${tag} would share one page.`);
    }
    pages.set(page, tag);
  }
  return value;
}

/**
 * The header's links: each header tag some published note carries, in the
 * order the connection lists them, with its notes newest first. A tag no
 * note carries is left out rather than linking to an empty page.
 */
export function headerNav(index) {
  const ordered = orderNotes(index.notes);
  return (index.headerTags ?? [])
    .map((tag) => ({
      tag,
      label: tagLabel(tag),
      slug: slugify(tag),
      path: tagPagePath(tag),
      notes: ordered.filter((note) => note.tags?.includes(tag))
    }))
    .filter((entry) => entry.notes.length > 0);
}

/** Newest first, and stable for two notes sharing a date. */
export function orderNotes(notes) {
  return [...notes].sort((a, b) => {
    const byDate = String(b.date ?? "").localeCompare(String(a.date ?? ""));
    return byDate !== 0 ? byDate : String(a.title ?? "").localeCompare(String(b.title ?? ""));
  });
}

/**
 * Build every file of the site.
 *
 * `sources` maps a content hash to the Markdown that hashes to it, which is how
 * the state directory stores them: a note that has not changed keeps its hash
 * and is never uploaded twice.
 */
export async function buildSite(index, sources, options = {}) {
  const ordered = orderNotes(index.notes);
  const site = lookups(index, options.thumbnails);
  const md = createRenderer(options);

  const nav = headerNav(index);
  const siteIcon = siteIconFromTheme(index.themeCss);
  const icon = siteIcon ? { path: siteIcon.path, type: siteIcon.type } : null;
  const files = new Map();
  let usedMath = false;
  let usedMermaid = false;
  let usedSlideshow = false;

  for (const note of ordered) {
    const source = sources.get(note.sha256);
    if (source === undefined) {
      throw new IndexError(`Source not uploaded for ${note.sourcePath}.`);
    }

    const rendered = renderMarkdown(md, source, site, { sourcePath: note.sourcePath });
    usedMath = usedMath || rendered.usedMath;
    usedMermaid = usedMermaid || rendered.usedMermaid;
    usedSlideshow = usedSlideshow || rendered.usedSlideshow;

    files.set(
      pagePath(note.slug),
      Buffer.from(
        notePage({
          note,
          body: rendered.html,
          siteTitle: index.siteTitle,
          nav,
          icon,
          usedMath: rendered.usedMath,
          usedMermaid: rendered.usedMermaid,
          usedSlideshow: rendered.usedSlideshow
        }),
        "utf8"
      )
    );
  }

  files.set(
    "index.html",
    Buffer.from(indexPage({ notes: ordered, siteTitle: index.siteTitle, nav, icon }), "utf8")
  );
  for (const entry of nav) {
    files.set(
      entry.path,
      Buffer.from(tagPage({ entry, siteTitle: index.siteTitle, nav, icon }), "utf8")
    );
  }

  for (const [path, content] of await generatorAssets({
    math: usedMath,
    mermaid: usedMermaid,
    slideshow: usedSlideshow,
    theme: index.themeCss
  })) {
    files.set(path, content);
  }
  if (siteIcon) files.set(siteIcon.path, siteIcon.bytes);

  return files;
}

/**
 * The tables the Obsidian rules resolve links against.
 *
 * Both a full vault path and a bare file name resolve, because that is how
 * wikilinks are written. URLs are relative to a note page, which is the only
 * place a rendered body is ever placed.
 */
function lookups(index, thumbnails = new Set()) {
  const notes = new Map();
  for (const note of index.notes) {
    const entry = { url: `../${note.slug}/`, title: note.title, slug: note.slug };
    for (const alias of aliases(note.sourcePath)) notes.set(alias, entry);
  }

  const assets = new Map();
  for (const asset of index.assets) {
    const name = asset.name ?? basename(asset.sourcePath);
    const path = assetPath(asset.sha256, name);
    // The shared reading, which requires letters and digits: `video.mp 4`
    // used to count as an extension here and not in the route that admitted
    // it, so one file could be two kinds of thing.
    const extension = extensionOf(name);
    const entry = {
      url: `../${path}`,
      name,
      kind: VIDEO_EXTENSIONS.has(extension) ? "video" : "image"
    };
    // Named as the plan and the commit name it, from the name the index sent.
    const thumbnail = asset.thumbnail
      ? thumbnailPath(asset.sha256, asset.name ?? asset.sourcePath)
      : null;
    if (thumbnail && thumbnails.has(thumbnail)) entry.thumbnail = `../${thumbnail}`;
    for (const alias of aliases(asset.sourcePath)) assets.set(alias, entry);
  }

  return { notes, assets, slugify };
}

function aliases(sourcePath) {
  return new Set([key(sourcePath), key(basename(sourcePath))]);
}

function basename(path) {
  return String(path).split("/").pop() ?? String(path);
}

function isHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
