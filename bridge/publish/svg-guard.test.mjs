import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSvg, isSafeSvg } from "./svg-guard.mjs";

/**
 * The SVG check, against what the exporters people use actually write, and
 * against the spellings that got past the regular expressions it replaced.
 */

const EXCALIDRAW = `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 120" width="220" height="120">
  <!-- svg-source:excalidraw -->
  <metadata><!-- payload-type:application/vnd.excalidraw+json --><!-- payload-start -->eyJ2ZXJzaW9uIjoiMSJ9<!-- payload-end --></metadata>
  <defs>
    <style class="style-fonts">
      @font-face { font-family: Excalifont; src: url(data:font/woff2;base64,d09GMgABAAAAA) format("woff2"); }
    </style>
  </defs>
  <rect x="0" y="0" width="220" height="120" fill="#ffffff"></rect>
  <g stroke-linecap="round" transform="translate(10 10) rotate(0 50 25)"><path d="M32 0 C77 0, 77 0, 32 0" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g>
  <g transform="translate(20 70) rotate(0 40 12.5)"><text x="0" y="17.6" font-family="Excalifont, Xiaolai, Segoe UI Emoji" font-size="20px" fill="#1e1e1e" text-anchor="start" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Haus &amp; Hof</text></g>
  <mask id="mask-1"><rect x="0" y="0" fill="#fff" width="220" height="120"></rect></mask>
  <symbol id="image-abc"><image href="data:image/png;base64,iVBORw0KGgo=" width="100%" height="100%"></image></symbol>
  <g transform="translate(120 10)" mask="url(#mask-1)"><use href="#image-abc" width="80" height="50" opacity="1"></use></g>
</svg>
`;

const DRAWIO = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="241px" height="61px" viewBox="-0.5 -0.5 241 61" content="&lt;mxfile host=&quot;app.diagrams.net&quot;&gt;&lt;diagram id=&quot;a&quot;&gt;ddHBDoIwDAbgp9kdtqhnRL148uB5YZUtGXSZJaBPLwQQF/QJs6/Zfm3dS4m&lt;/diagram&gt;&lt;/mxfile&gt;" style="background-color: rgb(255, 255, 255);">
<defs/>
<g><rect x="0" y="0" width="120" height="60" rx="9" ry="9" fill="rgb(255, 255, 255)" stroke="rgb(0, 0, 0)" pointer-events="all"/>
<g transform="translate(-0.5 -0.5)"><switch><text x="60" y="34" fill="rgb(0, 0, 0)" font-family="Helvetica" font-size="12px" text-anchor="middle">Start</text></switch></g>
<path d="M 120 30 L 233.63 30" fill="none" stroke="rgb(0, 0, 0)" stroke-miterlimit="10" pointer-events="stroke"/>
<path d="M 238.88 30 L 231.88 33.5 L 233.63 30 L 231.88 26.5 Z" fill="rgb(0, 0, 0)" stroke="rgb(0, 0, 0)" stroke-miterlimit="10" pointer-events="all"/>
<image x="130" y="5" width="50" height="50" xlink:href="data:image/png;base64,iVBORw0KGgo=" preserveAspectRatio="none"/></g>
</svg>`;

const MERMAID = `<svg id="mermaid-1" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart" style="max-width: 200px;" viewBox="0 0 200 100" role="graphics-document document" aria-roledescription="flowchart-v2" xmlns:xlink="http://www.w3.org/1999/xlink"><style>#mermaid-1{font-family:"trebuchet ms",verdana,arial,sans-serif;font-size:16px;fill:#333;}@keyframes dash{to{stroke-dashoffset:0;}}#mermaid-1 .edge-animation-slow{stroke-dasharray:9,5!important;animation:dash 50s linear infinite;}#mermaid-1 .marker{fill:#333333;stroke:#333333;}#mermaid-1 .cluster > rect{fill:#ffffde;}#mermaid-1 :root{--mermaid-font-family:"trebuchet ms",verdana,arial,sans-serif;}</style><g><marker id="mermaid-1_flowchart-v2-pointEnd" class="marker flowchart-v2" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="arrowMarkerPath" style="stroke-width: 1; stroke-dasharray: 1, 0;"/></marker><g class="root"><g class="edgePaths"><path d="M50,50L150,50" id="L_A_B_0" class=" edge-thickness-normal flowchart-link" style=";" data-edge="true" data-et="edge" data-points="W3sieCI6NTB9XQ==" marker-end="url(#mermaid-1_flowchart-v2-pointEnd)"/></g><g class="nodes"><g class="node default" id="flowchart-A-0" transform="translate(30, 50)"><rect class="basic label-container" style="" x="-20" y="-15" width="40" height="30"/><g class="label" style="" transform="translate(0, 0)"><rect/><g><text y="-10.1"><tspan class="text-outer-tspan" x="0" y="-0.1em" dy="1.1em"><tspan font-style="normal" class="text-inner-tspan" font-weight="normal">A &gt; B</tspan></tspan></text></g></g></g></g></g></g></svg>`;

