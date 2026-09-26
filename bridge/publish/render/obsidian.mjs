/**
 * The Obsidian-specific Markdown rules.
 *
 * Everything here is syntax that means something in a vault and nothing in
 * CommonMark: wikilinks, embeds, callouts and comments. Each one is a token
 * transformation, so the output is a pure function of the source and the site
 * index, and can be snapshot-tested.
 *
 * Link resolution needs the index because the bridge has no vault: it is told
 * which notes exist, what they are called and where they will be served.
 */

import { escapeAttribute, escapeHtml } from "./html.mjs";
import { renderSlideshow, SLIDESHOW_LANGUAGE } from "./slideshow.mjs";

// Kept importable from here, where the page template has always found it.
export { escapeHtml };

const CALLOUT = /^\[!([A-Za-z]+)\]([+-]?)[ \t]*(.*)$/;

export function obsidian(md, { allowDiagrams = true } = {}) {
  md.inline.ruler.before("link", "wikilink", wikilink);
  md.core.ruler.after("block", "callout", callouts);
  md.core.ruler.after("inline", "vault-image", vaultImages);
  overrideFence(md, allowDiagrams);
  overrideLinks(md);
}

/**
 * `[[Note]]`, `[[Note|alias]]`, `[[Note#Abschnitt]]` and their embedded forms.
 *
 * A link to a note that is not published becomes plain text. A dead link on a
 * public site is worse than a missing one, and silently publishing the note
 * instead would be worse still.
 */
function wikilink(state, silent) {
  const start = state.pos;
  const src = state.src;
  let pos = start;

  const embed = src.charCodeAt(pos) === 0x21; /* ! */
  if (embed) pos += 1;

  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;

  const close = src.indexOf("]]", pos + 2);
  if (close < 0) return false;

  const body = src.slice(pos + 2, close);
  if (body.includes("\n") || body.includes("[[")) return false;

  if (!silent) {
    const [rawTarget, rawAlias] = splitOnce(body, "|");
    const [path, heading] = splitOnce(rawTarget.trim(), "#");
    const alias = rawAlias?.trim();
    const site = state.env?.site ?? emptySite();

    if (embed) {
      pushEmbed(state, { path, alias, site });
    } else {
      pushLink(state, { path, heading, alias, site });
    }
  }

  state.pos = close + 2;
  return true;
}

function pushEmbed(state, { path, alias, site }) {
  const { label, ...size } = splitSize(alias ?? "");
  const asset = site.assets?.get(key(path));
  if (asset) {
    if (asset.kind === "video") {
      const token = state.push("html_inline", "", 0);
      token.content = videoTag(asset.url, size);
      return;
    }
    const token = state.push("image", "img", 0);
    token.attrs = [
      ["src", asset.url],
      ["alt", ""],
      ["loading", "lazy"]
    ];
    setCaption(state, token, label || asset.name);
    applySize(token, size);
    // Already pointing at the published file; the Markdown image rule would
    // otherwise look its URL up as a vault path and find nothing.
    token.meta = { resolved: true };
    return;
  }

  // An embedded note is linked rather than inlined: inlining would duplicate a
  // page that is published in its own right, and would need loop detection.
  const note = site.notes?.get(key(path));
  if (note) {
    pushAnchor(state, note.url, label || note.title);
    return;
  }

  pushText(state, label || path);
}

/** Pictures are never set wider or taller than this, whatever a note asks. */
export const MAX_DIMENSION = 10_000;

/**
 * Obsidian's size, written after the last `|`: `300` for a width, `300x200`
 * for a width and a height. `![[bild.png|300]]` and `![Haus|300](bild.png)`
 * mean it the same way; whatever comes before the size is the alt text. Text
 * that ends in no size is all alt text, as it always was.
 */
export function splitSize(text) {
  const match = /^(?:([\s\S]*)\|)?\s*(\d{1,5})(?:\s*x\s*(\d{1,5}))?\s*$/.exec(String(text));
  if (!match) return { label: String(text) };
  const width = Number(match[2]);
  const height = match[3] === undefined ? undefined : Number(match[3]);
  if (width < 1 || width > MAX_DIMENSION) return { label: String(text) };
  if (height !== undefined && (height < 1 || height > MAX_DIMENSION)) {
    return { label: String(text) };
  }
  return { label: (match[1] ?? "").trim(), width, ...(height ? { height } : {}) };
}

