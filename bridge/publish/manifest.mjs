/**
 * The manifest: what the bridge has published, and what that lets it delete.
 *
 * It is the reason a publish can mirror deletions without ever endangering a
 * file the bridge did not write. Anything on the host that is not in here is
 * somebody else's, and is left alone.
 *
 * Written last, always. A crash before that leaves it describing the previous
 * state, so the next publish re-uploads and re-renders; the cost is wasted work
 * rather than a lost file.
 */
import { assetPath, pagePath, tagPagePath, thumbnailPath } from "./path.mjs";

export const MANIFEST_VERSION = 1;

/** Uploaded assets and their thumbnails are recognisable by their names. */
const UPLOADED_ASSET = /^assets\/(thumbs\/)?[0-9a-f]{12}-/;

export function emptyManifest(target) {
  return {
    version: MANIFEST_VERSION,
    target,
    updatedAt: null,
    generator: null,
    renderVersion: null,
    files: {}
  };
}

/** A manifest from the host, reduced to something safe to reason about. */
export function normalizeManifest(raw, target) {
  if (!raw || typeof raw !== "object" || raw.version !== MANIFEST_VERSION) {
    return emptyManifest(target);
  }
  return { ...emptyManifest(target), ...raw, files: raw.files ?? {} };
}

/**
 * What has to be uploaded before the site can be built, and what will go.
 *
 * Sources are addressed by content, so "already uploaded" is a question about
 * hashes rather than about paths: a renamed note whose text did not change
 * uploads nothing at all.
 */
export function planUploads({ index, manifest, storedSourceHashes }) {
  const stored = new Set(storedSourceHashes);

  const uploadSources = [];
  const seen = new Set();
  for (const note of index.notes) {
    if (stored.has(note.sha256) || seen.has(note.sha256)) continue;
    seen.add(note.sha256);
    uploadSources.push({ sourcePath: note.sourcePath, sha256: note.sha256 });
  }

  const published = new Set(Object.keys(manifest.files ?? {}));
  const uploadAssets = [];
  const expectedAssets = new Set();
  for (const asset of index.assets) {
    const path = assetPath(asset.sha256, asset.name ?? asset.sourcePath);
    expectedAssets.add(path);
    if (published.has(path)) continue;
    uploadAssets.push({
      sourcePath: asset.sourcePath,
      sha256: asset.sha256,
      name: asset.name ?? asset.sourcePath,
      bytes: asset.bytes ?? 0,
      path
    });
  }

  // A thumbnail is named after its picture, so one the site already has is
  // current, and only the missing ones are asked for.
  const uploadThumbnails = [];
  for (const asset of index.assets) {
    if (asset.thumbnail !== true) continue;
    const path = thumbnailPath(asset.sha256, asset.name ?? asset.sourcePath);
    if (!path || expectedAssets.has(path)) continue;
    expectedAssets.add(path);
    if (published.has(path)) continue;
    uploadThumbnails.push({
      sourcePath: asset.sourcePath,
      sha256: asset.sha256,
      name: asset.name ?? asset.sourcePath,
      path
    });
  }

  // Only pages and uploaded assets can be judged before rendering. Generator
  // assets — the stylesheet, the fonts, the diagram bundle — depend on what the
  // pages turn out to use, so they are settled at commit.
  const expectedPages = new Set(index.notes.map((note) => pagePath(note.slug)));
  // A header tag's page is the site's own, like a note's, as long as a note
  // carries the tag.
  for (const tag of index.headerTags ?? []) {
    if (index.notes.some((note) => note.tags?.includes(tag))) expectedPages.add(tagPagePath(tag));
  }
  const willDelete = [...published].filter((path) => {
    if (path === "index.html") return false;
    if (path.endsWith("/index.html")) return !expectedPages.has(path);
    if (UPLOADED_ASSET.test(path)) return !expectedAssets.has(path);
    return false;
  });

  return {
    uploadSources,
    uploadAssets,
    uploadThumbnails,
    willDelete: willDelete.sort(),
    unchangedSources: index.notes.length - uploadSources.length,
    notes: index.notes.length
  };
}

/**
 * Compare freshly built output against what is published.
 *
 * Rendering is total but writing is not: a page that came out byte-identical is
 * left alone, which is what keeps a re-publish of fifty unchanged notes down to
 * a manifest write.
 */
export function diffOutputs(files, manifest, hash, uploaded = new Map()) {
  const published = manifest.files ?? {};
  const write = [];
  const unchanged = [];

  for (const [path, content] of files) {
    if (published[path]?.sha256 === hash(content)) {
      unchanged.push(path);
    } else {
      write.push(path);
    }
  }

  // Assets are already on the host: their own upload put them there, and the
  // manifest records them so that they can be removed later.
  for (const path of uploaded.keys()) {
    if (published[path]) unchanged.push(path);
  }

  const remove = Object.keys(published).filter((path) => !files.has(path) && !uploaded.has(path));
  return { write: write.sort(), unchanged: unchanged.sort(), delete: remove.sort() };
}

export function buildManifest({
  target,
  files,
  hash,
  renderVersion,
  generator,
  uploaded = new Map()
}) {
  const entries = {};
  for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    entries[path] = { sha256: hash(content), bytes: content.length };
  }
  for (const [path, entry] of [...uploaded].sort(([a], [b]) => a.localeCompare(b))) {
    entries[path] = entry;
  }

  return {
    version: MANIFEST_VERSION,
    target,
    updatedAt: new Date().toISOString(),
    generator,
    renderVersion,
    files: entries
  };
}

/** Source files no longer referenced by the index, so they can be collected. */
export function orphanSources(storedSourceHashes, index) {
  const wanted = new Set(index.notes.map((note) => note.sha256));
  return storedSourceHashes.filter((hash) => !wanted.has(hash)).sort();
}
