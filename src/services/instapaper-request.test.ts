import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import {
  FIRST_RUN_LIMIT,
  inSection,
  INSTAPAPER_API,
  interpretHighlightsResponse,
  interpretListResponse,
  MAX_LIST_BYTES,
  normalizeBookmark,
  parseReadingSource,
  planHighlightsRequest,
  planListRequest
} from "./instapaper-request";

const ok = (body: unknown) => ({ status: 200, headers: {}, text: JSON.stringify(body) });

describe("parseReadingSource", () => {
  it.each([
    "instapaper:archive",
    "Instapaper archive",
    "instapaper/ARCHIVE",
    " instapaper : archive "
  ])("reads %j as the archive", (raw) => {
    expect(parseReadingSource(raw)).toEqual({ ok: true, section: "archive" });
  });

  it("reads the liked list", () => {
    expect(parseReadingSource("instapaper:liked")).toEqual({ ok: true, section: "liked" });
  });

  it("refuses a missing value and says so", () => {
    expect(parseReadingSource(undefined)).toEqual({ ok: false, reason: t().reading.sourceMissing });
    expect(parseReadingSource("  ")).toEqual({ ok: false, reason: t().reading.sourceMissing });
  });

  it("refuses an address, a folder or another service with the spelling that works", () => {
    for (const raw of [
      "https://www.instapaper.com/rss/123/abc",
      "instapaper:folder/99",
      "pocket:archive",
      "instapaper:archive2"
    ]) {
      expect(parseReadingSource(raw)).toEqual({ ok: false, reason: t().reading.sourceUnknown });
    }
  });
});

describe("planListRequest", () => {
  it("reads the section itself on a first check", () => {
    const request = planListRequest({ section: "archive", since: null, offset: 0, token: "tok\n" });
    expect(request.url).toBe(`${INSTAPAPER_API}bookmarks?section=archive&limit=${FIRST_RUN_LIMIT}`);
    expect(request.headers.Authorization).toBe("Bearer tok");
  });

  it("asks what changed since the last check, a page at a time", () => {
    expect(
      planListRequest({ section: "archive", since: 1755000000.7, offset: 0, token: "t" }).url
    ).toBe(`${INSTAPAPER_API}bookmarks?since=1755000000&limit=500`);
    expect(
      planListRequest({ section: "liked", since: 1755000000, offset: 500, token: "t" }).url
    ).toBe(`${INSTAPAPER_API}bookmarks?since=1755000000&limit=500&offset=500`);
  });

  it("never sends a since below the API's floor", () => {
    expect(planListRequest({ section: "archive", since: 0, offset: 0, token: "t" }).url).toContain(
      "since=1&"
    );
  });

  it("sends the token to Instapaper's API and nowhere else", () => {
    expect(planHighlightsRequest(12345, "t").url).toBe(
      `${INSTAPAPER_API}bookmarks/12345/highlights`
    );
    expect(
      new URL(planListRequest({ section: "archive", since: null, offset: 0, token: "t" }).url).host
    ).toBe("www.instapaper.com");
  });
});

