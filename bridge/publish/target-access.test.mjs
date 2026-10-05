import { describe, expect, it } from "vitest";
import { opensTarget, presentedToken } from "./target-access.mjs";

const SHARED = "s".repeat(32);
const OWN = "o".repeat(32);
const publish = {
  token: SHARED,
  targets: {
    blog: { name: "blog" },
    eigen: { name: "eigen", token: OWN }
  }
};

describe("presentedToken", () => {
  it("reads a bearer token and nothing else", () => {
    expect(presentedToken(`Bearer ${OWN}`)).toBe(OWN);
    expect(presentedToken(`Bearer  ${OWN} `)).toBe(OWN);
    expect(presentedToken(OWN)).toBeNull();
    expect(presentedToken("Bearer ")).toBeNull();
    expect(presentedToken(undefined)).toBeNull();
    expect(presentedToken(["Bearer x"])).toBeNull();
  });
});

describe("opensTarget", () => {
  it("opens a target without a token of its own with the shared token", () => {
    expect(opensTarget(publish, publish.targets.blog, SHARED)).toBe(true);
    expect(opensTarget(publish, publish.targets.blog, OWN)).toBe(false);
  });

  it("opens a target with a token of its own with that token alone", () => {
    expect(opensTarget(publish, publish.targets.eigen, OWN)).toBe(true);
    expect(opensTarget(publish, publish.targets.eigen, SHARED)).toBe(false);
  });

  it("opens nothing without a token, or with one of another length", () => {
    expect(opensTarget(publish, publish.targets.blog, null)).toBe(false);
    expect(opensTarget(publish, publish.targets.blog, "kurz")).toBe(false);
  });
});