// markdown-it renders an image's alt text from the token's children, not
// from its attribute, so the children are what has to change.
function setCaption(state, token, alt) {
  const caption = new state.Token("text", "", 0);
  caption.content = alt;
  token.children = [caption];
  token.content = alt;
}

// Attributes rather than a style: the theme's max-width still holds, so a
// picture sized wider than the column is not pushed past it.
function applySize(token, { width, height }) {
  if (width) token.attrSet("width", String(width));
  if (height) token.attrSet("height", String(height));
}

function videoTag(url, { width, height } = {}) {
  const size = (width ? ` width="${width}"` : "") + (height ? ` height="${height}"` : "");
  return `<video class="embed" controls preload="metadata" src="${escapeAttribute(url)}"${size}></video>`;
}

/**
 * `![alt](bild.png)`, the other way a vault embeds an image.
 *
 * The plugin uploads the file under a content-addressed name, so the path as
 * written names nothing on the site and has to be looked up like an embed. A
 * local image that was not published degrades to its alt text, as an embed
 * does: on a static site there is nothing else at a relative path it could
 * mean. A remote image is left exactly as written.
 */
function vaultImages(state) {
  const site = state.env?.site ?? emptySite();
  const notePath = state.env?.sourcePath ?? "";

  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;

    block.children = block.children.map((token) => {
      if (token.type !== "image" || token.meta?.resolved) return token;
      const src = token.attrGet("src") ?? "";
      const { label, ...size } = splitSize(token.content);
      const sized = size.width !== undefined;
      if (sized) {
        setCaption(state, token, label);
        applySize(token, size);
      }
      // Sized or not, a remote picture keeps its address.
      if (isRemote(src)) return token;

      const asset = findAsset(site, src, notePath);
      const alt = sized ? label : token.content;

      if (!asset) {
        const text = new state.Token("text", "", 0);
        text.content = alt || decodeReference(src);
        return text;
      }

      if (asset.kind === "video") {
        const video = new state.Token("html_inline", "", 0);
        video.content = videoTag(asset.url, size);
        return video;
      }

      token.attrSet("src", asset.url);
      token.attrSet("loading", "lazy");
      if (!alt) setCaption(state, token, asset.name);
      return token;
    });
  }
}

/** The published file a vault image path stands for, or undefined. */
function findAsset(site, src, notePath) {
  return assetCandidates(src, notePath)
    .map((candidate) => site.assets?.get(key(candidate)))
    .find(Boolean);
}

/**
 * Where a Markdown image path may point, most specific first: the path from
 * the vault root, then relative to the note's own folder, then the bare file
 * name — the order Obsidian itself tries, so a relative path lands on the file
 * the author sees rather than on another one that shares its name.
 */
