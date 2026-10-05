/**
 * The headers a published site is served with, for the hosts where the bridge
 * can set them: Apache reads them from `.htaccess` files beside the pages.
 *
 * Two files. The site's root gets the policy every page is held to, so a
 * note's raw HTML cannot load a script from elsewhere; `assets/` gets a
 * sandbox for its SVGs, so a drawing opened on its own is a picture with no
 * origin to act in, whatever slipped past the check of its text. Both say
 * `nosniff`, so a browser serves a file as the type its name gives it.
 */
import { createHash } from "node:crypto";
import { mermaidLoader } from "./render/page.mjs";

/** Where the bridge writes them, and which of them it manages. */
export const SITE_HTACCESS = ".htaccess";
export const ASSETS_HTACCESS = "assets/.htaccess";
export const HTACCESS_FILES = new Set([SITE_HTACCESS, ASSETS_HTACCESS]);

/** The hash a page's one inline script is allowed by; only note pages draw diagrams. */
export function scriptHash(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/**
 * What a generated page needs and no more: its own scripts and the Mermaid
 * loader; inline styles, which KaTeX and Mermaid both write; pictures and
 * video from anywhere a note may link to, since a remote image in a note is
 * left as written; and frames, for a video a note embeds in its own HTML. A
 * theme that imports a web font needs `PUBLISH_<TARGET>_CSP`.
 */
export const DEFAULT_CSP = [
  "default-src 'self'",
  `script-src 'self' ${scriptHash(mermaidLoader("../"))}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");

const BANNER = "# Written by the Schreibstube bridge at every publish; changes here are replaced.";

/** The root's file: the page policy, nosniff and a referrer policy. */
export function siteHtaccess(csp = DEFAULT_CSP) {
  return [
    BANNER,
    "<IfModule mod_headers.c>",
    `  Header always set Content-Security-Policy "${csp}"`,
    '  Header always set X-Content-Type-Options "nosniff"',
    '  Header always set Referrer-Policy "strict-origin-when-cross-origin"',
    "</IfModule>",
    ""
  ].join("\n");
}

/** The assets' file: an SVG opened on its own runs in a sandbox. */
export const ASSETS_HTACCESS_CONTENT = [
  BANNER,
  "<IfModule mod_headers.c>",
  '  Header always set X-Content-Type-Options "nosniff"',
  '  <FilesMatch "\\.svg$">',
  '    Header always set Content-Security-Policy "sandbox"',
  "  </FilesMatch>",
  "</IfModule>",
  ""
].join("\n");

/** Both files for a target that asks for them, by path. */
export function htaccessFiles(target) {
  if (!target.htaccess) return new Map();
  return new Map([
    [SITE_HTACCESS, Buffer.from(siteHtaccess(target.csp ?? DEFAULT_CSP), "utf8")],
    [ASSETS_HTACCESS, Buffer.from(ASSETS_HTACCESS_CONTENT, "utf8")]
  ]);
}
