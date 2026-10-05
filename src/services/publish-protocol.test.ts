import { describe, expect, it } from "vitest";
import {
  COMMIT_REQUEST_TIMEOUT_MS,
  MAX_PLAN_ENTRIES,
  MAX_PUBLISH_RESPONSE_BYTES,
  describePublishError,
  isEmptyPlan,
  parseHealth,
  parsePlan,
  parseSummary,
  parseTargets
} from "./publish-protocol";

/** Everything the bridge returns is remote JSON, so each field is validated. */

describe("parseTargets", () => {
  it("reads the targets a bridge offers", () => {
    expect(
      parseTargets({ targets: [{ name: "blog", baseUrl: "https://x", siteTitle: "Blog" }] })
    ).toEqual([{ name: "blog", baseUrl: "https://x", siteTitle: "Blog" }]);
  });

  it("survives a response that is not shaped like one", () => {
    expect(parseTargets({})).toEqual([]);
    expect(parseTargets(null)).toEqual([]);
  });

  it("replaces a missing field rather than carrying undefined into the UI", () => {
    expect(parseTargets({ targets: [{}] })).toEqual([{ name: "", baseUrl: "", siteTitle: "" }]);
  });

  it("keeps only a web address as the site's, since it is opened and written into notes", () => {
    const targets = parseTargets({
      targets: [
        { name: "a", baseUrl: "javascript:alert(1)" },
        { name: "b", baseUrl: "file:///etc/passwd" },
        { name: "c", baseUrl: "blog.example.com" },
        { name: "d", baseUrl: "http://localhost:8080/site" }
      ]
    });
    expect(targets.map((target) => target.baseUrl)).toEqual([
      "",
      "",
      "",
      "http://localhost:8080/site"
    ]);
  });
});

describe("parseHealth", () => {
  it("reads what the bridge says it is, dropping a capability with no name", () => {
    expect(parseHealth({ version: "1.2", protocol: 5, capabilities: ["publish", 7, ""] })).toEqual({
      version: "1.2",
      protocol: 5,
      capabilities: ["publish"]
    });
  });

  it("reads the protocol from the answer a bridge gives a caller without a token", () => {
    // Bridge 3 names its version and capabilities only to a token holder; the
    // handshake needs the protocol alone.
    expect(parseHealth({ status: "ok", protocol: 8 })).toEqual({
      version: "",
      protocol: 8,
      capabilities: []
    });
  });

  it("reads nothing into a body that is not a health answer", () => {
    expect(parseHealth("nope")).toEqual({ version: "", protocol: 0, capabilities: [] });
  });
});

describe("parsePlan", () => {
  it("reads a plan", () => {
    const plan = parsePlan({
      target: "blog",
      baseUrl: "https://blog.example.com",
      uploadSources: [{ sourcePath: "a.md", sha256: "abc" }],
      uploadAssets: [{ sourcePath: "b.png", sha256: "def", name: "b.png", path: "assets/x.png" }],
      willDelete: ["alt/index.html"],
      unchangedSources: 4,
      notes: 5
    });

    expect(plan.uploadSources).toEqual([
      { sourcePath: "a.md", sha256: "abc", name: undefined, path: undefined }
    ]);
    expect(plan.uploadAssets[0]?.name).toBe("b.png");
    expect(plan.willDelete).toEqual(["alt/index.html"]);
    expect(plan.unchangedSources).toBe(4);
  });

  it("treats a missing list as an empty one", () => {
    const plan = parsePlan({});
    expect(plan.uploadSources).toEqual([]);
    expect(plan.willDelete).toEqual([]);
    // A bridge before protocol 8 names no conflicts.
    expect(plan.conflicts).toEqual([]);
    expect(plan.notes).toBe(0);
  });

  it("reads the files on the host the bridge will not overwrite, and nothing else", () => {
    const plan = parsePlan({ conflicts: ["index.html", 42, "", "assets/x.png"] });
    expect(plan.conflicts).toEqual(["index.html", "assets/x.png"]);
    const many = Array.from({ length: MAX_PLAN_ENTRIES + 5 }, (_, i) => `f${i}`);
    expect(parsePlan({ conflicts: many }).conflicts).toHaveLength(MAX_PLAN_ENTRIES);
  });

  it("reads no more entries than a site could have", () => {
    const many = Array.from({ length: MAX_PLAN_ENTRIES + 5 }, (_, i) => `f${i}`);
    const plan = parsePlan({
      uploadSources: many.map((sourcePath) => ({ sourcePath, sha256: "x" })),
      uploadAssets: many.map((sourcePath) => ({ sourcePath, sha256: "x" })),
      uploadThumbnails: many.map((sourcePath) => ({ sourcePath, sha256: "x" })),
      willDelete: many
    });
    expect(plan.uploadSources).toHaveLength(MAX_PLAN_ENTRIES);
    expect(plan.uploadAssets).toHaveLength(MAX_PLAN_ENTRIES);
    expect(plan.uploadThumbnails).toHaveLength(MAX_PLAN_ENTRIES);
    expect(plan.willDelete).toHaveLength(MAX_PLAN_ENTRIES);
  });

  it("blanks a site address that is not a web one", () => {
    expect(parsePlan({ baseUrl: "javascript:void 0" }).baseUrl).toBe("");
    expect(parseSummary({ baseUrl: "file:///x" }).baseUrl).toBe("");
    expect(parseSummary({ baseUrl: "https://blog.example.com" }).baseUrl).toBe(
      "https://blog.example.com"
    );
  });
});