export function assetCandidates(src, notePath = "") {
  const reference = decodeReference(src).split(/[?#]/)[0].trim();
  if (!reference) return [];

  const folder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const relative = normalisePath(folder ? `${folder}/${reference}` : reference);
  const name = reference.split("/").pop();

  return [...new Set([normalisePath(reference), relative, name].filter(Boolean))];
}

/** Collapses `.` and `..`; a path that climbs out of the vault names nothing. */
function normalisePath(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return "";
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/**
 * markdown-it percent-encodes a link as it parses it, so `my photo.png` in
 * angle brackets arrives as `my%20photo.png`. A name that is not valid
 * escaping — `100%-Finanzierung.png` is a file somebody has — stays as it is.
 */
function decodeReference(src) {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

function isRemote(src) {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");
}

function pushLink(state, { path, heading, alias, site }) {
  const note = site.notes?.get(key(path));
  if (!note) {
    pushText(state, alias || path);
    return;
  }
  const fragment = heading ? `#${site.slugify(heading)}` : "";
  pushAnchor(state, `${note.url}${fragment}`, alias || note.title);
}

function pushAnchor(state, href, text) {
  const open = state.push("link_open", "a", 1);
  open.attrs = [
    ["href", href],
    ["class", "internal"]
  ];
  pushText(state, text);
  state.push("link_close", "a", -1);
}

function pushText(state, value) {
  const token = state.push("text", "", 0);
  token.content = value;
}

/**
 * `> [!note]` and friends.
 *
 * The collapsible variants become `<details>`, so folding needs no JavaScript.
 * The rest stay blockquotes with a class and a title line.
 */
function callouts(state) {
  const tokens = state.tokens;

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "blockquote_open") continue;
    if (tokens[i + 1]?.type !== "paragraph_open" || tokens[i + 2]?.type !== "inline") continue;

    const inline = tokens[i + 2];
    const [first, ...rest] = inline.content.split("\n");
    const match = CALLOUT.exec(first);
    if (!match) continue;

    const [, rawType, fold, rawTitle] = match;
    const type = rawType.toLowerCase();
    const title = rawTitle.trim() || capitalise(type);

    // The marker line is consumed by the title; the rest stays as written. The
    // rule runs before inline parsing, so the remaining text is parsed once, by
    // the normal inline pass.
    inline.content = rest.join("\n");

    if (fold) {
      const open = tokens[i];
      open.type = "html_block";
      open.tag = "";
      open.nesting = 0;
      open.block = true;
      open.content =
        `<details class="callout callout-${escapeAttribute(type)}"${fold === "+" ? " open" : ""}>` +
        `<summary>${escapeHtml(title)}</summary>\n`;

      const close = findClose(tokens, i);
      if (close >= 0) {
        tokens[close].type = "html_block";
        tokens[close].tag = "";
        tokens[close].nesting = 0;
        tokens[close].block = true;
        tokens[close].content = "</details>\n";
      }
      continue;
    }

    tokens[i].attrJoin("class", `callout callout-${type}`);
    const heading = new state.Token("html_block", "", 0);
    heading.block = true;
    heading.content = `<p class="callout-title">${escapeHtml(title)}</p>\n`;
    tokens.splice(i + 1, 0, heading);
  }
}

function findClose(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === "blockquote_open") depth += 1;
    if (tokens[i].type === "blockquote_close") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * A `schreibstube-slideshow` fence becomes the plugin's slideshow, drawn by
 * the site's own script; see `slideshow.mjs`.
 *
 * A `mermaid` fence becomes a block the client-side bundle picks up.
 *
 * Mermaid is the one thing the bridge cannot render, because it needs a browser
 * to measure text. The page loads a self-hosted bundle instead, and only a page
 * that contains a diagram loads it at all.
 */
function overrideFence(md, allowDiagrams) {
  const fallback = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const info = tokens[index].info.trim().split(/\s+/)[0]?.toLowerCase();
    if (info === SLIDESHOW_LANGUAGE) {
      const site = env?.site ?? emptySite();
      const notePath = env?.sourcePath ?? "";
      // A slideshow line may wrap its path in angle brackets, which the
      // Markdown parser would have taken off an ordinary image.
      const resolve = (src) => findAsset(site, /^<(.+)>$/.exec(src)?.[1] ?? src, notePath);
      const rendered = renderSlideshow(tokens[index].content, resolve);
      if (rendered.slideshow) env.usedSlideshow = true;
      return rendered.html;
    }
    if (info === "mermaid" && allowDiagrams) {
      env.usedMermaid = true;
      return `<pre class="mermaid">${escapeHtml(tokens[index].content)}</pre>\n`;
    }
    return fallback(tokens, index, options, env, self);
  };
}

/** Outbound links get `rel="noopener"`; internal ones are ours already. */
function overrideLinks(md) {
  const fallback =
    md.renderer.rules.link_open ??
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet("href") ?? "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("mailto:")) {
      tokens[index].attrSet("rel", "noopener");
    }
    return fallback(tokens, index, options, env, self);
  };
}

function splitOnce(value, separator) {
  const at = value.indexOf(separator);
  return at < 0 ? [value, undefined] : [value.slice(0, at), value.slice(at + 1)];
}

/** Links are written as they read in the vault, so lookup ignores case. */
export function key(value) {
  return String(value).trim().toLowerCase().replace(/\.md$/, "");
}

function emptySite() {
  return { notes: new Map(), assets: new Map(), slugify: (value) => value };
}

function capitalise(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
