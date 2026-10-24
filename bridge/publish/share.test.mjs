import { describe, expect, it } from "vitest";
import { StateFileError } from "./state-file.mjs";
import {
  apacheTime,
  checkShareRequest,
  describeShare,
  encryptShare,
  expiredShares,
  isShareCode,
  MAX_SHARE_ASSETS,
  MAX_SHARE_DAYS,
  newShareCode,
  maxShareRequestBytes,
  MAX_SHARE_PAGE_BYTES,
  nextSweep,
  openShares,
  SHARE_CSP,
  normalizeShares,
  renderShare,
  fitsOpenLink,
  robotsKeepsOut,
  SHARE_ROBOTS,
  SHARE_ROBOTS_TXT,
  SHARE_ITERATIONS,
  ShareError,
  shareHtaccess,
  sharePage,
  sharePlaintext,
  shareUrl
} from "./share.mjs";
import { decryptPayload, readPayload, WrongPasswordError } from "./client/share-unlock.mjs";
import { checkIndex } from "./site.mjs";
import { SHARE_WORDS } from "./share-words.mjs";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const limits = { now: NOW, maxSourceBytes: 10_000, maxImageBytes: 1_000 };

function request(overrides = {}) {
  return {
    title: "Angebot",
    sourcePath: "Kunden/Angebot.md",
    source: "# Angebot\n\nText.\n",
    ...overrides
  };
}

describe("newShareCode", () => {
  it("draws two different words for a link with a password", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = newShareCode({ open: false });
      const [first, second, rest] = code.split("-");
      expect(SHARE_WORDS).toContain(first);
      expect(SHARE_WORDS).toContain(second);
      expect(first).not.toBe(second);
      expect(rest).toBeUndefined();
      expect(fitsOpenLink(code)).toBe(false);
    }
  });

  it("adds a number from 10 to 99 for a link without one", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = newShareCode({ open: true });
      expect(code).toMatch(/^[a-z]+-[a-z]+-[1-9][0-9]$/);
      expect(fitsOpenLink(code)).toBe(true);
    }
  });

  it("throws back draws past the last whole multiple, and draws a second word again when it repeats", () => {
    // 65535 lies past the last whole multiple of the list and is skipped;
    // the second draw repeats the first word, so a third is taken.
    const values = [65_535, 0, 0, 1, 0];
    const random = () => {
      const buffer = Buffer.alloc(2);
      buffer.writeUInt16BE(values.shift() ?? 0);
      return buffer;
    };
    expect(newShareCode({ open: true }, random)).toBe(`${SHARE_WORDS[0]}-${SHARE_WORDS[1]}-10`);
  });
});

describe("isShareCode and fitsOpenLink", () => {
  it("reads word codes and the first links' long codes, and nothing that could leave the directory", () => {
    expect(isShareCode("apple-cloud")).toBe(true);
    expect(isShareCode("apple-cloud-42")).toBe(true);
    expect(isShareCode("ABCDEFGHJK")).toBe(true);
    expect(isShareCode("apple-cloud-7")).toBe(false);
    expect(isShareCode("../../etc1")).toBe(false);
    expect(isShareCode("Apple-cloud")).toBe(false);
    expect(isShareCode(42)).toBe(false);
  });

  it("lets a link be read without a password only at an address with a number, or a long one", () => {
    expect(fitsOpenLink("apple-cloud-42")).toBe(true);
    expect(fitsOpenLink("ABCDEFGHJK")).toBe(true);
    expect(fitsOpenLink("apple-cloud")).toBe(false);
  });
});

describe("the word list", () => {
  it("holds over a thousand different words of three to eight letters", () => {
    expect(new Set(SHARE_WORDS).size).toBe(SHARE_WORDS.length);
    expect(SHARE_WORDS.length).toBeGreaterThan(1000);
    for (const word of SHARE_WORDS) expect(word).toMatch(/^[a-z]{3,8}$/);
  });
});

