/**
 * Shared links: one note, frozen as it was, at a short address under the
 * site, for a reader who is not meant to find it any other way.
 *
 * Everything here decides; `share-routes.mjs` wires it to the host. A share
 * is a static page like any other the bridge writes, so it needs nothing from
 * the bridge once it is written: the host serves it, and a password-protected
 * one is ciphertext that the reader's browser opens with the password. The
 * host never holds the text, the bridge never stores the password, and a copy
 * of the files without the password is a copy of nothing.
 *
 * What a share leaves out is the price of being one file: links to other
 * notes become text, since the reader cannot follow them; pictures are carried
 * inside the page, so the password covers them too; videos and diagrams are
 * named rather than shown.
 */
import { createCipheriv, pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { createRenderer, renderMarkdown } from "./render/markdown.mjs";
import { escapeHtml, key } from "./render/obsidian.mjs";
import { extensionOf, slugify } from "./path.mjs";
import { decodedLength, isBase64 } from "../base64.mjs";
import { hasSignature } from "./signatures.mjs";
import { isSafeSvg } from "./svg-guard.mjs";

const derive = promisify(pbkdf2);

/** The directory every share lives under, one directory per link. */
export const SHARE_DIRECTORY = "s";

/**
 * A code is the only thing that tells one share's address from another's, and
 * for a share without a password it is the only key. Ten characters of an
 * alphabet without the letters that read alike (0/O, 1/l/I) are 58 bits: read
 * aloud or typed from a phone without mistakes, and not to be guessed.
 */
export const SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const SHARE_CODE_LENGTH = 10;
const SHARE_CODE = new RegExp(`^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_LENGTH}}$`);

/** How many links one target keeps at once. */
export const MAX_SHARES = 200;
/** How many pictures one share carries, and how much they may weigh together. */
export const MAX_SHARE_ASSETS = 50;
export const MAX_SHARE_ASSET_BYTES = 20_000_000;
/**
 * The largest page a share may come to. A picture shown twice is in the page
 * twice, so the inputs' limits do not bound it; this does, before the page is
 * put together.
 */
export const MAX_SHARE_PAGE_BYTES = 64_000_000;
/** The longest a link may stay open. A share that should outlive a year is a page. */
export const MAX_SHARE_DAYS = 366;
export const MAX_SHARE_TITLE_LENGTH = 200;
export const MAX_SHARE_THEME_BYTES = 1_000_000;

/**
 * The largest request body, from its parts: the pictures as base64, a third
 * larger, and the note and the theme as JSON writes them, where a control
 * character takes six bytes. Derived, so a larger PUBLISH_MAX_SOURCE_BYTES
 * raises it with the note it allows.
 */
export function maxShareRequestBytes(maxSourceBytes) {
  return (
    Math.ceil((MAX_SHARE_ASSET_BYTES * 4) / 3) +
    6 * (maxSourceBytes + MAX_SHARE_THEME_BYTES) +
    64_000
  );
}
/**
 * A password the reader types, so it may be short; the derivation is what
 * makes guessing it offline slow. Six hundred thousand rounds of PBKDF2 is
 * the current advice for SHA-256 and costs a phone about a second, once.
 */
export const MIN_SHARE_PASSWORD_LENGTH = 8;
export const MAX_SHARE_PASSWORD_LENGTH = 256;
export const SHARE_ITERATIONS = 600_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a picture in a share may be, and the type its data URL names. */
export const SHARE_IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["svg", "image/svg+xml"]
]);

export class ShareError extends Error {}

/** A fresh code, from an unbiased draw: bytes past the last whole alphabet are thrown back. */
export function newShareCode(random = randomBytes) {
  const size = SHARE_CODE_ALPHABET.length;
  const ceiling = Math.floor(256 / size) * size;
  let code = "";
  while (code.length < SHARE_CODE_LENGTH) {
    for (const byte of random(SHARE_CODE_LENGTH * 2)) {
      if (byte >= ceiling) continue;
      code += SHARE_CODE_ALPHABET[byte % size];
      if (code.length === SHARE_CODE_LENGTH) break;
    }
  }
  return code;
}

