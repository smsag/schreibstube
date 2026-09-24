import { describe, expect, it } from "vitest";
import { decodeDataUri, isSafeSvg, MAX_SITE_ICON_BYTES, siteIconFromTheme } from "./site-icon.mjs";
import { buildSite, sha256 } from "./site.mjs";

const pile =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  "<style>.i{stroke:#000}@media (prefers-color-scheme:dark){.i{stroke:#fff}}</style>" +
  '<rect class="i" x="8" y="44" width="48" height="11" rx="3" fill="none"/></svg>';
const encoded = `data:image/svg+xml,${encodeURIComponent(pile)}`;
const theme = (uri) =>
  `:root {\n  --logo: url("x");\n  --site-icon: url("${uri}");\n}\nbody { color: red; }`;

describe("siteIconFromTheme", () => {
  it("writes the SVG a theme names, percent-encoded or base64, quoted or not", () => {
    const icon = siteIconFromTheme(theme(encoded));
    expect(icon).toMatchObject({ path: "assets/site-icon.svg", type: "image/svg+xml" });
    expect(icon.bytes.toString("utf8")).toBe(pile);

    const base64 = `data:image/svg+xml;base64,${Buffer.from(pile).toString("base64")}`;
    expect(siteIconFromTheme(`:root{--site-icon:url(${base64})}`).bytes.toString()).toBe(pile);
    expect(siteIconFromTheme(`:root{--site-icon: url('${encoded}')}`)).not.toBeNull();
  });

  it("writes a PNG as a PNG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const icon = siteIconFromTheme(theme(`data:image/png;base64,${png.toString("base64")}`));
    expect(icon).toMatchObject({ path: "assets/site-icon.png", type: "image/png" });
    expect(icon.bytes).toEqual(png);
  });

  it("names none for a theme without one, or with nothing to read", () => {
    expect(siteIconFromTheme("body { color: red }")).toBeNull();
    expect(siteIconFromTheme(undefined)).toBeNull();
    expect(siteIconFromTheme(theme("data:image/svg+xml,"))).toBeNull();
  });

  it("serves no icon that is too large, of another type, or not what it says", () => {
    const big = `<svg>${"<g/>".repeat(MAX_SITE_ICON_BYTES / 4)}</svg>`;
    expect(siteIconFromTheme(theme(`data:image/svg+xml,${encodeURIComponent(big)}`))).toBeNull();
    expect(siteIconFromTheme(theme("data:text/html,%3Cb%3Ex%3C/b%3E"))).toBeNull();
    expect(siteIconFromTheme(theme("data:image/png;base64,aGVsbG8="))).toBeNull();
    expect(siteIconFromTheme(theme("data:image/svg+xml,%E0%A4%A"))).toBeNull();
  });
});

describe("isSafeSvg", () => {
  it("takes a drawing, with or without an XML declaration, style and media query included", () => {
    expect(isSafeSvg(pile)).toBe(true);
    expect(isSafeSvg(`<?xml version="1.0"?>\n${pile}`)).toBe(true);
    expect(isSafeSvg('<svg><use href="#a"/></svg>')).toBe(true);
  });

  it("refuses anything that could run or load: scripts, handlers, links out, embedded pages", () => {
    for (const bad of [
      "<svg><script>alert(1)</script></svg>",
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg><image href="https://example.com/x.png"/></svg>',
      '<svg><image xlink:href="//example.com/x.png"/></svg>',
      "<svg><foreignObject><div/></foreignObject></svg>",
      "<svg><style>@import url(https://x/y.css)</style></svg>",
      '<svg><rect fill="url(https://x/y#p)"/></svg>',
      "<html><svg/></html>"
    ]) {
      expect(isSafeSvg(bad)).toBe(false);
    }
  });
});

describe("decodeDataUri", () => {
  it("reads the type and the bytes, and gives up on what is not a data URI", () => {
    expect(decodeDataUri("data:image/svg+xml,%3Csvg%2F%3E")).toEqual({
      type: "image/svg+xml",
      bytes: Buffer.from("<svg/>")
    });
    expect(decodeDataUri("https://example.com/icon.svg")).toBeNull();
  });
});

describe("the built site", () => {
  const text = "# Eins\n\nText.\n";
  const index = (themeCss) => ({
    siteTitle: "Grembl",
    notes: [
      {
        sourcePath: "W/Eins.md",
        sha256: sha256(text),
        slug: "eins",
        title: "Eins",
        date: "",
        tags: ["essay"]
      }
    ],
    headerTags: ["essay"],
    assets: [],
    ...(themeCss ? { themeCss } : {})
  });
  const sources = new Map([[sha256(text), text]]);

  it("writes the icon and points every page at it, relative to where the page is", async () => {
    const files = await buildSite(index(theme(encoded)), sources);
    expect(files.get("assets/site-icon.svg").toString()).toBe(pile);
    const link = (path) =>
      files
        .get(path)
        .toString()
        .match(/<link rel="icon"[^>]*>/)?.[0];
    expect(link("index.html")).toBe(
      '<link rel="icon" href="assets/site-icon.svg" type="image/svg+xml">'
    );
    expect(link("eins/index.html")).toContain('href="../assets/site-icon.svg"');
    expect(link("tag/essay/index.html")).toContain('href="../../assets/site-icon.svg"');
  });

  it("writes no icon and no link for a theme without one, or with a refused one", async () => {
    for (const css of [
      undefined,
      "body{}",
      theme("data:image/svg+xml,%3Csvg%20onload%3D%22x%22%2F%3E")
    ]) {
      const files = await buildSite(index(css), sources);
      expect([...files.keys()].some((path) => path.startsWith("assets/site-icon"))).toBe(false);
      expect(files.get("index.html").toString()).not.toContain('rel="icon"');
    }
  });
});