describe("shareUrl", () => {
  it("puts the code under the site's share directory", () => {
    expect(shareUrl("https://writings.example.com/", "ABCDEFGHJK")).toBe(
      "https://writings.example.com/s/ABCDEFGHJK/"
    );
  });
});

describe("checkShareRequest", () => {
  it("keeps the fields it knows, with no password and no end by default", () => {
    expect(checkShareRequest({ ...request(), extra: "dropped" }, limits)).toEqual({
      code: null,
      title: "Angebot",
      sourcePath: "Kunden/Angebot.md",
      source: "# Angebot\n\nText.\n",
      themeCss: undefined,
      assets: [],
      password: null,
      expiresAt: null
    });
  });

  it("reads the closing time as an instant and writes it back in UTC", () => {
    const checked = checkShareRequest(request({ expiresAt: "2026-10-26T14:00:00+02:00" }), limits);
    expect(checked.expiresAt).toBe("2026-10-26T12:00:00.000Z");
  });

  it.each([
    [{ title: " " }, "title"],
    [{ title: "x".repeat(201) }, "title"],
    [{ source: 3 }, "text"],
    [{ source: "x".repeat(10_001) }, "exceeds"],
    [{ sourcePath: "" }, "path"],
    [{ code: "nope" }, "code"],
    [{ password: "kurz" }, "at least"],
    [{ password: 12345678 }, "string"],
    [{ password: "x".repeat(257) }, "at most"],
    [{ expiresAt: "morgen" }, "date"],
    [{ expiresAt: "2026-10-19T11:00:00Z" }, "past"],
    [{ expiresAt: new Date(NOW + (MAX_SHARE_DAYS + 1) * 86_400_000).toISOString() }, "days"],
    [{ themeCss: 4 }, "themeCss"],
    [{ themeCss: "x".repeat(1_000_001) }, "theme"],
    [{ assets: "bild.png" }, "list"],
    [{ assets: [{ data: "" }] }, "path"],
    [{ assets: [{ sourcePath: "film.mp4", data: "" }] }, "picture"],
    [{ assets: [{ sourcePath: "bild.png", data: "!!" }] }, "base64"],
    [
      { assets: [{ sourcePath: "bild.png", data: Buffer.alloc(1_001).toString("base64") }] },
      "exceeds"
    ],
    [
      { assets: [{ sourcePath: "bild.png", data: Buffer.from("<html>").toString("base64") }] },
      "named"
    ],
    [
      {
        assets: [
          { sourcePath: "bild.svg", data: Buffer.from("<svg><script/></svg>").toString("base64") }
        ]
      },
      "named"
    ]
  ])("refuses %j", (overrides, message) => {
    expect(() => checkShareRequest(request(overrides), limits)).toThrow(ShareError);
    expect(() => checkShareRequest(request(overrides), limits)).toThrow(message);
  });

  it("refuses a missing body, and more pictures than a share carries", () => {
    expect(() => checkShareRequest(null, limits)).toThrow(ShareError);
    const many = Array.from({ length: MAX_SHARE_ASSETS + 1 }, () => ({
      sourcePath: "bild.png",
      data: PNG.toString("base64")
    }));
    expect(() => checkShareRequest(request({ assets: many }), limits)).toThrow("at most");
  });

  it("refuses pictures that weigh too much together, each one fitting", () => {
    const big = { ...limits, maxImageBytes: 15_000_000 };
    const picture = Buffer.concat([PNG, Buffer.alloc(9_000_000)]).toString("base64");
    const assets = [0, 1, 2].map(() => ({ sourcePath: "bild.png", data: picture }));
    expect(() => checkShareRequest(request({ assets }), big)).toThrow("together");
  });

  it("decodes the pictures it carries", () => {
    const checked = checkShareRequest(
      request({
        code: "ABCDEFGHJK",
        assets: [{ sourcePath: "A/bild.PNG", data: PNG.toString("base64") }]
      }),
      limits
    );
    expect(checked.code).toBe("ABCDEFGHJK");
    expect(checked.assets).toEqual([{ sourcePath: "A/bild.PNG", extension: "png", bytes: PNG }]);
  });
});