export function isShareCode(value) {
  return typeof value === "string" && SHARE_CODE.test(value);
}

/** Where a share's files lie, relative to the site's root. */
export function shareDirectory(code) {
  return `${SHARE_DIRECTORY}/${code}`;
}

/** The address a reader is given. */
export function shareUrl(baseUrl, code) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${shareDirectory(code)}/`;
}

/**
 * A share request, checked, with only the fields the bridge knows.
 *
 * The note arrives as text and the pictures as base64: one request, since a
 * share is written whole or not at all, and the pictures are folded into the
 * page rather than written beside it, so they have no upload of their own.
 */
export function checkShareRequest(body, { now, maxSourceBytes, maxImageBytes }) {
  if (!body || typeof body !== "object") throw new ShareError("A share request is required.");

  let code = null;
  if (body.code !== undefined && body.code !== null) {
    if (!isShareCode(body.code)) throw new ShareError("Not a share code.");
    code = body.code;
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0) throw new ShareError("A share needs a title.");
  if (title.length > MAX_SHARE_TITLE_LENGTH) {
    throw new ShareError(`A title has at most ${MAX_SHARE_TITLE_LENGTH} characters.`);
  }

  if (typeof body.source !== "string") throw new ShareError("A share needs the note's text.");
  if (Buffer.byteLength(body.source) > maxSourceBytes) {
    throw new ShareError(`The note exceeds ${maxSourceBytes} bytes.`);
  }

  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
  if (sourcePath.length === 0 || sourcePath.length > 1024) {
    throw new ShareError("A share needs the note's path.");
  }

  let themeCss;
  if (body.themeCss !== undefined) {
    if (typeof body.themeCss !== "string") throw new ShareError("themeCss must be a string.");
    if (Buffer.byteLength(body.themeCss) > MAX_SHARE_THEME_BYTES) {
      throw new ShareError(`The theme exceeds ${MAX_SHARE_THEME_BYTES} bytes.`);
    }
    themeCss = body.themeCss;
  }

  return {
    code,
    title,
    sourcePath,
    source: body.source,
    themeCss,
    assets: checkShareAssets(body.assets, maxImageBytes),
    password: checkPassword(body.password),
    expiresAt: checkExpiry(body.expiresAt, now)
  };
}

function checkShareAssets(value, maxImageBytes) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ShareError("assets must be a list.");
  if (value.length > MAX_SHARE_ASSETS) {
    throw new ShareError(`A share carries at most ${MAX_SHARE_ASSETS} pictures.`);
  }
  let total = 0;
  return value.map((asset) => {
    const sourcePath = typeof asset?.sourcePath === "string" ? asset.sourcePath : "";
    if (sourcePath.length === 0 || sourcePath.length > 1024) {
      throw new ShareError("A picture is missing its path.");
    }
    const extension = extensionOf(sourcePath);
    if (!SHARE_IMAGE_TYPES.has(extension)) {
      throw new ShareError(`Not a picture a share can carry: ${sourcePath}.`);
    }
    if (!isBase64(asset.data)) throw new ShareError(`${sourcePath}: data must be base64.`);
    const size = decodedLength(asset.data);
    if (size > maxImageBytes) {
      throw new ShareError(`${sourcePath} exceeds ${maxImageBytes} bytes.`);
    }
    total += size;
    if (total > MAX_SHARE_ASSET_BYTES) {
      throw new ShareError(`The pictures exceed ${MAX_SHARE_ASSET_BYTES} bytes together.`);
    }
    const bytes = Buffer.from(asset.data, "base64");
    // Shown in an <img>, where an SVG runs nothing; checked all the same, as
    // a published one is, since a reader may open the picture on its own.
    const fits =
      extension === "svg"
        ? isSafeSvg(bytes.toString("utf8"), { embedded: true })
        : hasSignature(bytes, extension);
    if (!fits) throw new ShareError(`${sourcePath} is not the ${extension} it is named.`);
    return { sourcePath, extension, bytes };
  });
}

function checkPassword(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ShareError("password must be a string.");
  const length = [...value].length;
  if (length < MIN_SHARE_PASSWORD_LENGTH) {
    throw new ShareError(`A password has at least ${MIN_SHARE_PASSWORD_LENGTH} characters.`);
  }
  if (length > MAX_SHARE_PASSWORD_LENGTH) {
    throw new ShareError(`A password has at most ${MAX_SHARE_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

function checkExpiry(value, now) {
  if (value === undefined || value === null) return null;
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at)) throw new ShareError("expiresAt must be a date and time.");
  if (at <= now) throw new ShareError("expiresAt lies in the past.");
  if (at > now + MAX_SHARE_DAYS * DAY_MS) {
    throw new ShareError(`A link stays open for at most ${MAX_SHARE_DAYS} days.`);
  }
  return new Date(at).toISOString();
}

