/**
 * Remote path rules.
 *
 * The bridge writes files to someone's web root over SFTP, so every path it
 * touches is validated here and nowhere else. A name that came out of a vault
 * is never used as a path on its own: it is slugified and prefixed with a
 * content hash, so a note called `../../etc/passwd.png` is just an oddly named
 * file.
 *
 * Everything in this module is a pure function, which is why it is the part of
 * the publish capability with the most tests.
 */

/** Output files the bridge itself may write. Uploaded assets are checked
 *  against the target's own list, which is narrower still. */
export const OUTPUT_EXTENSIONS = new Set([
  "html",
  "css",
  "js",
  "json",
  "txt",
  "xml",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "mp4",
  "webm",
  "ogv",
  "mov",
  "m4v"
]);

export const MAX_PATH_BYTES = 1024;
export const MAX_SEGMENT_BYTES = 255;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DIACRITICS = /[\u0300-\u036f]/g;

export class PathError extends Error {}

/** Whether a slug chosen in the vault is safe to become a directory name. */
export function isValidSlug(slug) {
  return typeof slug === "string" && slug.length <= 80 && SLUG_PATTERN.test(slug);
}

/**
 * Reduce a name to something that can appear in a URL.
 *
 * German umlauts are transliterated rather than stripped, because a slug that
 * loses its vowels reads as a mistake rather than as a name.
 */
export function slugify(value) {
  const transliterated = String(value ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(DIACRITICS, "");

  const slug = transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug || "datei";
}

/** The extension of a name, lowercased, without the dot. */
export function extensionOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ""));
  return match ? match[1].toLowerCase() : "";
}

/**
 * Where an uploaded asset is served from.
 *
 * Content-addressed, so an image whose content changes gets a new URL and no
 * cache can serve the old one. The original name survives only as a readable
 * suffix, which is the part a person recognises in a link.
 */
export function assetPath(sha256, name) {
  const extension = extensionOf(name);
  const stem = slugify(String(name).replace(/\.[A-Za-z0-9]+$/, ""));
  const short = String(sha256).slice(0, 12);
  return extension ? `assets/${short}-${stem}.${extension}` : `assets/${short}-${stem}`;
}

/** Where a note is served from. */
export function pagePath(slug) {
  if (!isValidSlug(slug)) {
    throw new PathError(`Unusable slug: ${JSON.stringify(slug)}`);
  }
  return `${slug}/index.html`;
}

/**
 * Validate a path the bridge is about to write, relative to a target root.
 *
 * Rejects anything that could leave the root, anything that could confuse a
 * shell or a filesystem, and anything whose extension the target does not
 * serve. Returns the path unchanged, so callers can use it as an expression.
 */
export function checkRelativePath(path, { extensions = OUTPUT_EXTENSIONS } = {}) {
  if (typeof path !== "string" || path.length === 0) {
    throw new PathError("A path is required.");
  }
  if (Buffer.byteLength(path) > MAX_PATH_BYTES) {
    throw new PathError(`Path exceeds ${MAX_PATH_BYTES} bytes.`);
  }
  if (path.startsWith("/")) {
    throw new PathError("Path must be relative.");
  }
  if (path.includes("\\")) {
    throw new PathError("Path must not contain backslashes.");
  }
  if (CONTROL_CHARACTERS.test(path)) {
    throw new PathError("Path must not contain control characters.");
  }

  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new PathError(`Unusable path segment in ${JSON.stringify(path)}.`);
    }
    if (Buffer.byteLength(segment) > MAX_SEGMENT_BYTES) {
      throw new PathError(`Path segment exceeds ${MAX_SEGMENT_BYTES} bytes.`);
    }
  }

  const extension = extensionOf(segments[segments.length - 1]);
  if (!extensions.has(extension)) {
    throw new PathError(`Extension not allowed: ${extension || "(none)"}.`);
  }

  return path;
}

/** Join a validated relative path onto an absolute root. */
export function joinRemote(root, relative) {
  checkRelativePath(relative);
  return `${root.replace(/\/+$/, "")}/${relative}`;
}

/** The directories a set of paths needs, shallowest first, each one once. */
export function directoriesFor(paths) {
  const directories = new Set();
  for (const path of paths) {
    const segments = path.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      directories.add(current);
    }
  }
  return [...directories].sort((a, b) => a.split("/").length - b.split("/").length);
}
