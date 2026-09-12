import { describe, expect, it } from "vitest";
import {
  describePublishError,
  parsePlan,
  parseSummary,
  parseTargets,
  summarisePlan
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
    expect(plan.uploadAssets[0].name).toBe("b.png");
    expect(plan.willDelete).toEqual(["alt/index.html"]);
    expect(plan.unchangedSources).toBe(4);
  });

  it("treats a missing list as an empty one", () => {
    const plan = parsePlan({});
    expect(plan.uploadSources).toEqual([]);
    expect(plan.willDelete).toEqual([]);
    expect(plan.notes).toBe(0);
  });
});

describe("parseSummary", () => {
  it("reads the counts a publish reports", () => {
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

describe("summarisePlan", () => {
  const plan = parsePlan({ notes: 5, unchangedSources: 5 });

  it("says plainly when there is nothing to send", () => {
    expect(summarisePlan(plan)).toContain("nichts zu übertragen");
  });

  it("counts what will move", () => {
    const busy = parsePlan({
      notes: 5,
      uploadSources: [{ sourcePath: "a.md" }],
      uploadAssets: [{ sourcePath: "b.png" }],
      willDelete: ["x"]
    });
    expect(summarisePlan(busy)).toContain("1 zu übertragen");
    expect(summarisePlan(busy)).toContain("1 Medien");
    expect(summarisePlan(busy)).toContain("1 zu löschen");
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
