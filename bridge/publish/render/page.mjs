/**
 * The page shell: one template for a note, one for the index, one for a note
 * that is the start page, one stylesheet. Every page carries its language and,
 * when the site has one, the footer note beneath its content.
 *
 * Asset links are relative rather than root-relative, so a site served from a
 * subdirectory works without configuration. Dates are formatted by hand rather
 * than by `Intl`, because the output has to be identical on every machine that
 * runs the bridge, whatever locale data it happens to carry.
 */
import { escapeHtml } from "./obsidian.mjs";
import { noteHref } from "../path.mjs";
import { DEFAULT_LANGUAGE, isGerman } from "./language.mjs";

/**
 * How far each kind of page sits below the site's root, as the `up` that
 * leads back: the start page and the list at the root, a note one level
 * down, a tag page two. The content security policy allows the diagram
 * loader for each of them, so every template takes its depth from here.
 */
export const PAGE_DEPTHS = Object.freeze({ root: "", note: "../", tag: "../../" });

export function notePage({
  note,
  body,
  siteTitle,
  usedMath,
  usedMermaid,
  usedSlideshow = false,
  hasIndex = true,
  nav = [],
  icon = null,
  lang = DEFAULT_LANGUAGE,
  footer = null
}) {
  // A note is served from <slug>/index.html, so everything shared is one level up.
  return page({
    up: PAGE_DEPTHS.note,
    lang,
    footer,
    title: `${note.title} — ${siteTitle}`,
    description: note.description,
    siteTitle,
    nav,
    icon,
    usedMath,
    usedMermaid,
    usedSlideshow,
    hasIndex,
    main: article(note, body, metaLine(note.date, lang))
  });
}

export function indexPage({
  notes,
  siteTitle,
  nav = [],
  icon = null,
  lang = DEFAULT_LANGUAGE,
  footer = null
}) {
  return page({
    up: PAGE_DEPTHS.root,
    lang,
    footer,
    title: siteTitle,
    description: "",
    siteTitle,
    nav,
    icon,
    usedMath: false,
    usedMermaid: false,
    hasIndex: false,
    main:
      notes.length > 0
        ? `<ul class="index">\n${listEntries(notes, PAGE_DEPTHS.root, lang)}\n</ul>\n`
        : `<p class="empty">${words(lang).empty}</p>\n`
  });
}

/**
 * The start page when a note is marked as home: the note's own text, and the
 * other notes beneath it when the note asks for them. It is the front door
 * rather than an entry, so it carries no date, and its title is the note's
 * alone. Served from the site's root, so nothing is up.
 */
export function homePage({
  note,
  body,
  siteTitle,
  list = [],
  nav = [],
  icon = null,
  usedMath,
  usedMermaid,
  usedSlideshow = false,
  lang = DEFAULT_LANGUAGE,
  footer = null
}) {
  return page({
    up: PAGE_DEPTHS.root,
    lang,
    footer,
    title: note.title,
    description: note.description,
    siteTitle,
    nav,
    icon,
    usedMath,
    usedMermaid,
    usedSlideshow,
    hasIndex: false,
    main:
      article(note, body) +
      (list.length > 0
        ? `<ul class="index">\n${listEntries(list, PAGE_DEPTHS.root, lang)}\n</ul>\n`
        : "")
  });
}

/**
 * A note's text as a page carries it, under the note's title unless the text
 * opens with a heading of its own, which would print the title twice. `meta`
 * is the date line, where the page has one.
 */
function article(note, body, meta = "") {
  return (
    `<article>\n` +
    (/^\s*<h1[\s>]/.test(body) ? "" : `<h1>${escapeHtml(note.title)}</h1>\n`) +
    meta +
    body +
    `</article>\n`
  );
}

/**
 * A header tag's page: the notes carrying it, listed as the start page lists
 * them. Served from tag/<slug>/index.html, so everything shared is two up.
 */
export function tagPage({
  entry,
  siteTitle,
  nav = [],
  icon = null,
  lang = DEFAULT_LANGUAGE,
  footer = null
}) {
  const up = PAGE_DEPTHS.tag;
  return page({
    up,
    lang,
    footer,
    title: `${entry.label} — ${siteTitle}`,
    description: "",
    siteTitle,
    nav,
    icon,
    current: entry.slug,
    usedMath: false,
    usedMermaid: false,
    hasIndex: true,
    main:
      `<h1 class="tag-title">${escapeHtml(entry.label)}</h1>\n` +
      `<ul class="index">\n${listEntries(entry.notes, up, lang)}\n</ul>\n`
  });
}

function listEntries(notes, up, lang) {
  return notes
    .map(
      (note) =>
        `<li>\n` +
        `<a class="entry" href="${escapeHtml(noteHref(note, up))}">${escapeHtml(note.title)}</a>\n` +
        metaLine(note.date, lang) +
        (note.description ? `<p class="summary">${escapeHtml(note.description)}</p>\n` : "") +
        `</li>`
    )
    .join("\n");
}

