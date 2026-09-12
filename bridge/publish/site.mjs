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
import { indexPage, notePage } from "./render/page.mjs";
import { assetPath, isValidSlug, pagePath, slugify } from "./path.mjs";
import { generatorAssets } from "./assets.mjs";
import { key } from "./render/obsidian.mjs";

export class IndexError extends Error {}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogv", "mov", "m4v"]);

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
  }

  for (const asset of index.assets) {
    if (!asset?.sourcePath) throw new IndexError("An asset is missing its sourcePath.");
    if (!isHash(asset.sha256)) throw new IndexError(`${asset.sourcePath}: missing content hash.`);
  }

  return index;
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
  const site = lookups(index);
  const md = createRenderer(options);

  const files = new Map();
  let usedMath = false;
  let usedMermaid = false;

  for (const note of ordered) {
    const source = sources.get(note.sha256);
    if (source === undefined) {
      throw new IndexError(`Source not uploaded for ${note.sourcePath}.`);
    }

    const rendered = renderMarkdown(md, source, site);
    usedMath = usedMath || rendered.usedMath;
    usedMermaid = usedMermaid || rendered.usedMermaid;

    files.set(
      pagePath(note.slug),
      Buffer.from(
        notePage({
          note,
          body: rendered.html,
          siteTitle: index.siteTitle,
          usedMath: rendered.usedMath,
          usedMermaid: rendered.usedMermaid
        }),
        "utf8"
      )
    );
  }

  files.set(
    "index.html",
    Buffer.from(indexPage({ notes: ordered, siteTitle: index.siteTitle }), "utf8")
  );

  for (const [path, content] of await generatorAssets({
    math: usedMath,
    mermaid: usedMermaid,
    theme: index.themeCss
  })) {
    files.set(path, content);
  }

  return files;
}

/**
 * The tables the Obsidian rules resolve links against.
 *
 * Both a full vault path and a bare file name resolve, because that is how
 * wikilinks are written. URLs are relative to a note page, which is the only
 * place a rendered body is ever placed.
 */
function lookups(index) {
  const notes = new Map();
  for (const note of index.notes) {
    const entry = { url: `../${note.slug}/`, title: note.title, slug: note.slug };
    for (const alias of aliases(note.sourcePath)) notes.set(alias, entry);
  }

  const assets = new Map();
  for (const asset of index.assets) {
    const name = asset.name ?? basename(asset.sourcePath);
    const path = assetPath(asset.sha256, name);
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    const entry = {
      url: `../${path}`,
      name,
      kind: VIDEO_EXTENSIONS.has(extension) ? "video" : "image"
    };
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
