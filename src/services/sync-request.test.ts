import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import {
  interpretSourceResponse,
  MAX_SOURCE_BYTES,
  planSourceRequest,
  type FetchOptions,
  type SourceResponse
} from "./sync-request";
import { resolveSourceUrl } from "./sync-source";

setLanguage("en");

const PUBLIC = "https://raw.githubusercontent.com/org/repo/main/docs/a.md";
const MODERN_RAW = "https://raw.githubusercontent.com/org/repo/refs/heads/main/docs/a.md";
const ELSEWHERE = "https://example.com/docs/a.md";

function options(raw: string, extra: Partial<FetchOptions> = {}): FetchOptions {
  const resolved = resolveSourceUrl(raw);
  if (!resolved.ok) throw new Error(resolved.reason);
  return { url: resolved.url, target: resolved.target, ...extra };
}

function respond(
  status: number,
  text = "",
  headers: Record<string, string> | undefined = { "Content-Type": "text/plain; charset=utf-8" }
): SourceResponse {
  return { status, headers, text };
}

describe("planSourceRequest", () => {
  it("fetches a public GitHub source from the raw host without a token", () => {
    const request = planSourceRequest(options(PUBLIC));
    expect(request.url).toBe(PUBLIC);
    expect(request.authenticated).toBe(false);
    expect(request.headers.Authorization).toBeUndefined();
  });

  it("routes a GitHub source through the contents API when a token is set", () => {
    const request = planSourceRequest(options(PUBLIC, { token: "ghp_x" }));
    expect(request.url).toBe("https://api.github.com/repos/org/repo/contents/docs/a.md?ref=main");
    expect(request.authenticated).toBe(true);
    expect(request.headers.Authorization).toBe("Bearer ghp_x");
    expect(request.headers.accept).toBe("application/vnd.github.raw+json");
  });

  it("asks the API for the branch a modern raw link names, not for a file under refs/", () => {
    const request = planSourceRequest(options(MODERN_RAW, { token: "ghp_x" }));
    expect(request.url).toBe(
      "https://api.github.com/repos/org/repo/contents/docs/a.md?ref=refs%2Fheads%2Fmain"
    );
  });

  it("never sends the token to another host", () => {
    const request = planSourceRequest(options(ELSEWHERE, { token: "ghp_x" }));
    expect(request.url).toBe(ELSEWHERE);
    expect(request.authenticated).toBe(false);
    expect(request.headers.Authorization).toBeUndefined();
  });

  it("trims a token pasted with surrounding whitespace", () => {
    const request = planSourceRequest(options(PUBLIC, { token: " ghp_x\n" }));
    expect(request.headers.Authorization).toBe("Bearer ghp_x");
  });

  it("treats a blank token as none", () => {
    const request = planSourceRequest(options(PUBLIC, { token: "  " }));
    expect(request.url).toBe(PUBLIC);
    expect(request.authenticated).toBe(false);
  });

  it("carries the validator as a conditional request", () => {
    expect(planSourceRequest(options(PUBLIC, { etag: '"abc"' })).headers["If-None-Match"]).toBe(
      '"abc"'
    );
    expect(planSourceRequest(options(PUBLIC)).headers["If-None-Match"]).toBeUndefined();
  });
});

describe("interpretSourceResponse", () => {
  const plain = options(PUBLIC);
  const withToken = options(PUBLIC, { token: "ghp_x" });

  it("returns the body and validator of a fresh document", () => {
    const outcome = interpretSourceResponse(
      plain,
      planSourceRequest(plain),
      respond(200, "# Hi", { "content-type": "text/markdown", ETag: '"v2"' })
    );
    expect(outcome).toEqual({ status: "updated", body: "# Hi", etag: '"v2"' });
  });

  it("keeps the old validator on a 304", () => {
    const conditional = options(PUBLIC, { etag: '"v1"' });
    expect(
      interpretSourceResponse(conditional, planSourceRequest(conditional), respond(304))
    ).toEqual({ status: "unchanged", etag: '"v1"' });
  });

  it("says a private repository needs a token when a GitHub 404 came without one", () => {
    const outcome = interpretSourceResponse(plain, planSourceRequest(plain), respond(404));
    expect(outcome.status).toBe("missing");
    expect(outcome.status === "missing" && outcome.message).toContain("needs a GitHub token");
  });

  it("says the token may not see the repository when a GitHub 404 came with one", () => {
    const outcome = interpretSourceResponse(withToken, planSourceRequest(withToken), respond(404));
    expect(outcome.status).toBe("missing");
    expect(outcome.status === "missing" && outcome.message).toContain("repository access");
  });

  it("gives no GitHub hint for another host", () => {
    const other = options(ELSEWHERE);
    const outcome = interpretSourceResponse(other, planSourceRequest(other), respond(404));
    expect(outcome.status === "missing" && outcome.message).toBe("Source not found (HTTP 404).");
  });

  it("names the rate limit on a 403 with no quota left", () => {
    const outcome = interpretSourceResponse(
      plain,
      planSourceRequest(plain),
      respond(403, "", { "X-RateLimit-Remaining": "0" })
    );
    expect(outcome.status === "error" && outcome.message).toContain("rate limit");
  });

  it("blames the token on any other 401 or 403", () => {
    const outcome = interpretSourceResponse(withToken, planSourceRequest(withToken), respond(401));
    expect(outcome.status === "error" && outcome.message).toContain("Check the token");
  });

  it("reports any other status", () => {
    const outcome = interpretSourceResponse(plain, planSourceRequest(plain), respond(500));
    expect(outcome.status === "error" && outcome.message).toContain("HTTP 500");
  });

  it("refuses the API's JSON description in place of the file", () => {
    const outcome = interpretSourceResponse(
      withToken,
      planSourceRequest(withToken),
      respond(200, '{"content":"..."}', { "content-type": "application/json; charset=utf-8" })
    );
    expect(outcome.status === "error" && outcome.message).toContain("metadata");
  });

  it("accepts the raw media type the API echoes back", () => {
    const outcome = interpretSourceResponse(
      withToken,
      planSourceRequest(withToken),
      respond(200, "# Hi", { "content-type": "application/vnd.github.raw+json; charset=utf-8" })
    );
    expect(outcome.status).toBe("updated");
  });

  it("refuses a non-Markdown content type from a plain host", () => {
    const outcome = interpretSourceResponse(
      plain,
      planSourceRequest(plain),
      respond(200, "<html>", { "content-type": "text/html" })
    );
    expect(outcome.status === "error" && outcome.message).toContain("text/html");
  });

  it("accepts a body with no content type at all", () => {
    const outcome = interpretSourceResponse(plain, planSourceRequest(plain), respond(200, "x", {}));
    expect(outcome.status).toBe("updated");
  });

  it("refuses a document over the size limit", () => {
    const outcome = interpretSourceResponse(
      plain,
      planSourceRequest(plain),
      respond(200, "x".repeat(MAX_SOURCE_BYTES + 1))
    );
    expect(outcome.status === "error" && outcome.message).toContain("size limit");
  });
});