describe("parseSummary", () => {
  it("reads the counts a publish reports", () => {
    expect(parseSummary({ written: 3, unchanged: 2, deleted: 1, deleteFailed: 0 })).toMatchObject({
      deleteFailed: 0
    });
    expect(parseSummary({ written: 3, unchanged: 2, deleted: 1, durationMs: 900 })).toMatchObject({
      written: 3,
      unchanged: 2,
      deleted: 1,
      durationMs: 900
    });
  });

  it("replaces a non-numeric count with zero", () => {
    expect(parseSummary({ written: "viele" }).written).toBe(0);
  });
});

describe("thumbnails in a plan", () => {
  it("reads the thumbnails a protocol-2 bridge asks for", () => {
    const plan = parsePlan({
      notes: 1,
      uploadThumbnails: [{ sourcePath: "Blog/haus.jpg", sha256: "a".repeat(64), name: "haus.jpg" }]
    });
    expect(plan.uploadThumbnails).toEqual([
      { sourcePath: "Blog/haus.jpg", sha256: "a".repeat(64), name: "haus.jpg" }
    ]);
  });

  it("reads none from a protocol-1 bridge, which never sends the field", () => {
    expect(parsePlan({ notes: 1 }).uploadThumbnails).toEqual([]);
  });

  it("does not call a plan empty while a thumbnail is missing", () => {
    const plan = parsePlan({ uploadThumbnails: [{ sourcePath: "a.jpg", sha256: "b" }] });
    expect(isEmptyPlan(plan)).toBe(false);
  });
});

describe("describePublishError", () => {
  it("explains a rejected token in terms of the setting to fix", () => {
    expect(describePublishError(401, '{"error":"Unauthorized."}')).toMatch(/token/i);
  });

  it("passes on what the bridge said about an unknown target", () => {
    expect(describePublishError(404, '{"error":"No such publish target: blog."}')).toContain(
      "No such publish target"
    );
  });

  it("suggests a redeploy when the route itself is missing", () => {
    expect(describePublishError(404, "")).toMatch(/redeploy/i);
  });

  it("names the web host for an upstream failure", () => {
    expect(describePublishError(502, '{"error":"Host key mismatch"}')).toContain(
      "Host key mismatch"
    );
    expect(describePublishError(502, "")).toMatch(/web host/);
  });

  it("explains a publish that collided with another", () => {
    expect(
      describePublishError(409, '{"error":"A publish to blog is already running."}')
    ).toContain("already running");
  });

  it("explains a restarting bridge", () => {
    expect(describePublishError(503, "")).toMatch(/restarting/i);
  });

  it("falls back to the raw body when the response is not JSON", () => {
    expect(describePublishError(500, "<html>gateway</html>")).toContain("gateway");
  });
});

describe("COMMIT_REQUEST_TIMEOUT_MS", () => {
  it("outlasts the 300 s the bridge allows a commit, so success is never reported as failure", () => {
    expect(COMMIT_REQUEST_TIMEOUT_MS).toBeGreaterThan(300_000);
  });
});

describe("isEmptyPlan", () => {
  const plan = (overrides = {}) =>
    parsePlan({ notes: 0, willDelete: [], uploadSources: [], uploadAssets: [], ...overrides });

  it("is empty when nothing is published, uploaded or deleted", () => {
    expect(isEmptyPlan(plan())).toBe(true);
  });

  it("is not empty while a page is left to take down", () => {
    expect(isEmptyPlan(plan({ willDelete: ["erste/index.html"] }))).toBe(false);
  });

  it("is not empty with a note to publish, even an unchanged one", () => {
    expect(isEmptyPlan(plan({ notes: 1 }))).toBe(false);
  });
});

describe("MAX_PUBLISH_RESPONSE_BYTES", () => {
  it("holds the plan for two thousand notes with a picture and a thumbnail each", () => {
    const path = `Blog/${"Unterordner/".repeat(8)}Eine recht lange Überschrift einer Notiz`;
    const hash = "a".repeat(64);
    const entries = (suffix: string) =>
      Array.from({ length: 2000 }, (_, i) => ({
        sourcePath: `${path} ${i}.${suffix}`,
        sha256: hash,
        name: `Bild ${i}.${suffix}`,
        path: `assets/${hash.slice(0, 12)}-bild-${i}.${suffix}`
      }));
    const plan = JSON.stringify({
      target: "blog",
      baseUrl: "https://blog.example.com",
      uploadSources: entries("md"),
      uploadAssets: entries("png"),
      uploadThumbnails: entries("jpg"),
      willDelete: entries("html").map((entry) => entry.path),
      conflicts: entries("html").map((entry) => entry.path),
      unchangedSources: 0,
      notes: 2000
    });
    expect(new TextEncoder().encode(plan).byteLength * 2).toBeLessThan(MAX_PUBLISH_RESPONSE_BYTES);
  });
});