/**
 * The header tags as links. Nothing at all without them, so a site that sets
 * none has the header it always had. The one being looked at is marked, for
 * the eye and for a screen reader.
 */
function headerTags(nav, up, current, lang) {
  if (nav.length === 0) return "";
  const links = nav
    .map(
      (entry) =>
        `<a href="${up}tag/${escapeHtml(entry.slug)}/"` +
        (entry.slug === current ? ' aria-current="page"' : "") +
        `>${escapeHtml(entry.label)}</a>`
    )
    .join("");
  return `<nav class="site-tags" aria-label="${words(lang).tags}">${links}</nav>`;
}

function page({
  up,
  lang = DEFAULT_LANGUAGE,
  footer = null,
  title,
  description,
  siteTitle,
  nav = [],
  current = null,
  icon = null,
  usedMath,
  usedMermaid,
  usedSlideshow = false,
  hasIndex,
  main
}) {
  // The footer is part of every page, so what it needs the page loads too.
  usedMath = usedMath || Boolean(footer?.usedMath);
  usedMermaid = usedMermaid || Boolean(footer?.usedMermaid);
  usedSlideshow = usedSlideshow || Boolean(footer?.usedSlideshow);

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}">` : null,
    icon
      ? `<link rel="icon" href="${up}${escapeHtml(icon.path)}" type="${escapeHtml(icon.type)}">`
      : null,
    `<link rel="stylesheet" href="${up}assets/theme.css">`,
    usedMath ? `<link rel="stylesheet" href="${up}assets/katex/katex.css">` : null,
    usedSlideshow ? `<link rel="stylesheet" href="${up}assets/slideshow.css">` : null
  ].filter(Boolean);

  const scripts = usedMermaid ? `<script>${mermaidLoader(up)}</script>\n` : "";

  // A module runs after the page has been parsed, so it finds every block,
  // and a browser that runs no scripts keeps the plain layouts.
  const slideshowScript = usedSlideshow
    ? `<script type="module" src="${up}assets/slideshow.js"></script>\n`
    : "";

  return (
    `<!doctype html>\n` +
    `<html lang="${escapeHtml(lang)}">\n` +
    `<head>\n${head.join("\n")}\n</head>\n` +
    `<body>\n` +
    `<header class="site">${hasIndex ? `<a href="${up}">${escapeHtml(siteTitle)}</a>` : escapeHtml(siteTitle)}${headerTags(nav, up, current, lang)}</header>\n` +
    `<main>\n${main}</main>\n` +
    (footer ? footerTag(footer, lang) : "") +
    scripts +
    slideshowScript +
    `</body>\n` +
    `</html>\n`
  );
}

/**
 * The footer note beneath the page's content. Its text is in its own
 * language, which a screen reader is told where it is not the page's.
 */
function footerTag(footer, lang) {
  const own = footer.lang && footer.lang !== lang ? ` lang="${escapeHtml(footer.lang)}"` : "";
  return `<footer class="site"${own}>\n${footer.html}</footer>\n`;
}

/**
 * The page's one inline script, as it stands between its tags.
 *
 * Five megabytes, fetched when a diagram is actually about to be read rather
 * than on load. A reader who never scrolls that far never pays for it, and a
 * browser without IntersectionObserver simply loads it at once. Exported for
 * the site's content security policy, which names it by its hash.
 */
export function mermaidLoader(up) {
  return (
    `\n` +
    `(function () {\n` +
    `  var blocks = document.querySelectorAll("pre.mermaid");\n` +
    `  if (!blocks.length) return;\n` +
    `  var loaded = false;\n` +
    `  function load() {\n` +
    `    if (loaded) return;\n` +
    `    loaded = true;\n` +
    `    var s = document.createElement("script");\n` +
    `    s.src = "${up}assets/mermaid.min.js";\n` +
    `    s.onload = function () {\n` +
    `      mermaid.initialize({ startOnLoad: true, securityLevel: "strict" });\n` +
    `    };\n` +
    `    document.head.appendChild(s);\n` +
    `  }\n` +
    `  if (!("IntersectionObserver" in window)) return load();\n` +
    `  var watcher = new IntersectionObserver(function (entries) {\n` +
    `    if (entries.some(function (e) { return e.isIntersecting; })) {\n` +
    `      watcher.disconnect();\n` +
    `      load();\n` +
    `    }\n` +
    `  }, { rootMargin: "400px" });\n` +
    `  blocks.forEach(function (block) { watcher.observe(block); });\n` +
    `})();\n`
  );
}

