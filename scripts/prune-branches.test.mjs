import { describe, expect, it } from "vitest";
import { CLOSED_GRACE_DAYS, decide, needsCompare, summarize } from "./prune-branches.mjs";

const NOW = new Date("2026-10-21T12:00:00Z");
const daysAgo = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const base = {
  branch: "claude/feature",
  defaultBranch: "main",
  protectedBranch: false,
  compare: "diverged",
  prs: [],
  now: NOW
};

describe("decide", () => {
  it("never touches the default branch or a protected one", () => {
    expect(decide({ ...base, branch: "main" }).action).toBe("keep");
    expect(decide({ ...base, protectedBranch: true, compare: "identical" }).action).toBe("keep");
  });

  it("keeps a branch with an open pull request, merged commits or not", () => {
    const prs = [{ number: 5, state: "open", mergedAt: null, closedAt: null }];
    expect(decide({ ...base, prs, compare: "behind" })).toEqual({
      action: "keep",
      reason: "open pull request"
    });
  });

  it("deletes a branch whose commits are all in the default branch", () => {
    expect(decide({ ...base, compare: "identical" }).action).toBe("delete");
    expect(decide({ ...base, compare: "behind" }).action).toBe("delete");
  });

  it("deletes a branch whose pull request was merged, squashed or rebased", () => {
    const prs = [{ number: 391, state: "closed", mergedAt: daysAgo(0), closedAt: daysAgo(0) }];
    expect(decide({ ...base, prs })).toEqual({
      action: "delete",
      reason: "pull request #391 merged"
    });
  });

  it("waits a grace period after a pull request closed unmerged", () => {
    const recent = [{ number: 7, state: "closed", mergedAt: null, closedAt: daysAgo(2) }];
    expect(decide({ ...base, prs: recent })).toEqual({
      action: "keep",
      reason: "pull request #7 closed 2 day(s) ago"
    });
    const old = [
      { number: 7, state: "closed", mergedAt: null, closedAt: daysAgo(CLOSED_GRACE_DAYS + 3) },
      { number: 9, state: "closed", mergedAt: null, closedAt: daysAgo(CLOSED_GRACE_DAYS) }
    ];
    expect(decide({ ...base, prs: old })).toEqual({
      action: "delete",
      reason: "pull request #7, #9 closed unmerged"
    });
  });

  it("leaves a branch that never had a pull request for a person", () => {
    expect(decide(base)).toEqual({ action: "report", reason: "no pull request and not merged" });
  });
});

describe("needsCompare", () => {
  it("asks the compare API only when no pull request settles it", () => {
    expect(needsCompare([])).toBe(true);
    expect(
      needsCompare([{ number: 1, state: "closed", mergedAt: null, closedAt: daysAgo(1) }])
    ).toBe(true);
    expect(needsCompare([{ number: 1, state: "open", mergedAt: null, closedAt: null }])).toBe(
      false
    );
    expect(
      needsCompare([{ number: 1, state: "closed", mergedAt: daysAgo(1), closedAt: daysAgo(1) }])
    ).toBe(false);
  });
});

describe("summarize", () => {
  const results = [
    { branch: "a", action: "delete", reason: "pull request #1 merged" },
    { branch: "b", action: "keep", reason: "open pull request" },
    { branch: "c", action: "report", reason: "no pull request and not merged" }
  ];

  it("counts, lists what is left for a person, and folds away what went", () => {
    const text = summarize(results, false);
    expect(text).toContain("1 deleted, 1 kept, 1 left for a person.");
    expect(text).toContain("- `c`");
    expect(text).toContain("- `a`: pull request #1 merged");
  });

  it("says when a run deleted nothing on purpose", () => {
    expect(summarize(results, true)).toContain("(dry run: nothing deleted)");
  });
});
