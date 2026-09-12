import { describe, expect, it } from "vitest";
import {
  githubApiUrl,
  hasSourceBinding,
  resolveSourceUrl,
  SYNC_FRONTMATTER_KEY,
  type SourceTarget
} from "./sync-source";

function target(raw: string): SourceTarget {
  const result = resolveSourceUrl(raw);
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.target;
}

function ok(raw: string): string {
  const result = resolveSourceUrl(raw);
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.url;
}

function reason(raw: unknown): string {
  const result = resolveSourceUrl(raw);
  if (result.ok) throw new Error("expected a rejection");
  return result.reason;
}

describe("resolveSourceUrl", () => {
  it("accepts a raw Markdown URL unchanged", () => {
    const url = "https://raw.githubusercontent.com/org/repo/main/docs/a.md";
    expect(ok(url)).toBe(url);
  });

  it("rewrites a GitHub blob URL to raw", () => {
    expect(ok("https://github.com/org/repo/blob/main/docs/a.md")).toBe(
      "https://raw.githubusercontent.com/org/repo/main/docs/a.md"
    );
  });

  it("rewrites a GitHub raw page URL to raw", () => {
    expect(ok("https://github.com/org/repo/raw/main/a.md")).toBe(
      "https://raw.githubusercontent.com/org/repo/main/a.md"
    );
  });

  it("reports that it rewrote the URL", () => {
    const result = resolveSourceUrl("https://github.com/org/repo/blob/main/a.md");
    expect(result.ok && result.rewritten).toBe(true);
  });

  it("keeps nested paths when rewriting", () => {
    expect(ok("https://github.com/org/repo/blob/main/a/b/c.md")).toBe(
      "https://raw.githubusercontent.com/org/repo/main/a/b/c.md"
    );
  });

  it("accepts a Markdown file on any other host", () => {
    expect(ok("https://example.com/docs/readme.md")).toBe("https://example.com/docs/readme.md");
  });

  it("accepts other Markdown extensions", () => {
    expect(ok("https://example.com/a.markdown")).toContain(".markdown");
  });

  it("strips surrounding quotes and angle brackets", () => {
    expect(ok('"https://example.com/a.md"')).toBe("https://example.com/a.md");
    expect(ok("<https://example.com/a.md>")).toBe("https://example.com/a.md");
  });

  it("rejects plain HTTP", () => {
    expect(reason("http://example.com/a.md")).toContain("HTTPS");
  });

  it("rejects a non-Markdown path", () => {
    expect(reason("https://example.com/page.html")).toContain("Markdown");
  });

  it("rejects a GitHub repository URL", () => {
    expect(reason("https://github.com/org/repo")).toContain("Markdown");
  });

  it("rejects a GitHub issue URL", () => {
    expect(reason("https://github.com/org/repo/issues/1")).toContain("Markdown");
  });

  it("rejects a file protocol URL", () => {
    expect(reason("file:///etc/passwd")).toContain("HTTPS");
  });

  it("rejects nonsense", () => {
    expect(reason("nicht wirklich eine url")).toContain("gültige");
  });

  it("rejects an empty or missing value", () => {
    expect(reason("")).toContain("Keine");
    expect(reason(undefined)).toContain("Keine");
    expect(reason(42)).toContain("Keine");
  });
});

describe("hasSourceBinding", () => {
  it("detects the binding key", () => {
    expect(hasSourceBinding({ [SYNC_FRONTMATTER_KEY]: "https://example.com/a.md" })).toBe(true);
  });

  it("ignores a blank value", () => {
    expect(hasSourceBinding({ [SYNC_FRONTMATTER_KEY]: "  " })).toBe(false);
  });

  it("ignores a note with no frontmatter", () => {
    expect(hasSourceBinding(undefined)).toBe(false);
  });
});

describe("source targets", () => {
  it("describes a GitHub blob URL as a GitHub source", () => {
    expect(target("https://github.com/org/repo/blob/main/docs/a.md")).toEqual({
      kind: "github",
      owner: "org",
      repo: "repo",
      ref: "main",
      path: "docs/a.md"
    });
  });

  it("describes a raw GitHub URL as a GitHub source too", () => {
    expect(target("https://raw.githubusercontent.com/org/repo/main/docs/a.md")).toEqual({
      kind: "github",
      owner: "org",
      repo: "repo",
      ref: "main",
      path: "docs/a.md"
    });
  });

  it("keeps a branch name with no slashes intact", () => {
    const result = target("https://github.com/org/repo/blob/feature-x/a.md");
    expect(result).toMatchObject({ ref: "feature-x", path: "a.md" });
  });

  it("describes any other host as a plain URL", () => {
    expect(target("https://example.com/docs/a.md")).toEqual({ kind: "url" });
  });
});

describe("githubApiUrl", () => {
  it("builds a contents endpoint with the ref", () => {
    expect(
      githubApiUrl({ kind: "github", owner: "org", repo: "repo", ref: "main", path: "docs/a.md" })
    ).toBe("https://api.github.com/repos/org/repo/contents/docs/a.md?ref=main");
  });

  it("encodes each path segment without escaping the separators", () => {
    expect(
      githubApiUrl({
        kind: "github",
        owner: "org",
        repo: "repo",
        ref: "main",
        path: "a b/c d.md"
      })
    ).toContain("/contents/a%20b/c%20d.md");
  });

  it("encodes the ref", () => {
    expect(
      githubApiUrl({ kind: "github", owner: "org", repo: "repo", ref: "feat/x", path: "a.md" })
    ).toContain("?ref=feat%2Fx");
  });
});