/**
 * The record of a target's shares, as `shares.json` holds it. A record that
 * does not read is dropped rather than trusted: its files are then nobody's,
 * and nothing is ever deleted on the strength of a field that did not check.
 */
export function normalizeShares(raw) {
  const shares = new Map();
  const list = Array.isArray(raw?.shares) ? raw.shares : [];
  for (const entry of list) {
    if (!isShareCode(entry?.code) || shares.has(entry.code)) continue;
    const prefix = `${shareDirectory(entry.code)}/`;
    const files = Array.isArray(entry.files)
      ? entry.files.filter(
          (path) => typeof path === "string" && path.startsWith(prefix) && !path.includes("..")
        )
      : [];
    const expiresAt =
      typeof entry.expiresAt === "string" && Number.isFinite(Date.parse(entry.expiresAt))
        ? entry.expiresAt
        : null;
    shares.set(entry.code, {
      code: entry.code,
      title: typeof entry.title === "string" ? entry.title : "",
      sourcePath: typeof entry.sourcePath === "string" ? entry.sourcePath : "",
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      expiresAt,
      protected: entry.protected === true,
      // Taken down, with files the host would not yet let go of.
      ...(entry.revoked === true ? { revoked: true } : {}),
      files
    });
  }
  return shares;
}

export function serializeShares(target, shares) {
  return JSON.stringify({ version: 1, target, shares: [...shares.values()] }, null, 2);
}

/** Whether a link is no longer to be read: taken down, or its time is up. */
export function isClosed(share, now) {
  return share.revoked === true || (share.expiresAt !== null && Date.parse(share.expiresAt) <= now);
}

/** The codes of the links to take down. */
export function expiredShares(shares, now) {
  return [...shares.values()].filter((share) => isClosed(share, now)).map((share) => share.code);
}

/** The links a reader can still open, which is all the plugin is told of. */
export function openShares(shares, now) {
  return [...shares.values()].filter((share) => !isClosed(share, now));
}

/**
 * When the sweep should next look, or null when nothing will ever be due: the
 * next link to run out, or — for a closed link whose files the host kept —
 * a while from now, so a file that cannot be deleted is not tried every minute.
 */
export function nextSweep(shares, now, retryMs) {
  let next = null;
  for (const share of shares.values()) {
    const at = isClosed(share, now)
      ? now + retryMs
      : share.expiresAt === null
        ? null
        : Date.parse(share.expiresAt);
    if (at !== null && (next === null || at < next)) next = at;
  }
  return next;
}

/** What the plugin is told about a share: never its files. */
export function describeShare(share, baseUrl) {
  return {
    code: share.code,
    url: shareUrl(baseUrl, share.code),
    title: share.title,
    sourcePath: share.sourcePath,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    expiresAt: share.expiresAt,
    protected: share.protected
  };
}

