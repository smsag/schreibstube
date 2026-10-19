import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  checkSharePassword,
  expiresAtFor,
  generateSharePassword,
  linksOfNote,
  MAX_SHARE_ASSET_BYTES,
  MAX_SHARE_ASSETS,
  parseSharedLink,
  parseSharedLinks,
  pickShareAssets,
  type SharedLink
} from "./share-link";

const NOW = Date.parse("2026-10-19T12:00:00Z");

function link(overrides: Partial<SharedLink> = {}): SharedLink {
  return {
    code: "ABCDEFGHJK",
    url: "https://blog.example.com/s/ABCDEFGHJK/",
    title: "Angebot",
    sourcePath: "Kunden/Angebot.md",
    createdAt: "2026-10-19T12:00:00.000Z",
    updatedAt: "2026-10-19T12:00:00.000Z",
    expiresAt: null,
    protected: true,
    ...overrides
  };
}

describe("expiresAtFor", () => {
  it("counts whole days from now, and gives no end for a link kept until taken down", () => {
    expect(expiresAtFor("1d", NOW)).toBe("2026-10-20T12:00:00.000Z");
    expect(expiresAtFor("7d", NOW)).toBe("2026-10-26T12:00:00.000Z");
    expect(expiresAtFor("90d", NOW)).toBe("2027-01-17T12:00:00.000Z");
    expect(expiresAtFor("never", NOW)).toBeNull();
  });
});

describe("generateSharePassword", () => {
  it("writes four groups of four from letters that do not read alike", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateSharePassword()).toMatch(/^[a-km-np-z2-9]{4}(-[a-km-np-z2-9]{4}){3}$/);
    }
  });

  it("throws back the bytes past the last whole alphabet", () => {
    let call = 0;
    const random = (length: number) =>
      new Uint8Array(call++ === 0 ? [255, 0, 31] : Array<number>(length).fill(1));
    expect(generateSharePassword(random)).toBe("aabb-bbbb-bbbb-bbbb");
  });

  it("is checked by the bridge's own rule", () => {
    expect(checkSharePassword(generateSharePassword())).toBe("ok");
  });
});

describe("checkSharePassword", () => {
  it("counts characters as typed, not code units", () => {
    expect(checkSharePassword("")).toBe("none");
    expect(checkSharePassword("kurz")).toBe("short");
    expect(checkSharePassword("😀😀😀😀😀😀😀")).toBe("short");
    expect(checkSharePassword("x".repeat(257))).toBe("long");
    expect(checkSharePassword("korrekt-pferd")).toBe("ok");
  });
});

describe("pickShareAssets", () => {
  it("carries pictures in the note's order, once each, and names the rest", () => {
    const picked = pickShareAssets([
      { path: "A/bild.png", bytes: 10 },
      { path: "A/film.mp4", bytes: 10 },
      { path: "A/bild.png", bytes: 10 },
      { path: "A/plan.pdf", bytes: 10 },
      { path: "A/Foto.JPG", bytes: 10 }
    ]);
    expect(picked.carried.map((entry) => entry.path)).toEqual(["A/bild.png", "A/Foto.JPG"]);
    expect(picked.left).toEqual(["A/film.mp4", "A/plan.pdf"]);
  });

  it("stops at the bridge's budget, by weight and by count", () => {
    const heavy = pickShareAssets([
      { path: "a.png", bytes: MAX_SHARE_ASSET_BYTES - 5 },
      { path: "b.png", bytes: 10 },
      { path: "c.png", bytes: 5 }
    ]);
    expect(heavy.carried.map((entry) => entry.path)).toEqual(["a.png", "c.png"]);
    expect(heavy.left).toEqual(["b.png"]);

    const many = pickShareAssets(
      Array.from({ length: MAX_SHARE_ASSETS + 2 }, (_, i) => ({ path: `${i}.png`, bytes: 1 }))
    );
    expect(many.carried).toHaveLength(MAX_SHARE_ASSETS);
    expect(many.left).toEqual([`${MAX_SHARE_ASSETS}.png`, `${MAX_SHARE_ASSETS + 1}.png`]);
  });
});

describe("bytesToBase64", () => {
  it("encodes what Buffer encodes, across chunk boundaries", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });
});

describe("parseSharedLink", () => {
  it("keeps a link the bridge describes", () => {
    expect(
      parseSharedLink({ ...link(), expiresAt: "2026-10-26T12:00:00.000Z", files: [] })
    ).toEqual(link({ expiresAt: "2026-10-26T12:00:00.000Z" }));
  });

  it("refuses an address that is not a web page under the code it names", () => {
    expect(parseSharedLink(link({ url: "javascript:alert(1)//s/ABCDEFGHJK/" }))).toBeNull();
    expect(parseSharedLink(link({ url: "https://blog.example.com/s/ZZZZZZZZZZ/" }))).toBeNull();
    expect(parseSharedLink(link({ url: "nicht einmal eine Adresse" }))).toBeNull();
    expect(parseSharedLink(link({ code: "../../etc" }))).toBeNull();
  });

  it("reads a closing time that is not one as no end, and anything but true as open", () => {
    const parsed = parseSharedLink({ ...link(), expiresAt: "bald", protected: "yes" });
    expect(parsed).toMatchObject({ expiresAt: null, protected: false });
  });
});

describe("parseSharedLinks", () => {
  it("drops what does not read", () => {
    expect(parseSharedLinks({ shares: [link(), { code: "x" }, null] })).toEqual([link()]);
    expect(parseSharedLinks({})).toEqual([]);
  });
});

describe("linksOfNote", () => {
  it("lists one note's links, newest first", () => {
    const older = link({ code: "BCDEFGHJKL", createdAt: "2026-10-01T00:00:00.000Z" });
    const newer = link();
    const other = link({ code: "CDEFGHJKLM", sourcePath: "Anderes.md" });
    expect(linksOfNote([older, other, newer], "Kunden/Angebot.md")).toEqual([newer, older]);
  });
});