const repoSvg = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("drawings people export", () => {
  it("takes an Excalidraw export, with its fonts and pictures carried inside", () => {
    expect(checkSvg(EXCALIDRAW, { embedded: true })).toEqual({ ok: true });
  });

  it("takes a draw.io export, its DOCTYPE and its diagram source included", () => {
    expect(checkSvg(DRAWIO, { embedded: true })).toEqual({ ok: true });
  });

  it("takes a Mermaid export with its stylesheet, markers and ARIA roles", () => {
    expect(checkSvg(MERMAID, { embedded: true })).toEqual({ ok: true });
    expect(isSafeSvg(MERMAID)).toBe(true);
  });

  it("takes the repository's own drawings", () => {
    for (const path of ["assets/logo.svg", "assets/icons/pythia.svg"]) {
      expect(isSafeSvg(repoSvg(path))).toBe(true);
    }
  });

  it("keeps a tab icon to references inside itself", () => {
    expect(isSafeSvg(EXCALIDRAW)).toBe(false);
    expect(isSafeSvg(DRAWIO)).toBe(false);
  });

  it("takes animation that changes how something looks", () => {
    expect(
      isSafeSvg(
        '<svg><rect width="1" height="1"><animate attributeName="opacity" values="0;1" dur="1s"/>' +
          '<animateTransform attributeName="transform" type="rotate" from="0" to="90" dur="2s"/>' +
          "</rect></svg>"
      )
    ).toBe(true);
  });
});

describe("what got past the regular expressions", () => {
  const bypasses = {
    "a script under a prefix bound to SVG":
      '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>',
    "a script under XHTML's namespace":
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml">' +
      "<h:script>alert(1)</h:script></svg>",
    "an animation that turns a link into javascript: with a character reference":
      '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" ' +
      'values="&#106;avascript:alert(1)"/><text y="20">x</text></a></svg>',
    "a link spelled with a character reference":
      '<svg><a href="&#106;avascript:alert(1)"><rect/></a></svg>',
    "a link spelled with a hexadecimal reference and a tab":
      '<svg><a href="java&#x09;script:alert(1)"><rect/></a></svg>'
  };

  for (const [name, svg] of Object.entries(bypasses)) {
    it(`refuses ${name}`, () => {
      expect(isSafeSvg(svg)).toBe(false);
      expect(isSafeSvg(svg, { embedded: true })).toBe(false);
    });
  }
});

