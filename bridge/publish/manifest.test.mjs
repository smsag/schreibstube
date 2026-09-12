import { describe, expect, it } from "vitest";
import {
  MANIFEST_VERSION,
  buildManifest,
  diffOutputs,
  emptyManifest,
  normalizeManifest,
  orphanSources,
  planUploads
} from "./manifest.mjs";

/**
 * The manifest decides what may be deleted, so these tests are mostly about
 * restraint: nothing the bridge did not write is ever a candidate.
 */

const hash = (value) => `${value}`.padEnd(64, "0");
const content = (value) => Buffer.from(value);
const fakeHash = (buffer) => `hash:${buffer.toString()}`;

function index({ notes = [], assets = [] } = {}) {
  return { siteTitle: "S", notes, assets };
}

function note(slug, sourcePath = `${slug}.md`, sha = hash(slug)) {
  return { sourcePath, sha256: sha, slug, title: slug, date: "2026-01-01" };
}

describe("normalizeManifest", () => {
  it("treats a missing manifest as a first publish", () => {
    expect(normalizeManifest(null, "blog").files).toEqual({});
  });

  it("treats a manifest from another version as a first publish", () => {
    expect(normalizeManifest({ version: 99, files: { "a.html": {} } }, "blog").files).toEqual({});
  });

  it("keeps a manifest of the current version", () => {
    const files = { "a.html": { sha256: "x", bytes: 1 } };
    expect(normalizeManifest({ version: MANIFEST_VERSION, files }, "blog").files).toEqual(files);
  });
});

describe("planUploads", () => {
  it("asks for every source on a first publish", () => {
    const plan = planUploads({
      index: index({ notes: [note("a"), note("b")] }),
      manifest: emptyManifest("blog"),
      storedSourceHashes: []
    });
    expect(plan.uploadSources.map((entry) => entry.sourcePath)).toEqual(["a.md", "b.md"]);
    expect(plan.unchangedSources).toBe(0);
  });

  it("asks for nothing when every source is already stored", () => {
    const plan = planUploads({
      index: index({ notes: [note("a")] }),
      manifest: emptyManifest("blog"),
      storedSourceHashes: [hash("a")]
    });
    expect(plan.uploadSources).toEqual([]);
    expect(plan.unchangedSources).toBe(1);
  });

  it("uploads a renamed note's content only once", () => {
    const shared = hash("gleich");
    const plan = planUploads({
      index: index({ notes: [note("a", "a.md", shared), note("b", "b.md", shared)] }),
      manifest: emptyManifest("blog"),
      storedSourceHashes: []
    });
    expect(plan.uploadSources).toHaveLength(1);
  });

  it("asks for an asset that is not published yet", () => {
    const plan = planUploads({
      index: index({ assets: [{ sourcePath: "bild.png", sha256: hash("i"), name: "bild.png" }] }),
      manifest: emptyManifest("blog"),
      storedSourceHashes: []
    });
    expect(plan.uploadAssets[0].path).toMatch(/^assets\/i0{11}-bild\.png$/);
  });

  it("leaves a published asset alone", () => {
    const path = `assets/${hash("i").slice(0, 12)}-bild.png`;
    const plan = planUploads({
      index: index({ assets: [{ sourcePath: "bild.png", sha256: hash("i"), name: "bild.png" }] }),
      manifest: { ...emptyManifest("blog"), files: { [path]: { sha256: "x" } } },
      storedSourceHashes: []
    });
    expect(plan.uploadAssets).toEqual([]);
  });

  it("plans to delete a page whose note is gone", () => {
    const plan = planUploads({
      index: index({ notes: [note("a")] }),
      manifest: {
        ...emptyManifest("blog"),
        files: { "a/index.html": {}, "weg/index.html": {} }
      },
      storedSourceHashes: []
    });
    expect(plan.willDelete).toEqual(["weg/index.html"]);
  });

  it("plans to delete an asset that nothing references any more", () => {
    const plan = planUploads({
      index: index({}),
      manifest: {
        ...emptyManifest("blog"),
        files: { "assets/aaaaaaaaaaaa-alt.png": {} }
      },
      storedSourceHashes: []
    });
    expect(plan.willDelete).toEqual(["assets/aaaaaaaaaaaa-alt.png"]);
  });

  it("never plans to delete a generator asset, which rendering decides", () => {
    const plan = planUploads({
      index: index({}),
      manifest: {
        ...emptyManifest("blog"),
        files: {
          "assets/theme.css": {},
          "assets/katex/katex.css": {},
          "assets/mermaid.min.js": {},
          "index.html": {}
        }
      },
      storedSourceHashes: []
    });
    expect(plan.willDelete).toEqual([]);
  });
});

describe("diffOutputs", () => {
  const manifest = {
    ...emptyManifest("blog"),
    files: {
      "a/index.html": { sha256: fakeHash(content("a")) },
      "alt/index.html": { sha256: fakeHash(content("alt")) }
    }
  };

  it("writes what changed and leaves what did not", () => {
    const files = new Map([
      ["a/index.html", content("a")],
      ["b/index.html", content("b")]
    ]);
    const difference = diffOutputs(files, manifest, fakeHash);
    expect(difference.unchanged).toEqual(["a/index.html"]);
    expect(difference.write).toEqual(["b/index.html"]);
  });

  it("deletes what the new site no longer contains", () => {
    const files = new Map([["a/index.html", content("a")]]);
    expect(diffOutputs(files, manifest, fakeHash).delete).toEqual(["alt/index.html"]);
  });

  it("writes everything on a first publish", () => {
    const files = new Map([["a/index.html", content("a")]]);
    const difference = diffOutputs(files, emptyManifest("blog"), fakeHash);
    expect(difference.write).toEqual(["a/index.html"]);
    expect(difference.delete).toEqual([]);
  });
});

describe("buildManifest", () => {
  it("records a hash and a size for every file", () => {
    const manifest = buildManifest({
      target: "blog",
      files: new Map([["a/index.html", content("abc")]]),
      hash: fakeHash,
      renderVersion: 1,
      generator: "test"
    });
    expect(manifest.files["a/index.html"]).toEqual({ sha256: "hash:abc", bytes: 3 });
    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.updatedAt).toMatch(/^\d{4}-/);
  });
});

describe("orphanSources", () => {
  it("collects sources no note refers to any more", () => {
    expect(orphanSources([hash("a"), hash("weg")], index({ notes: [note("a")] }))).toEqual([
      hash("weg")
    ]);
  });

  it("keeps a source two notes share", () => {
    const shared = hash("gleich");
    expect(
      orphanSources([shared], index({ notes: [note("a", "a.md", shared), note("b", "b.md", shared)] }))
    ).toEqual([]);
  });
});
