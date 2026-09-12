/**
 * The Markdown pipeline.
 *
 * Rendering lives on the bridge rather than in the plugin so that it is a pure
 * function of the source and the site index: the same note produces the same
 * bytes from a phone, from a laptop, and from a re-render months later with no
 * vault in reach. That is also what makes it testable.
 */
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import taskLists from "markdown-it-task-lists";
import katexModule from "@vscode/markdown-it-katex";
import { obsidian } from "./obsidian.mjs";
import { slugify } from "../path.mjs";

/** Bumped when the output of a given source would change. A changed version
 *  re-renders every page on the next commit, without re-uploading anything. */
export const RENDER_VERSION = 1;

const katex = katexModule.default ?? katexModule;

export function createRenderer() {
  return new MarkdownIt({
    // The author is publishing their own vault to their own site, so inline
    // HTML is theirs to write, exactly as it is inside Obsidian.
    html: true,
    linkify: true,
    breaks: false,
    typographer: false
  })
    .use(footnote)
    .use(deflist)
    .use(mark)
    .use(sub)
    .use(sup)
    .use(taskLists, { label: false })
    .use(anchor, { slugify, tabIndex: false })
    .use(katex, { throwOnError: false })
    .use(obsidian);
}

/**
 * Render one note.
 *
 * `site` carries the lookup tables the Obsidian rules need. The returned flags
 * say which generator assets the page has to load, so a site without diagrams
 * never ships a diagram bundle.
 */
export function renderMarkdown(md, source, site) {
  const env = { site, usedMermaid: false };
  const html = md.render(prepare(source), env);
  return {
    html,
    usedMermaid: env.usedMermaid === true,
    usedMath: html.includes('class="katex')
  };
}

/** Frontmatter is metadata and never reaches the page; comments never render. */
export function prepare(source) {
  return stripComments(stripFrontmatter(String(source)));
}

export function stripFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  return match ? source.slice(match[0].length) : source;
}

/**
 * `%%…%%` disappears, including across lines.
 *
 * Hiding it with CSS would leave it in the served HTML, where a comment written
 * for oneself is one "view source" away from being published.
 */
export function stripComments(source) {
  return source.replace(/%%[\s\S]*?%%/g, "");
}