/**
 * The note's body. Links to other notes are left as their text and only the
 * share's own pictures resolve, as data URLs, so the page needs nothing else
 * from the site and the password covers what it shows. Diagrams stay their
 * source: the drawing runs a script the page would have to allow.
 */
export function renderShare({ source, sourcePath, assets, allowHtml }) {
  const md = createRenderer({ allowHtml, allowDiagrams: false });
  // Rendered with a short stand-in for each picture, so the page's size can
  // be counted before a picture shown a thousand times is a thousand copies.
  const table = new Map();
  const urls = assets.map(
    (asset) =>
      `data:${SHARE_IMAGE_TYPES.get(asset.extension)};base64,${asset.bytes.toString("base64")}`
  );
  assets.forEach((asset, index) => {
    const name = asset.sourcePath.split("/").pop();
    const entry = { url: `${ASSET_MARK}${index}-`, name, kind: "image" };
    table.set(key(asset.sourcePath), entry);
    table.set(key(name), entry);
  });
  const site = { notes: new Map(), assets: table, slugify };
  const rendered = renderMarkdown(md, source, site, { sourcePath });

  const marks = new RegExp(`${ASSET_MARK}(\\d+)-`, "g");
  let size = rendered.html.length;
  for (const match of rendered.html.matchAll(marks)) {
    size += (urls[Number(match[1])]?.length ?? 0) - match[0].length;
  }
  if (size > MAX_SHARE_PAGE_BYTES) {
    throw new ShareError(
      `The page would come to more than ${MAX_SHARE_PAGE_BYTES} bytes; show fewer pictures, or each fewer times.`
    );
  }
  return {
    ...rendered,
    html: rendered.html.replace(marks, (mark, index) => urls[Number(index)] ?? mark)
  };
}

/** What a picture is called in the page until the page's size is known. */
const ASSET_MARK = "schreibstube-share-asset-";

/**
 * The page's text, encrypted with a key derived from the password: AES-GCM,
 * so a wrong password is told apart from a right one by the tag rather than
 * by garbled text, in the form WebCrypto reads (the tag after the ciphertext).
 */
export async function encryptShare(plaintext, password, { random = randomBytes } = {}) {
  const salt = random(16);
  const iv = random(12);
  const key = await derive(password.normalize("NFC"), salt, SHARE_ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: SHARE_ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    data: data.toString("base64")
  };
}

/**
 * One share's page. A protected one names nothing — not even the title,
 * which is inside the ciphertext with the rest — and carries the script that
 * asks for the password. Neither kind is to be indexed or to pass its address
 * on to a site it links to.
 */
export function sharePage({
  title,
  body,
  encrypted = null,
  expiresAt,
  usedMath,
  usedSlideshow,
  csp = SHARE_CSP
}) {
  const head = [
    `<meta charset="utf-8">`,
    // Before anything it governs. A host that sends the policy as a header
    // gets none here: the two would both apply, and the target's own
    // policy, which may allow a theme's web font, could only be narrowed.
    csp ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">` : null,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="robots" content="noindex, nofollow">`,
    `<meta name="referrer" content="no-referrer">`,
    expiresAt ? `<meta name="schreibstube-expires" content="${escapeHtml(expiresAt)}">` : null,
    `<title>${escapeHtml(encrypted ? "Geteiltes Dokument" : title)}</title>`,
    `<link rel="stylesheet" href="theme.css">`,
    usedMath ? `<link rel="stylesheet" href="katex/katex.css">` : null,
    usedSlideshow ? `<link rel="stylesheet" href="slideshow.css">` : null,
    `<style>${SHARE_CSS}</style>`
  ].filter(Boolean);

  const main = encrypted
    ? `<form class="share-unlock" id="share-unlock" hidden>\n` +
      `<p>Dieses Dokument ist mit einem Passwort geschützt.</p>\n` +
      `<label for="share-password">Passwort</label>\n` +
      `<input id="share-password" type="password" autocomplete="off" required autofocus>\n` +
      `<button type="submit">Öffnen</button>\n` +
      `<p class="share-status" id="share-status" role="status"></p>\n` +
      `</form>\n` +
      `<noscript><p>Zum Öffnen dieses Dokuments wird JavaScript gebraucht.</p></noscript>\n` +
      `<article id="share-content" hidden></article>\n` +
      // A data block, which no policy treats as a script: base64 cannot
      // close the element it sits in.
      `<script type="application/json" id="share-payload">${JSON.stringify(encrypted)}</script>\n`
    : `<article>\n` +
      (/^\s*<h1[\s>]/.test(body) ? "" : `<h1>${escapeHtml(title)}</h1>\n`) +
      body +
      `</article>\n`;

  const scripts = [
    encrypted ? `<script type="module" src="unlock.js"></script>` : null,
    !encrypted && usedSlideshow ? `<script type="module" src="slideshow.js"></script>` : null
  ].filter(Boolean);

  return (
    `<!doctype html>\n` +
    `<html lang="de">\n` +
    `<head>\n${head.join("\n")}\n</head>\n` +
    `<body class="share">\n` +
    `<main>\n${main}</main>\n` +
    (scripts.length > 0 ? `${scripts.join("\n")}\n` : "") +
    `</body>\n` +
    `</html>\n`
  );
}

