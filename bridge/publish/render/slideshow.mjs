/**
 * The plugin's ```schreibstube-slideshow``` block, on the published site.
 *
 * The block is read here a second time, after the plugin has read it in the
 * vault, and the two readings have to agree: a line the plugin shows as a
 * picture and the site drops, or the other way round, is a slideshow that
 * differs between the note and its page without anyone being told. The rules
 * are therefore the plugin's, and `contracts/slideshow-cases.json` holds the
 * examples both sides are tested against.
 *
 * What is written is plain HTML that reads without any script — a strip that
 * swipes, a grid, columns, two pictures side by side — and the site's own
 * `slideshow.js` turns it into the plugin's controls where scripts run. The
 * block's text is note text, so it is bounded and every value is escaped.
 */
import { escapeAttribute, escapeHtml } from "./html.mjs";

export const SLIDESHOW_LANGUAGE = "schreibstube-slideshow";

export const MIN_SLIDESHOW_IMAGES = 2;
export const MAX_SLIDESHOW_IMAGES = 100;

export const SLIDESHOW_LAYOUTS = [
  "slideshow",
  "filmstrip",
  "feature",
  "strip",
  "masonry",
  "compare"
];
export const DEFAULT_SLIDESHOW_LAYOUT = "slideshow";

const MAX_STRIP_COLUMNS = 4;
const STRIP_WRAP_COLUMNS = 3;

/** A feature is a scene and two details; a comparison is two sides. */
const LAYOUT_IMAGE_LIMIT = { feature: 3, compare: 2 };

const IMAGE_PATTERN = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const LAYOUT_PATTERN = /^layout\s*:\s*(.*)$/i;

/**
 * Reads the block into images and a layout, by the plugin's rules: one
 * Markdown image per line, blank lines and `//` comments ignored, a `layout:`
 * line anywhere, two to a hundred images. Anything else fails, naming the
 * line, as it does in the vault.
 */
export function parseSlideshow(source) {
  const lines = String(source).split(/\r?\n/);
  const images = [];
  let layout = DEFAULT_SLIDESHOW_LAYOUT;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("//")) continue;

    const option = LAYOUT_PATTERN.exec(line);
    if (option) {
      const chosen = parseLayout(option[1]);
      if (chosen === null) return { ok: false, line: i + 1, reason: "layout" };
      layout = chosen;
      continue;
    }

    const match = IMAGE_PATTERN.exec(line);
    if (!match) return { ok: false, line: i + 1, reason: "not-image" };

    const src = match[2].trim();
    if (src === "") return { ok: false, line: i + 1, reason: "empty-path" };
    if (images.length >= MAX_SLIDESHOW_IMAGES) return { ok: false, reason: "too-many" };
    images.push({ src, alt: match[1].trim() });
  }

  if (images.length < MIN_SLIDESHOW_IMAGES) return { ok: false, reason: "too-few" };
  return { ok: true, images, layout };
}

export function parseLayout(value) {
  const wanted = String(value).trim().toLowerCase();
  return SLIDESHOW_LAYOUTS.includes(wanted) ? wanted : null;
}

/** The first few images for a layout bounded by its shape, all for the rest. */
export function imagesForLayout(layout, images) {
  const limit = LAYOUT_IMAGE_LIMIT[layout];
  return limit === undefined ? [...images] : images.slice(0, limit);
}

/** Up to four tiles in a row; more wrap to rows of three, which read alike. */
export function stripColumns(count) {
  if (count <= 0) return 1;
  return count <= MAX_STRIP_COLUMNS ? count : STRIP_WRAP_COLUMNS;
}

/** What a screen reader hears for the block: the plugin's German labels. */
export function regionLabel(layout, count) {
  switch (layout) {
    case "feature":
      return `Szene mit Details, ${count} Bilder`;
    case "strip":
      return `Bildreihe, ${count} Bilder`;
    case "filmstrip":
      return `Diaschau mit Vorschaubildern, ${count} Bilder`;
    case "masonry":
      return `Bilderwand, ${count} Bilder`;
    case "compare":
      return "Vorher und nachher";
    default:
      return `Diaschau, ${count} Bilder`;
  }
}

/**
 * The block as HTML, given a way to find the published file for a path.
 *
 * Only pictures the site actually has are shown: an image that was not
 * published, a remote one — the plugin shows vault images only — or a video
 * is left out rather than drawn as an empty frame on a public page. What is
 * left decides the output: two or more are a slideshow, one is a plain
 * picture, none is nothing. A block the plugin would refuse is left off the
 * page; the vault already shows its author what is wrong with it.
 *
 * `slideshow` says whether the page needs the slideshow's stylesheet and
 * script.
 */
export function renderSlideshow(source, resolve) {
  const parsed = parseSlideshow(source);
  if (!parsed.ok) return { html: "", slideshow: false };

  const published = [];
  for (const image of parsed.images) {
    const asset = resolve(image.src);
    if (asset && asset.kind !== "video") published.push({ url: asset.url, alt: image.alt });
  }

  const images = imagesForLayout(parsed.layout, published);
  if (images.length === 0) return { html: "", slideshow: false };
  if (images.length === 1) {
    return { html: `<p>${imageTag(images[0])}</p>\n`, slideshow: false };
  }

  const layout = parsed.layout;
  const style =
    layout === "strip" ? ` style="--slideshow-columns: ${stripColumns(images.length)}"` : "";
  const items = images
    .map((image) => {
      const label =
        layout === "compare" && image.alt
          ? `<span class="slideshow-label">${escapeHtml(image.alt)}</span>`
          : "";
      return `<div class="slideshow-item">${imageTag(image)}${label}</div>`;
    })
    .join("\n");

  return {
    html:
      `<figure class="slideshow slideshow-${layout}" data-layout="${layout}" role="group" ` +
      `aria-label="${escapeAttribute(regionLabel(layout, images.length))}"${style}>\n` +
      `<div class="slideshow-items">\n${items}\n</div>\n` +
      `</figure>\n`,
    slideshow: true
  };
}

function imageTag({ url, alt }) {
  return `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async">`;
}