describe("normalizeShares", () => {
  it("reads the records as written, and none at all as no links yet", () => {
    const shares = normalizeShares({
      shares: [
        {
          code: "ABCDEFGHJK",
          title: "Angebot",
          expiresAt: "2026-10-20T00:00:00.000Z",
          protected: true,
          files: ["s/ABCDEFGHJK/index.html"]
        },
        { code: "BCDEFGHJKL" }
      ]
    });
    expect([...shares.keys()]).toEqual(["ABCDEFGHJK", "BCDEFGHJKL"]);
    expect(shares.get("ABCDEFGHJK")).toMatchObject({ title: "Angebot", protected: true });
    expect(shares.get("BCDEFGHJKL")).toMatchObject({ expiresAt: null, files: [], title: "" });
    expect(normalizeShares(null).size).toBe(0);
  });

  it("refuses a file with a record that does not read, rather than losing that link's files", () => {
    const one = { code: "ABCDEFGHJK", files: ["s/ABCDEFGHJK/index.html"] };
    for (const raw of [
      "text",
      { shares: "all" },
      { shares: [null] },
      { shares: [{ code: "../x" }] },
      { shares: [one, one] },
      { shares: [{ ...one, files: ["index.html"] }] },
      { shares: [{ ...one, files: ["s/ABCDEFGHJK/../x.html"] }] },
      { shares: [{ ...one, files: "all" }] },
      { shares: [{ ...one, expiresAt: "bald" }] },
      { shares: [{ ...one, title: 4 }] },
      { shares: [{ ...one, revoked: "yes" }] }
    ]) {
      expect(() => normalizeShares(raw), JSON.stringify(raw)).toThrow(StateFileError);
    }
  });
});

describe("closed links and the sweep", () => {
  const shares = normalizeShares({
    shares: [
      { code: "ABCDEFGHJK", expiresAt: "2026-10-19T11:00:00.000Z" },
      { code: "BCDEFGHJKL", expiresAt: "2026-10-21T00:00:00.000Z" },
      { code: "CDEFGHJKLM" },
      { code: "DEFGHJKLMN", revoked: true }
    ]
  });

  it("names the links whose time is up and those taken down", () => {
    expect(expiredShares(shares, NOW)).toEqual(["ABCDEFGHJK", "DEFGHJKLMN"]);
  });

  it("tells the plugin only of links a reader can open", () => {
    expect(openShares(shares, NOW).map((share) => share.code)).toEqual([
      "BCDEFGHJKL",
      "CDEFGHJKLM"
    ]);
  });

  it("looks again when the next link runs out, or never when none will", () => {
    const open = normalizeShares({
      shares: [
        { code: "BCDEFGHJKL", expiresAt: "2026-10-21T00:00:00.000Z" },
        { code: "CDEFGHJKLM" }
      ]
    });
    expect(nextSweep(open, NOW, 900_000)).toBe(Date.parse("2026-10-21T00:00:00.000Z"));
    expect(nextSweep(normalizeShares({ shares: [{ code: "CDEFGHJKLM" }] }), NOW, 1)).toBeNull();
  });

  it("waits a while before it tries a closed link the host kept again", () => {
    expect(nextSweep(shares, NOW, 900_000)).toBe(NOW + 900_000);
  });
});

describe("maxShareRequestBytes", () => {
  it("admits the largest request the parts allow, and grows with the note's allowance", () => {
    const pictures = Math.ceil((20_000_000 * 4) / 3);
    const escaped = 6 * (2_000_000 + 1_000_000);
    expect(maxShareRequestBytes(2_000_000)).toBeGreaterThan(pictures + escaped);
    expect(maxShareRequestBytes(10_000_000)).toBeGreaterThan(maxShareRequestBytes(2_000_000));
  });
});

