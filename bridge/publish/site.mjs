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
import { homePage, indexPage, notePage, PAGE_DEPTHS, tagPage } from "./render/page.mjs";
import { DEFAULT_LANGUAGE, isLanguageTag } from "./render/language.mjs";
import {
  assetName,
  assetPath,
  extensionOf,
  hasOwnPage,
  isListed,
  isValidSlug,
  noteHref,
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
import { SHARE_DIRECTORY } from "./share.mjs";

export class IndexError extends Error {}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Check an index before anything is uploaded on the strength of it, and
 * return a copy holding only the fields the bridge knows.
 *
 * Slug collisions are the important one: two notes claiming the same address
 * would publish as one page, and the loser would vanish with no signal. The
 * copy is what `index.json` stores and what a render reads back, so a field
 * nobody checked never reaches the host or a template.
 */
export function checkIndex(index) {
  if (!index || typeof index !== "object") throw new IndexError("An index is required.");
  if (!Array.isArray(index.notes)) throw new IndexError("The index needs a notes array.");
  if (!Array.isArray(index.assets)) throw new IndexError("The index needs an assets array.");
  if (index.siteTitle !== undefined && typeof index.siteTitle !== "string") {
    throw new IndexError("siteTitle must be a string.");
  }
  if (index.themeCss !== undefined && typeof index.themeCss !== "string") {
    throw new IndexError("themeCss must be a string.");
  }
  if (index.homeList !== undefined && typeof index.homeList !== "boolean") {
    throw new IndexError("homeList must be true or false.");
  }
  if (index.language !== undefined && !isLanguageTag(index.language)) {
    throw new IndexError(`Unusable language ${JSON.stringify(index.language)}.`);
  }

  const headerTags = checkHeaderTags(index.headerTags);

  const seen = new Map();
  const notes = [];
  let home = null;
  let footer = null;
  for (const note of index.notes) {
    if (!note?.sourcePath || typeof note.sourcePath !== "string") {
      throw new IndexError("A note is missing its sourcePath.");
    }
    if (!isHash(note.sha256)) throw new IndexError(`${note.sourcePath}: missing content hash.`);
    if (!isValidSlug(note.slug)) {
      throw new IndexError(`${note.sourcePath}: unusable slug ${JSON.stringify(note.slug)}.`);
    }
    for (const field of ["title", "date", "description"]) {
      if (note[field] !== undefined && typeof note[field] !== "string") {
        throw new IndexError(`${note.sourcePath}: ${field} must be a string.`);
      }
    }
    if (note.home !== undefined && note.home !== true) {
      throw new IndexError(`${note.sourcePath}: home must be true when it is given.`);
    }
    // One start page: a second would silently lose to whichever came first.
    if (note.home && home) {
      throw new IndexError(`Two notes claim the start page: ${home} and ${note.sourcePath}.`);
    }
    if (note.home) home = note.sourcePath;
    if (note.footer !== undefined && note.footer !== true) {
      throw new IndexError(`${note.sourcePath}: footer must be true when it is given.`);
    }
    if (note.footer && footer) {
      throw new IndexError(`Two notes claim the footer: ${footer} and ${note.sourcePath}.`);
    }
    // The start page is a page; the footer is part of every page and none.
    if (note.footer && note.home) {
      throw new IndexError(`${note.sourcePath}: a note is the start page or the footer, not both.`);
    }
    if (note.footer) footer = note.sourcePath;
    if (note.language !== undefined && !isLanguageTag(note.language)) {
      throw new IndexError(
        `${note.sourcePath}: unusable language ${JSON.stringify(note.language)}.`
      );
    }
    // Only a note with a page of its own takes its slug's address; the start
    // page and the footer leave theirs to any note that wants it.
    if (hasOwnPage(note)) {
      // The shared links live there, with a page of their own that keeps a
      // listing host from naming them; a note at the same address would take
      // that page over, and unpublishing it would delete it.
      if (note.slug === SHARE_DIRECTORY) {
        throw new IndexError(
          `${note.sourcePath}: the address "${SHARE_DIRECTORY}" is kept for shared links; give the note another slug.`
        );
      }
      const previous = seen.get(note.slug);
      if (previous) {
        throw new IndexError(
          `Two notes claim the slug "${note.slug}": ${previous} and ${note.sourcePath}.`
        );
      }
      seen.set(note.slug, note.sourcePath);
    }
    if (note.tags !== undefined) {
      if (!Array.isArray(note.tags) || note.tags.some((tag) => !headerTags.includes(tag))) {
        throw new IndexError(`${note.sourcePath}: tags must be among the header tags.`);
      }
    }
    notes.push(
      known({
        sourcePath: note.sourcePath,
        sha256: note.sha256,
        slug: note.slug,
        title: note.title,
        date: note.date,
        description: note.description,
        tags: note.tags,
        home: note.home,
        footer: note.footer,
        language: note.language
      })
    );
  }

  const assets = [];
  for (const asset of index.assets) {
    if (!asset?.sourcePath || typeof asset.sourcePath !== "string") {
      throw new IndexError("An asset is missing its sourcePath.");
    }
    if (!isHash(asset.sha256)) throw new IndexError(`${asset.sourcePath}: missing content hash.`);
    if (asset.name !== undefined && typeof asset.name !== "string") {
      throw new IndexError(`${asset.sourcePath}: name must be a string.`);
    }
    if (asset.bytes !== undefined && (!Number.isInteger(asset.bytes) || asset.bytes < 0)) {
      throw new IndexError(`${asset.sourcePath}: bytes must be a whole number.`);
    }
    if (asset.thumbnail !== undefined && typeof asset.thumbnail !== "boolean") {
      throw new IndexError(`${asset.sourcePath}: thumbnail must be true or false.`);
    }
    assets.push(
      known({
        sourcePath: asset.sourcePath,
        sha256: asset.sha256,
        name: asset.name,
        bytes: asset.bytes,
        thumbnail: asset.thumbnail
      })
    );
  }

  // The list beneath a start page is that page's choice; without one there is
  // no page to put it under, and the field would be a promise nobody keeps.
  if (index.homeList !== undefined && !home) {
    throw new IndexError("homeList needs a note that is the start page.");
  }

  return known({
    siteTitle: index.siteTitle,
    themeCss: index.themeCss,
    headerTags: index.headerTags,
    homeList: index.homeList,
    language: index.language,
    notes,
    assets
  });
}

/** The object without the fields that were not sent. */
function known(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
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
      notes: ordered.filter((note) => isListed(note) && note.tags?.includes(tag))
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
  // A note marked as the footer is drawn beneath every page and is no page
  // of its own; the rest are pages.
  const footerNote = index.notes.find((note) => note.footer) ?? null;
  const ordered = orderNotes(index.notes.filter(isListed));
  const site = lookups(index, options.thumbnails, PAGE_DEPTHS.note);
  const md = createRenderer(options);
  // A note marked as home is the start page, served from the site's root.
  const home = ordered.find((note) => note.home) ?? null;
  const siteLanguage = index.language ?? DEFAULT_LANGUAGE;

  // Rendered once for each depth a page sits at, since its links are relative.
  const footers = new Map();
  const footerAt = (up) => {
    if (!footerNote) return null;
    if (!footers.has(up)) {
      const source = sources.get(footerNote.sha256);
      if (source === undefined) {
        throw new IndexError(`Source not uploaded for ${footerNote.sourcePath}.`);
      }
      const lang = footerNote.language ?? siteLanguage;
      const rendered = renderMarkdown(md, source, lookups(index, options.thumbnails, up), {
        sourcePath: footerNote.sourcePath,
        lang,
        // The footer sits on a page beside that page's own text, whose
        // footnotes and headings would otherwise share its ids.
        idScope: "footer"
      });
      footers.set(up, { ...rendered, lang });
    }
    return footers.get(up);
  };

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

    // The start page sits one level higher than a note page, so its links
    // are resolved from there.
    const lang = note.language ?? siteLanguage;
    const rendered = renderMarkdown(
      md,
      source,
      note === home ? lookups(index, options.thumbnails, PAGE_DEPTHS.root) : site,
      { sourcePath: note.sourcePath, lang }
    );
    usedMath = usedMath || rendered.usedMath;
    usedMermaid = usedMermaid || rendered.usedMermaid;
    usedSlideshow = usedSlideshow || rendered.usedSlideshow;

    if (note === home) {
      files.set(
        "index.html",
        Buffer.from(
          homePage({
            note,
            body: rendered.html,
            siteTitle: index.siteTitle,
            list: index.homeList ? ordered.filter((other) => other !== home) : [],
            nav,
            icon,
            usedMath: rendered.usedMath,
            usedMermaid: rendered.usedMermaid,
            usedSlideshow: rendered.usedSlideshow,
            lang,
            footer: footerAt(PAGE_DEPTHS.root)
          }),
          "utf8"
        )
      );
      continue;
    }

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
          usedSlideshow: rendered.usedSlideshow,
          lang,
          footer: footerAt(PAGE_DEPTHS.note)
        }),
        "utf8"
      )
    );
  }

  if (!home) {
    files.set(
      "index.html",
      Buffer.from(
        indexPage({
          notes: ordered,
          siteTitle: index.siteTitle,
          nav,
          icon,
          lang: siteLanguage,
          footer: footerAt(PAGE_DEPTHS.root)
        }),
        "utf8"
      )
    );
  }
  for (const entry of nav) {
    files.set(
      entry.path,
      Buffer.from(
        tagPage({
          entry,
          siteTitle: index.siteTitle,
          nav,
          icon,
          lang: siteLanguage,
          footer: footerAt(PAGE_DEPTHS.tag)
        }),
        "utf8"
      )
    );
  }

  // The footer's needs count wherever it was drawn.
  for (const footer of footers.values()) {
    usedMath = usedMath || footer.usedMath;
    usedMermaid = usedMermaid || footer.usedMermaid;
    usedSlideshow = usedSlideshow || footer.usedSlideshow;
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
 * wikilinks are written. URLs are relative to the page the body is placed on:
 * `up` leads from there to the site's root, `../` from a note page and nothing
 * from the start page. A link to the start page leads to the root.
 */
function lookups(index, thumbnails = new Set(), up = PAGE_DEPTHS.note) {
  const notes = new Map();
  for (const note of index.notes) {
    // The footer has no page of its own, so a link to it is plain text, as a
    // link to an unpublished note is.
    if (!isListed(note)) continue;
    const entry = { url: noteHref(note, up), title: note.title, slug: note.slug };
    for (const alias of aliases(note.sourcePath)) notes.set(alias, entry);
  }

  const assets = new Map();
  for (const asset of index.assets) {
    // Named as the plan and the commit name it.
    const name = assetName(asset);
    const path = assetPath(asset.sha256, name);
    // The shared reading, which requires letters and digits: `video.mp 4`
    // used to count as an extension here and not in the route that admitted
    // it, so one file could be two kinds of thing.
    const extension = extensionOf(name);
    const entry = {
      url: `${up}${path}`,
      name,
      kind: VIDEO_EXTENSIONS.has(extension) ? "video" : "image"
    };
    const thumbnail = asset.thumbnail ? thumbnailPath(asset.sha256, name) : null;
    if (thumbnail && thumbnails.has(thumbnail)) entry.thumbnail = `${up}${thumbnail}`;
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
