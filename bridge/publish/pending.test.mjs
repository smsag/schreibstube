import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  matches,
  MAX_PENDING_ENTRIES,
  normalizePending,
  orphanUploads,
  PENDING_VERSION,
  serializePending,
  UploadQuota
} from "./pending.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const entry = (text) => ({ sha256: hash(text), bytes: Buffer.byteLength(text) });
const ASSET = "assets/0123456789ab-bild.png";
const THUMB = "assets/thumbs/0123456789ab-bild.jpg";

describe("normalizePending", () => {
  it("reads back what it wrote", () => {
    const pending = new Map([
      [ASSET, entry("a")],
      [THUMB, entry("b")]
    ]);
    expect(normalizePending(JSON.parse(serializePending("blog", pending)))).toEqual(pending);
  });

  it("keeps only the names the bridge gives uploads, since the next commit may delete them", () => {
    const files = {
      [ASSET]: entry("a"),
      "index.html": entry("b"),
      "erste/index.html": entry("c"),
      "assets/theme.css": entry("d"),
      "assets/0123456789ab-../../etc/passwd.png": entry("e"),
      "assets/0123456789ab-x\u0000.png": entry("f")
    };
    expect([...normalizePending({ version: PENDING_VERSION, files }).keys()]).toEqual([ASSET]);
  });

  it("drops an entry whose hash or size is not one", () => {
    const files = {
      [ASSET]: { sha256: "nope", bytes: 1 },
      [THUMB]: { sha256: hash("x"), bytes: -1 }
    };
    expect(normalizePending({ version: PENDING_VERSION, files }).size).toBe(0);
  });

  it("starts empty from nothing, another version, or something else", () => {
    for (const raw of [null, undefined, "x", { version: 99, files: {} }, { version: 1 }]) {
      expect(normalizePending(raw).size).toBe(0);
    }
  });

  it("reads no more entries than a record may hold", () => {
    const files = {};
    for (let i = 0; i < MAX_PENDING_ENTRIES + 5; i += 1) {
      files[`assets/${String(i).padStart(12, "0")}-x.png`] = entry("x");
    }
    expect(normalizePending({ version: PENDING_VERSION, files }).size).toBe(MAX_PENDING_ENTRIES);
  });
});

describe("orphanUploads", () => {
  it("names the pending uploads the new manifest does not keep", () => {
    const pending = new Map([
      [THUMB, entry("b")],
      [ASSET, entry("a")]
    ]);
    expect(orphanUploads(pending, { [ASSET]: entry("a") })).toEqual([THUMB]);
    expect(orphanUploads(pending, {})).toEqual([ASSET, THUMB]);
    // Own keys only: a manifest is a plain object read from JSON.
    expect(orphanUploads(new Map([["constructor", entry("c")]]), {})).toEqual(["constructor"]);
  });
});

describe("matches", () => {
  it("takes the bytes an entry promises and nothing else", () => {
    expect(matches(Buffer.from("abc"), entry("abc"))).toBe(true);
    expect(matches(Buffer.from("abd"), entry("abc"))).toBe(false);
    expect(matches(Buffer.from("abc"), { ...entry("abc"), bytes: 4 })).toBe(false);
  });
});

describe("UploadQuota", () => {
  it("counts uploads and bytes per target, and refuses past either limit", () => {
    const quota = new UploadQuota({ maxBytes: 100, maxUploads: 3 });
    quota.admit("blog", 40);
    quota.admit("blog", 40);
    expect(() => quota.admit("blog", 30)).toThrow(/limit is 3 and 100/);
    quota.admit("blog", 20);
    expect(() => quota.admit("blog", 0)).toThrow(expect.objectContaining({ status: 413 }));
    expect(quota.used("blog")).toEqual({ uploads: 3, bytes: 100 });
    // Another target has its own allowance.
    quota.admit("notizen", 100);
  });

  it("starts afresh once a commit took what was sent", () => {
    const quota = new UploadQuota({ maxBytes: 10, maxUploads: 1 });
    quota.admit("blog", 10);
    quota.reset("blog");
    expect(quota.used("blog")).toEqual({ uploads: 0, bytes: 0 });
    quota.admit("blog", 10);
  });

  it("answers in the shape the client reads", () => {
    const quota = new UploadQuota({ maxBytes: 1, maxUploads: 1 });
    try {
      quota.admit("blog", 2);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ status: 413, code: "quota_exceeded" });
    }
  });
});
