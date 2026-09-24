/**
 * The page shell: one template for a note, one for the index, one stylesheet.
 *
 * Asset links are relative rather than root-relative, so a site served from a
 * subdirectory works without configuration. Dates are formatted by hand rather
 * than by `Intl`, because the output has to be identical on every machine that
 * runs the bridge, whatever locale data it happens to carry.
 */
import { escapeHtml } from "./obsidian.mjs";

export function notePage({
  note,
  body,
  siteTitle,
  usedMath,
  usedMermaid,
  usedSlideshow = false,
  hasIndex = true
}) {
  // A note is served from <slug>/index.html, so everything shared is one level up.
  const up = "../";
  return page({
    up,
    title: `${note.title} — ${siteTitle}`,
    description: note.description,
    siteTitle,
    usedMath,
    usedMermaid,
    usedSlideshow,
    hasIndex,
    main:
      `<article>\n` +
      // A note that opens with its own heading already says its title; adding
      // the template's would print it twice.
      (/^\s*<h1[\s>]/.test(body) ? "" : `<h1>${escapeHtml(note.title)}</h1>\n`) +
      metaLine(note.date) +
      body +
      `</article>\n`
  });
}

export function indexPage({ notes, siteTitle }) {
  const entries = notes
    .map(
      (note) =>
        `<li>\n` +
        `<a class="entry" href="${escapeHtml(note.slug)}/">${escapeHtml(note.title)}</a>\n` +
        metaLine(note.date) +
        (note.description ? `<p class="summary">${escapeHtml(note.description)}</p>\n` : "") +
        `</li>`
    )
    .join("\n");

  return page({
    up: "",
    title: siteTitle,
    description: "",
    siteTitle,
    usedMath: false,
    usedMermaid: false,
    hasIndex: false,
    main:
      notes.length > 0
        ? `<ul class="index">\n${entries}\n</ul>\n`
        : `<p class="empty">Noch nichts veröffentlicht.</p>\n`
  });
}

function page({
  up,
  title,
  description,
  siteTitle,
  usedMath,
  usedMermaid,
  usedSlideshow = false,
  hasIndex,
  main
}) {
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}">` : null,
    `<link rel="stylesheet" href="${up}assets/theme.css">`,
    usedMath ? `<link rel="stylesheet" href="${up}assets/katex/katex.css">` : null,
    usedSlideshow ? `<link rel="stylesheet" href="${up}assets/slideshow.css">` : null
  ].filter(Boolean);

  // Five megabytes, fetched when a diagram is actually about to be read rather
  // than on load. A reader who never scrolls that far never pays for it, and a
  // browser without IntersectionObserver simply loads it at once.
  const scripts = usedMermaid
    ? `<script>\n` +
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
      `})();\n` +
      `</script>\n`
    : "";

  // A module runs after the page has been parsed, so it finds every block,
  // and a browser that runs no scripts keeps the plain layouts.
  const slideshowScript = usedSlideshow
    ? `<script type="module" src="${up}assets/slideshow.js"></script>\n`
    : "";

  return (
    `<!doctype html>\n` +
    `<html lang="de">\n` +
    `<head>\n${head.join("\n")}\n</head>\n` +
    `<body>\n` +
    `<header class="site">${hasIndex ? `<a href="${up}">${escapeHtml(siteTitle)}</a>` : escapeHtml(siteTitle)}</header>\n` +
    `<main>\n${main}</main>\n` +
    scripts +
    slideshowScript +
    `</body>\n` +
    `</html>\n`
  );
}

function metaLine(date) {
  const formatted = formatDate(date);
  return formatted
    ? `<p class="meta"><time datetime="${escapeHtml(date)}">${formatted}</time></p>\n`
    : "";
}

/** `2026-09-12` becomes `12.09.2026`; anything else is left as it came. */
export function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
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

main { max-width: 42rem; margin: 0 auto; }

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

pre.mermaid { background: none; padding: 0; text-align: center; }
`;
