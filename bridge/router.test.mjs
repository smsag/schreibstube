import { describe, expect, it } from "vitest";
import { authenticate, resolve } from "./router.mjs";

const MAIL = "m".repeat(32);
const PUBLISH = "p".repeat(32);
const tokens = { mail: MAIL, publish: PUBLISH };

const routes = [
  { method: "GET", path: "/health", public: true },
  { method: "POST", path: "/send", capability: "mail" },
  { method: "POST", path: "/diagnostics", capability: "mail" },
  { method: "POST", path: "/publish/plan", capability: "publish" },
  { method: "PUT", path: "/publish/asset", capability: "publish" }
];

function outcome(method, pathname, capability = null) {
  return resolve(routes, { method, pathname, capability }).outcome;
}

describe("authenticate", () => {
  it("names the capability a token belongs to", () => {
    expect(authenticate(`Bearer ${MAIL}`, tokens)).toBe("mail");
    expect(authenticate(`Bearer ${PUBLISH}`, tokens)).toBe("publish");
  });

  it("rejects a missing header", () => {
    expect(authenticate(undefined, tokens)).toBeNull();
  });

  it("rejects a header without the Bearer prefix", () => {
    expect(authenticate(MAIL, tokens)).toBeNull();
  });

  it("rejects a token of the right length that is wrong", () => {
    expect(authenticate(`Bearer ${"m".repeat(31)}x`, tokens)).toBeNull();
  });

  it("rejects a token of a different length without throwing", () => {
    expect(authenticate("Bearer kurz", tokens)).toBeNull();
  });

  it("tolerates whitespace around the token", () => {
    expect(authenticate(`Bearer  ${MAIL}  `, tokens)).toBe("mail");
  });

  it("finds nothing when no capability is configured", () => {
    expect(authenticate(`Bearer ${MAIL}`, {})).toBeNull();
  });
});

describe("resolve", () => {
  it("serves a public route without a capability", () => {
    expect(outcome("GET", "/health")).toBe("match");
  });

  it("refuses another method on a public route", () => {
    expect(outcome("POST", "/health")).toBe("method-not-allowed");
  });

  it("serves a route to its own capability", () => {
    expect(outcome("POST", "/send", "mail")).toBe("match");
  });

  it("refuses an unauthenticated caller before acknowledging the path", () => {
    expect(outcome("POST", "/send")).toBe("unauthorized");
  });

  it("refuses an unauthenticated caller on an unknown path the same way", () => {
    expect(outcome("POST", "/gibtesnicht")).toBe("unauthorized");
  });

  it("refuses one capability's token on another capability's route", () => {
    expect(outcome("POST", "/publish/plan", "mail")).toBe("unauthorized");
    expect(outcome("POST", "/send", "publish")).toBe("unauthorized");
  });

  it("says as little for a foreign capability as for a wrong token", () => {
    expect(outcome("POST", "/publish/plan", "mail")).toBe(outcome("POST", "/publish/plan"));
  });

  it("reports an unknown path only to a caller that authenticated", () => {
    expect(outcome("POST", "/gibtesnicht", "mail")).toBe("not-found");
  });

  it("reports a wrong method on a route the caller may use", () => {
    expect(outcome("GET", "/send", "mail")).toBe("method-not-allowed");
  });

  it("distinguishes routes on the same path by method", () => {
    expect(outcome("PUT", "/publish/asset", "publish")).toBe("match");
    expect(outcome("POST", "/publish/asset", "publish")).toBe("method-not-allowed");
  });

  it("hands back the route it matched", () => {
    const match = resolve(routes, { method: "POST", pathname: "/send", capability: "mail" });
    expect(match.route.path).toBe("/send");
  });
});