/** What a protected share's plaintext is: the title and the body, as the page shows them. */
export function sharePlaintext({ title, body }) {
  const heading = /^\s*<h1[\s>]/.test(body) ? "" : `<h1>${escapeHtml(title)}</h1>\n`;
  return JSON.stringify({ title, html: `${heading}${body}` });
}

/**
 * What a share page needs and no more: its own scripts, inline styles for
 * KaTeX, pictures as data URLs. No inline script and no inline event handler,
 * so raw HTML in a note — inserted by the unlock script too — runs nothing.
 */
export const SHARE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

const SHARE_CSS =
  ".share-unlock{max-width:22rem;margin:4rem auto;display:grid;gap:.6rem}" +
  ".share-unlock input,.share-unlock button{font:inherit;padding:.5rem .6rem}" +
  ".share-status{min-height:1.5em;color:var(--muted,#5d5d5d)}";

/**
 * The share's own `.htaccess`, for a host that reads one: the link closes at
 * its time even while the bridge is down, and the page is kept out of caches
 * and indexes.
 *
 * Apache compares `%{TIME}` in the server's local time, and there is no UTC
 * variant. The time written is UTC, so a host east of Greenwich — every host
 * in Europe — closes the link early by its offset, never late; the bridge
 * removes the files at the minute itself.
 */
export function shareHtaccess({ expiresAt, csp = SHARE_CSP }) {
  const lines = ["# Written by the Schreibstube bridge for one shared link; removed with it."];
  if (expiresAt) {
    lines.push(`<If "%{TIME} >= '${apacheTime(expiresAt)}'">`, "  Require all denied", "</If>");
  }
  lines.push(
    "<IfModule mod_headers.c>",
    // Set here, not left to the site's root: a target used only for sharing
    // has never been published, and has no root file to inherit.
    `  Header always set Content-Security-Policy "${csp}"`,
    '  Header always set X-Content-Type-Options "nosniff"',
    '  Header always set X-Robots-Tag "noindex, nofollow"',
    '  Header always set Referrer-Policy "no-referrer"',
    '  Header always set Cache-Control "no-store"',
    "</IfModule>",
    ""
  );
  return lines.join("\n");
}

/** `2026-11-02T00:00:00.000Z` as Apache's `%{TIME}` writes it: `20261102000000`. */
export function apacheTime(iso) {
  return new Date(iso).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/**
 * The page at the share directory itself, so a host that lists directories
 * does not list every code. Written only where nothing is.
 */
export const SHARE_INDEX_GUARD =
  `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n` +
  `<meta name="robots" content="noindex, nofollow">\n<title></title>\n</head>\n<body></body>\n</html>\n`;