describe("refusals", () => {
  const refused = {
    "a script": "<svg><script>alert(1)</script></svg>",
    "a script in another case": "<svg><Script>alert(1)</Script></svg>",
    "an event handler": '<svg onload="alert(1)"></svg>',
    "an event handler in capitals": '<svg><rect ONCLICK = "alert(1)"/></svg>',
    "an embedded page": "<svg><foreignObject><div/></foreignObject></svg>",
    "an animation of an event handler":
      '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
    "an animation of xlink:href": '<svg><animate attributeName="xlink:href" to="#a"/></svg>',
    "a default namespace that is not SVG's":
      '<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>',
    "a namespace rebound further down":
      '<svg><g xmlns="http://www.w3.org/1999/xhtml"><rect/></g></svg>',
    "xlink bound to another namespace":
      '<svg xmlns:xlink="http://www.w3.org/1999/xhtml"><use xlink:href="#a"/></svg>',
    "any other prefixed attribute": '<svg><rect xml:base="https://x/"/></svg>',
    "an unknown attribute": '<svg><rect formaction="https://x/"/></svg>',
    "an entity declared in the DOCTYPE":
      '<!DOCTYPE svg [<!ENTITY x "javascript:alert(1)">]><svg><a href="&x;"><rect/></a></svg>',
    "an undeclared entity": "<svg><text>&nbsp;</text></svg>",
    "a stylesheet instruction": '<?xml-stylesheet href="https://x/y.css"?><svg/>',
    "a declaration that is not first": '<svg/><?xml version="1.0"?>',
    "an import split by a CDATA section":
      "<svg><style>@imp<![CDATA[ort url(https://x/y.css);]]></style></svg>",
    "an import split by a comment":
      "<svg><style>@imp<!-- c -->ort 'https://x/y.css';</style></svg>",
    "a url spelled with an escape": "<svg><style>a{background:u\\72l(https://x)}</style></svg>",
    "an image-set with a bare address":
      '<svg><style>a{background:image-set("https://x/y.png" 1x)}</style></svg>',
    "an element inside a stylesheet": "<svg><style><g/></style></svg>",
    "CDATA that an HTML parser would read as markup":
      "<svg><title><![CDATA[</title><img src=x onerror=alert(1)>]]></title></svg>",
    "a comment that an HTML parser closes at once":
      "<svg><!--><img src=x onerror=alert(1)>--></svg>",
    "a picture loaded from elsewhere": '<svg><image href="https://example.com/x.png"/></svg>',
    "a protocol-relative picture": '<svg><image xlink:href="//example.com/x.png"/></svg>',
    "a paint loaded from elsewhere": '<svg><rect fill="url(https://x/y#p)"/></svg>',
    "a paint spelled with a reference": '<svg><rect fill="url(&#104;ttps://x/y#p)"/></svg>',
    "a style attribute loading from elsewhere":
      '<svg><rect style="fill:url(https://x/y#p)"/></svg>',
    "an import": "<svg><style>@import url(https://x/y.css)</style></svg>",
    "a root that is not svg": "<html><svg/></html>",
    "two roots": "<svg/><svg/>",
    "an unclosed element": "<svg><g></svg>",
    "an unquoted attribute": "<svg><rect width=1/></svg>",
    "a duplicated attribute": '<svg><rect fill="red" fill="blue"/></svg>',
    "text outside the root": "<svg/>hello",
    "nothing at all": "   "
  };

  for (const [name, svg] of Object.entries(refused)) {
    it(`refuses ${name}`, () => {
      const result = checkSvg(svg, { embedded: true });
      expect(result.ok).toBe(false);
      expect(result.reason).toEqual(expect.any(String));
    });
  }

  it("lets an uploaded drawing carry pictures only where a picture goes", () => {
    const picture = "data:image/png;base64,iVBORw0KGgo=";
    expect(isSafeSvg(`<svg><image href="${picture}"/></svg>`, { embedded: true })).toBe(true);
    expect(isSafeSvg(`<svg><use href="${picture}"/></svg>`, { embedded: true })).toBe(false);
    expect(isSafeSvg(`<svg><a href="${picture}"><rect/></a></svg>`, { embedded: true })).toBe(
      false
    );
    expect(
      isSafeSvg('<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>', {
        embedded: true
      })
    ).toBe(false);
  });

  it("refuses what is not text", () => {
    expect(checkSvg(undefined)).toEqual({ ok: false, reason: "not text" });
  });

  it("reads a leading byte order mark as nothing", () => {
    expect(isSafeSvg("﻿<svg/>")).toBe(true);
  });
});
