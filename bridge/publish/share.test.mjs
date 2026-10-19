import { describe, expect, it } from "vitest";
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
  nextExpiry,
  normalizeShares,
  renderShare,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
  SHARE_ITERATIONS,
  ShareError,
  shareHtaccess,
  sharePage,
  sharePlaintext,
  shareUrl
} from "./share.mjs";
import { decryptPayload, readPayload, WrongPasswordError } from "./client/share-unlock.mjs";

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
  it("draws ten characters of the alphabet that reads without mistakes", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = newShareCode();
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      expect(isShareCode(code)).toBe(true);
      expect([...code].every((char) => SHARE_CODE_ALPHABET.includes(char))).toBe(true);
    }
  });

  it("throws back the bytes past the last whole alphabet, so no character is favoured", () => {
    let call = 0;
    // 255 lies past 4 × 57 and must be skipped; 0 and 57 both mean "A".
    const random = (n) => Buffer.from(call++ === 0 ? [255, 0, 57] : Array(n).fill(1));
    expect(newShareCode(random)).toBe(`AA${"B".repeat(8)}`);
  });
});

describe("isShareCode", () => {
  it("refuses what could be read two ways, or reach outside the directory", () => {
    expect(isShareCode("ABCDEFGHJK")).toBe(true);
    expect(isShareCode("ABCDEFGHJ0")).toBe(false);
    expect(isShareCode("../../etc1")).toBe(false);
    expect(isShareCode("ABCDEFGHJ")).toBe(false);
    expect(isShareCode(42)).toBe(false);
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
  it("drops records that do not read, and files outside their own directory", () => {
    const shares = normalizeShares({
      shares: [
        {
          code: "ABCDEFGHJK",
          title: "Angebot",
          expiresAt: "2026-10-20T00:00:00.000Z",
          protected: true,
          files: ["s/ABCDEFGHJK/index.html", "index.html", "s/ABCDEFGHJK/../x.html", 4]
        },
        { code: "ABCDEFGHJK", title: "twice" },
        { code: "../x" },
        null,
        { code: "BCDEFGHJKL", expiresAt: "bald", files: "all" }
      ]
    });
    expect([...shares.keys()]).toEqual(["ABCDEFGHJK", "BCDEFGHJKL"]);
    expect(shares.get("ABCDEFGHJK")).toMatchObject({
      title: "Angebot",
      protected: true,
      files: ["s/ABCDEFGHJK/index.html"]
    });
    expect(shares.get("BCDEFGHJKL")).toMatchObject({ expiresAt: null, files: [], title: "" });
    expect(normalizeShares(null).size).toBe(0);
  });
});

describe("expiredShares and nextExpiry", () => {
  const shares = normalizeShares({
    shares: [
      { code: "ABCDEFGHJK", expiresAt: "2026-10-19T11:00:00.000Z" },
      { code: "BCDEFGHJKL", expiresAt: "2026-10-21T00:00:00.000Z" },
      { code: "CDEFGHJKLM" }
    ]
  });

  it("names the links whose time is up", () => {
    expect(expiredShares(shares, NOW)).toEqual(["ABCDEFGHJK"]);
  });

  it("says when the next one runs out, or that none will", () => {
    expect(nextExpiry(shares)).toBe(Date.parse("2026-10-19T11:00:00.000Z"));
    expect(nextExpiry(normalizeShares({ shares: [{ code: "CDEFGHJKLM" }] }))).toBeNull();
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
    expect(text).toContain("noindex");
    expect(text).toContain("no-store");
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
    expect(page).toContain('content="noindex, nofollow"');
    expect(page).toContain('<meta name="referrer" content="no-referrer">');
    expect(page).toContain('href="katex/katex.css"');
    expect(page).toContain('src="slideshow.js"');
    expect(page).not.toContain("unlock.js");
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
