import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ASSETS_HTACCESS,
  ASSETS_HTACCESS_CONTENT,
  DEFAULT_CSP,
  htaccessFiles,
  SITE_HTACCESS,
  siteHtaccess
} from "./site-headers.mjs";
import { buildSite, sha256 } from "./site.mjs";

describe("the default policy", () => {
  it("allows the one inline script a page with a diagram carries, by its hash", async () => {
    const text = "# Ablauf\n\n```mermaid\ngraph TD; A-->B\n```\n";
    const files = await buildSite(
      {
        siteTitle: "S",
        notes: [{ sourcePath: "a.md", sha256: sha256(text), slug: "ablauf", title: "Ablauf" }],
        assets: []
      },
      new Map([[sha256(text), text]])
    );
    const page = files.get("ablauf/index.html").toString("utf8");
    const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(inline).toHaveLength(1);
    const hash = createHash("sha256").update(inline[0], "utf8").digest("base64");
    expect(DEFAULT_CSP).toContain(`'sha256-${hash}'`);
  });

  it("loads scripts only from the site, and lets a note's pictures come from anywhere", () => {
    expect(DEFAULT_CSP).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+';/);
    expect(DEFAULT_CSP).not.toContain("unsafe-eval");
    expect(DEFAULT_CSP).toContain("img-src 'self' data: https:");
    expect(DEFAULT_CSP).toContain("object-src 'none'");
    expect(DEFAULT_CSP).not.toContain('"');
  });
});

describe("the .htaccess files", () => {
  it("are written only for a target that asks for them", () => {
    expect(htaccessFiles({ htaccess: false }).size).toBe(0);
    const files = htaccessFiles({ htaccess: true });
    expect([...files.keys()]).toEqual([SITE_HTACCESS, ASSETS_HTACCESS]);
    expect(files.get(SITE_HTACCESS).toString()).toContain(DEFAULT_CSP);
    expect(files.get(ASSETS_HTACCESS).toString()).toBe(ASSETS_HTACCESS_CONTENT);
  });

  it("carry the target's own policy where it has one", () => {
    const files = htaccessFiles({ htaccess: true, csp: "default-src 'self' fonts.example" });
    expect(files.get(SITE_HTACCESS).toString()).toContain(
      "Content-Security-Policy \"default-src 'self' fonts.example\""
    );
  });

  it("set nothing unless Apache has the module that reads them", () => {
    for (const text of [siteHtaccess(), ASSETS_HTACCESS_CONTENT]) {
      expect(text).toMatch(/^<IfModule mod_headers\.c>$/m);
      expect(text.trimEnd()).toMatch(/<\/IfModule>$/);
    }
  });
});