describe("describeShare", () => {
  it("tells the plugin the address and never the files", () => {
    const [share] = normalizeShares({
      shares: [{ code: "ABCDEFGHJK", files: ["s/ABCDEFGHJK/index.html"] }]
    }).values();
    const described = describeShare(share, "https://blog.example.com");
    expect(described.url).toBe("https://blog.example.com/s/ABCDEFGHJK/");
    expect(described).not.toHaveProperty("files");
  });
});

describe("apacheTime and shareHtaccess", () => {
  it("writes the instant as Apache's %{TIME} reads it", () => {
    expect(apacheTime("2026-11-02T07:05:09.000Z")).toBe("20261102070509");
  });

  it("closes the link at its time, and keeps it out of caches and indexes", () => {
    const text = shareHtaccess({ expiresAt: "2026-11-02T00:00:00.000Z" });
    expect(text).toContain(`<If "%{TIME} >= '20261102000000'">`);
    expect(text).toContain("Require all denied");
    expect(text).toContain(`X-Robots-Tag "${SHARE_ROBOTS}"`);
    expect(text).toContain('tdm-reservation "1"');
    expect(text).toContain("no-store");
    expect(text).toContain(`Content-Security-Policy "${SHARE_CSP}"`);
    expect(text).toContain("nosniff");
  });

  it("allows no inline script, so a note's own handlers stay inert", () => {
    expect(SHARE_CSP).toContain("script-src 'self'");
    expect(SHARE_CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("denies nothing for a link without an end", () => {
    expect(shareHtaccess({ expiresAt: null })).not.toContain("Require");
  });
});

describe("renderShare", () => {
  const render = (source, assets = []) =>
    renderShare({ source, sourcePath: "Kunden/Angebot.md", assets, allowHtml: true });

  it("leaves links to other notes as their text: the reader cannot follow them", () => {
    const { html } = render("Siehe [[Preise|die Preise]].\n");
    expect(html).toContain("die Preise");
    expect(html).not.toContain("<a");
  });

  it("carries its pictures inside the page", () => {
    const { html } = render("![[bild.png]]\n", [
      { sourcePath: "Anhänge/bild.png", extension: "png", bytes: PNG }
    ]);
    expect(html).toContain(`src="data:image/png;base64,${PNG.toString("base64")}"`);
  });

  it("puts a picture shown twice in twice, and refuses a page past its bound", () => {
    const picture = { sourcePath: "bild.png", extension: "png", bytes: PNG };
    const { html } = render("![[bild.png]] ![[bild.png]]\n", [picture]);
    expect(html.split("data:image/png;base64,")).toHaveLength(3);
    expect(html).not.toContain("schreibstube-share-asset-");

    const big = { ...picture, bytes: Buffer.concat([PNG, Buffer.alloc(2_000_000)]) };
    const many = "![[bild.png]]\n".repeat(Math.ceil(MAX_SHARE_PAGE_BYTES / 2_600_000) + 1);
    expect(() => render(many, [big])).toThrow(ShareError);
  });

  it("names a picture it does not carry, and shows a diagram as its source", () => {
    const { html, usedMermaid } = render("![[film.mp4]]\n\n```mermaid\ngraph TD; A-->B\n```\n");
    expect(html).toContain("film.mp4");
    expect(html).not.toContain("<video");
    expect(html).not.toContain('class="mermaid"');
    expect(usedMermaid).toBe(false);
  });
});

describe("sharePage", () => {
  it("shows an open share with its title, kept from indexes and referrers", () => {
    const page = sharePage({
      title: "Angebot <1>",
      body: "<p>Text</p>\n",
      expiresAt: "2026-11-02T00:00:00.000Z",
      usedMath: true,
      usedSlideshow: true
    });
    expect(page).toContain("<title>Angebot &lt;1&gt;</title>");
    expect(page).toContain("<h1>Angebot &lt;1&gt;</h1>");
    expect(page).toContain(`<meta name="robots" content="${SHARE_ROBOTS}">`);
    expect(page).toContain('<meta name="tdm-reservation" content="1">');
    expect(page).toContain('<meta name="referrer" content="no-referrer">');
    expect(page).toContain('href="katex/katex.css"');
    expect(page).toContain('src="slideshow.js"');
    expect(page).not.toContain("unlock.js");
    expect(page).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(page).toMatch(/script-src (&#39;|')self(&#39;|');/);
  });

  it("leaves the policy to a host that sends it as a header", () => {
    const page = sharePage({ title: "A", body: "", expiresAt: null, csp: null });
    expect(page).not.toContain("Content-Security-Policy");
  });

  it("does not print the title twice when the note opens with its own", () => {
    const page = sharePage({ title: "Angebot", body: "<h1>Eigen</h1>\n", expiresAt: null });
    expect(page).not.toContain("<h1>Angebot</h1>");
    expect(page).not.toContain("schreibstube-expires");
  });

  it("names nothing of a protected share, and carries the script that opens it", () => {
    const encrypted = { v: 1, kdf: "PBKDF2-SHA256", iterations: 1, salt: "", iv: "", data: "" };
    const page = sharePage({ title: "Geheim", body: "<p>x</p>", encrypted, expiresAt: null });
    expect(page).not.toContain("Geheim");
    expect(page).toContain('src="unlock.js"');
    expect(page).toContain('<script type="application/json" id="share-payload">');
  });
});

describe("encryptShare", () => {
  it("opens in the browser with the password, and not with any other", async () => {
    const payload = await encryptShare(
      sharePlaintext({ title: "Angebot", body: "<p>Text</p>\n" }),
      "korrekt-pferd"
    );
    expect(payload.iterations).toBe(SHARE_ITERATIONS);
    expect(readPayload(JSON.stringify(payload))).toEqual(payload);

    await expect(decryptPayload(payload, "korrekt-pferd")).resolves.toEqual({
      title: "Angebot",
      html: "<h1>Angebot</h1>\n<p>Text</p>\n"
    });
    await expect(decryptPayload(payload, "falsches-pferd")).rejects.toBeInstanceOf(
      WrongPasswordError
    );
  });

  it("derives the same key from the same password however it was composed", async () => {
    const payload = await encryptShare(sharePlaintext({ title: "T", body: "" }), "Müller-1234");
    await expect(decryptPayload(payload, "Müller-1234")).resolves.toMatchObject({
      title: "T"
    });
  });
});

describe("the share directory", () => {
  it("is an address no published note may take", () => {
    const note = (slug) => ({ sourcePath: `${slug}.md`, sha256: "a".repeat(64), slug });
    expect(() => checkIndex({ notes: [note("s")], assets: [] })).toThrow("kept for shared links");
    expect(() => checkIndex({ notes: [note("so")], assets: [] })).not.toThrow();
  });
});

describe("what a share tells crawlers", () => {
  it("asks for no index, no copy, no snippet and no use by an AI", () => {
    for (const word of [
      "noindex",
      "nofollow",
      "noarchive",
      "nosnippet",
      "noimageindex",
      "noai",
      "noimageai"
    ]) {
      expect(SHARE_ROBOTS.split(", ")).toContain(word);
    }
  });

  it("writes a robots.txt that names the directory and no link", () => {
    expect(SHARE_ROBOTS_TXT).toContain("User-agent: *\nDisallow: /s/\n");
    expect(robotsKeepsOut(SHARE_ROBOTS_TXT)).toBe(true);
  });

  it("tells a site's own robots.txt that keeps the links out from one that does not", () => {
    expect(robotsKeepsOut("User-agent: *\ndisallow: /s\n")).toBe(true);
    expect(robotsKeepsOut("User-agent: *\nDisallow: /sales/\n")).toBe(false);
    expect(robotsKeepsOut("User-agent: *\nDisallow:\n")).toBe(false);
    expect(robotsKeepsOut(undefined)).toBe(false);
  });
});