function metaLine(date, lang) {
  const formatted = formatDate(date, lang);
  return formatted
    ? `<p class="meta"><time datetime="${escapeHtml(date)}">${formatted}</time></p>\n`
    : "";
}

/**
 * `2026-09-12` becomes `12.09.2026` on a German page and stays `2026-09-12`
 * on any other, where the day and the month would otherwise trade places in
 * the reader's head; anything that is no date gives nothing.
 */
export function formatDate(value, lang = DEFAULT_LANGUAGE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!match) return "";
  return isGerman(lang)
    ? `${match[3]}.${match[2]}.${match[1]}`
    : `${match[1]}-${match[2]}-${match[3]}`;
}

/** The few words the templates write themselves, in German or else English. */
function words(lang) {
  return isGerman(lang)
    ? { tags: "Schlagwörter", empty: "Noch nichts veröffentlicht." }
    : { tags: "Tags", empty: "Nothing published yet." };
}

export const THEME_CSS = `:root {
  color-scheme: light dark;
  --ink: #1b1b1b;
  --muted: #5d5d5d;
  --ground: #fdfdfc;
  --edge: #e2e0da;
  --accent: #7a5c3e;
  --code: #f3f1ec;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8e6e1;
    --muted: #a6a29a;
    --ground: #16161a;
    --edge: #2e2e34;
    --accent: #cbab86;
    --code: #1f1f25;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0 1.25rem 4rem;
  background: var(--ground);
  color: var(--ink);
  font: 1rem/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

header.site {
  max-width: 42rem;
  margin: 0 auto;
  padding: 1.75rem 0 1.25rem;
  border-bottom: 1px solid var(--edge);
  font-weight: 600;
}

header.site a { color: inherit; text-decoration: none; }

header.site:has(.site-tags) {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1.25rem;
}

.site-tags { display: flex; flex-wrap: wrap; gap: 0.25rem 1.1rem; font-weight: 400; }
.site-tags a { color: var(--muted); }
.site-tags a:hover, .site-tags a[aria-current="page"] { color: var(--accent); }

.tag-title { margin-bottom: 1rem; }

main { max-width: 42rem; margin: 0 auto; }

footer.site {
  max-width: 42rem;
  margin: 3rem auto 0;
  padding-top: 1.25rem;
  border-top: 1px solid var(--edge);
  color: var(--muted);
  font-size: 0.9rem;
}

footer.site a { color: inherit; }
footer.site > :last-child { margin-bottom: 0; }

h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2rem 0 0.75rem; }
h1 { font-size: 1.9rem; margin-top: 2.5rem; }

p, ul, ol, dl, table, blockquote, pre, figure { margin: 0 0 1.1rem; }

a { color: var(--accent); }

.meta { color: var(--muted); font-size: 0.875rem; margin-top: -0.35rem; }
.summary { color: var(--muted); margin: 0.2rem 0 0; }

ul.index { list-style: none; padding: 0; }
ul.index li { padding: 1.1rem 0; border-bottom: 1px solid var(--edge); }
ul.index .entry { font-size: 1.15rem; font-weight: 600; text-decoration: none; }
.empty { color: var(--muted); }

img, video { max-width: 100%; height: auto; border-radius: 4px; }

pre {
  background: var(--code);
  padding: 0.9rem 1rem;
  overflow-x: auto;
  border-radius: 4px;
}

code { background: var(--code); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
pre code { background: none; padding: 0; }

blockquote {
  margin-left: 0;
  padding-left: 1rem;
  border-left: 3px solid var(--edge);
  color: var(--muted);
}

table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--edge); padding: 0.4rem 0.6rem; text-align: left; }

.callout, details.callout {
  border: 1px solid var(--edge);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  padding: 0.85rem 1rem;
  color: inherit;
  margin: 0 0 1.1rem;
}

.callout-title, details.callout summary { font-weight: 600; margin: 0 0 0.4rem; cursor: default; }
details.callout summary { cursor: pointer; }
.callout > :last-child, details.callout > :last-child { margin-bottom: 0; }

.callout-warning, details.callout-warning { border-left-color: #c08a2e; }
.callout-danger, details.callout-danger { border-left-color: #b4534a; }
.callout-tip, details.callout-tip { border-left-color: #4f8a6b; }

.footnotes { border-top: 1px solid var(--edge); font-size: 0.9rem; color: var(--muted); }

.schreibstube-index { color: var(--muted); margin: 0 0 1.1rem; }
.schreibstube-index summary { cursor: pointer; }
.schreibstube-index strong { color: var(--ink); }
.schreibstube-index ul { list-style: none; margin: 0.25rem 0 0; padding-left: 1.25rem; }
.schreibstube-index > ul { padding-left: 0; }
.schreibstube-index li { margin: 0.15rem 0; }

pre.mermaid { background: none; padding: 0; text-align: center; }
`;