describe("interpretListResponse", () => {
  const bookmark = {
    id: 12345,
    url: "https://example.com/article",
    title: "An Article",
    progress: { percentage: 0, timestamp: 0 },
    liked: false,
    archived: true,
    time: 1755000000,
    tags: [],
    category: 0
  };

  it("reads the documented answer", () => {
    expect(interpretListResponse(ok({ bookmarks: [bookmark], total: 42 }))).toEqual({
      ok: true,
      bookmarks: [
        {
          id: 12345,
          url: "https://example.com/article",
          title: "An Article",
          archived: true,
          liked: false
        }
      ],
      total: 42
    });
  });

  it("drops what cannot become an entry and keeps the rest", () => {
    const outcome = interpretListResponse(
      ok({
        bookmarks: [
          bookmark,
          { ...bookmark, id: "7" },
          { ...bookmark, id: 0 },
          { ...bookmark, id: 8, url: "javascript:alert(1)" },
          { ...bookmark, id: 9, url: "obsidian://open?vault=x" },
          null
        ],
        total: 6
      })
    );
    expect(outcome.ok && outcome.bookmarks.map((b) => b.id)).toEqual([12345]);
  });

  it("counts the page when the total is missing", () => {
    const outcome = interpretListResponse(ok({ bookmarks: [bookmark] }));
    expect(outcome.ok && outcome.total).toBe(1);
  });

  it.each([
    [401, t().reading.denied(401)],
    [403, t().reading.denied(403)],
    [429, t().reading.rateLimited],
    [500, t().reading.httpStatus(500)]
  ])("says what HTTP %i means", (status, message) => {
    expect(interpretListResponse({ status, headers: {}, text: "{}" })).toEqual({
      ok: false,
      message
    });
  });

  it("refuses an answer that is not the documented shape", () => {
    for (const text of ["not json", "[]", '{"bookmarks": "nope"}', ""]) {
      expect(interpretListResponse({ status: 200, headers: {}, text })).toEqual({
        ok: false,
        message: t().reading.malformed
      });
    }
  });

  it("refuses an answer larger than its limit, by its word or its body", () => {
    expect(
      interpretListResponse({
        status: 200,
        headers: { "Content-Length": String(MAX_LIST_BYTES + 1) },
        text: "{}"
      })
    ).toEqual({ ok: false, message: t().reading.tooLarge });
    expect(
      interpretListResponse({ status: 200, headers: {}, text: "x".repeat(MAX_LIST_BYTES + 1) })
    ).toEqual({
      ok: false,
      message: t().reading.tooLarge
    });
  });
});

describe("interpretHighlightsResponse", () => {
  it("reads the passages and their notes", () => {
    expect(
      interpretHighlightsResponse(
        ok({
          highlights: [
            {
              id: 501,
              bookmark_id: 12345,
              text: "The passage.",
              note: "Worth it.",
              position: 0,
              time: 1
            },
            { id: 502, bookmark_id: 12345, text: "Another.", note: null, position: 1, time: 2 },
            { id: 503, bookmark_id: 12345, text: "   ", note: "", position: 2, time: 3 }
          ]
        })
      )
    ).toEqual({
      ok: true,
      highlights: [
        { text: "The passage.", note: "Worth it." },
        { text: "Another.", note: "" }
      ]
    });
  });

  it("refuses an answer without a highlights list", () => {
    expect(interpretHighlightsResponse(ok({}))).toEqual({
      ok: false,
      message: t().reading.malformed
    });
  });

  it("passes on a refusal", () => {
    expect(interpretHighlightsResponse({ status: 429, headers: {}, text: "" })).toEqual({
      ok: false,
      message: t().reading.rateLimited
    });
  });
});

describe("normalizeBookmark", () => {
  it("falls back to the link when the title is empty", () => {
    expect(normalizeBookmark({ id: 1, url: "http://example.com/a", title: "  " })?.title).toBe(
      "http://example.com/a"
    );
  });

  it("drops an unsafe or oversized id or link", () => {
    expect(normalizeBookmark({ id: 2 ** 60, url: "https://example.com" })).toBeNull();
    expect(normalizeBookmark({ id: 1, url: `https://example.com/${"a".repeat(2001)}` })).toBeNull();
    expect(normalizeBookmark({ id: 1, url: "not a url" })).toBeNull();
    expect(normalizeBookmark("nope")).toBeNull();
  });
});

describe("inSection", () => {
  it("reads the archive and liked flags", () => {
    const bookmark = { id: 1, url: "https://e.com", title: "t", archived: true, liked: false };
    expect(inSection(bookmark, "archive")).toBe(true);
    expect(inSection(bookmark, "liked")).toBe(false);
  });
});
