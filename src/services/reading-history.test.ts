import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import type { Bookmark } from "./instapaper-request";
import {
  applyEdit,
  buildReadingUpdate,
  DEFAULT_READING_EVERY_MINUTES,
  describeReadingCheck,
  entryDate,
  entryTitle,
  entryUrl,
  isReadingDue,
  MAX_REFRESH_PER_CHECK,
  planHighlightWork,
  planReadingEdit,
  planSummaries,
  RECENT_REFRESH_COUNT,
  readReadingBlock,
  renderEntry,
  selectBookmarks,
  SINCE_OVERLAP_SECONDS,
  sinceFor,
  type ReadingEntry
} from "./reading-history";

const entry = (overrides: Partial<ReadingEntry> = {}): ReadingEntry => ({
  id: 12345,
  title: "An Article",
  url: "https://example.com/article",
  date: "2026-10-21",
  highlights: 0,
  summary: null,
  ...overrides
});

const bookmark = (id: number, overrides: Partial<Bookmark> = {}): Bookmark => ({
  id,
  url: `https://example.com/${id}`,
  title: `Article ${id}`,
  archived: true,
  liked: false,
  ...overrides
});

const note = (lines: string[]): string =>
  ["---", "schreibstubeReadingFrom: instapaper:archive", "---", "# Reading", "", ...lines, ""].join(
    "\n"
  );

describe("renderEntry", () => {
  it("writes title, link, date and a hidden id", () => {
    expect(renderEntry(entry())).toEqual([
      "- [An Article](https://example.com/article) · 2026-10-21 %%instapaper:12345%%"
    ]);
  });

  it("adds the count and the summary when there are any", () => {
    expect(renderEntry(entry({ highlights: 3, summary: "Short and sharp." }))).toEqual([
      `- [An Article](https://example.com/article) · 2026-10-21 · ${t().reading.highlights(3)} %%instapaper:12345%%`,
      "  > Short and sharp."
    ]);
  });
});

describe("entryTitle and entryUrl", () => {
  it("keeps a title on one line and inside its link", () => {
    expect(entryTitle("A [bracketed]\ntitle")).toBe("A \\[bracketed\\] title");
    expect(entryTitle("![[embed]] and %%")).toBe("!\\[\\[embed\\]\\] and %&#37;");
    expect([...entryTitle("x".repeat(400))].length).toBe(300);
  });

  it("keeps a link from ending early", () => {
    expect(entryUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_%28bar%29"
    );
    expect(entryUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
  });

  it("dates an entry the local day", () => {
    expect(entryDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("readReadingBlock", () => {
  it("finds no block in a note never checked", () => {
    expect(readReadingBlock(note(["Some text."]))).toBeNull();
  });

  it("finds no block without its end", () => {
    expect(readReadingBlock("%% schreibstube-reading checked=5 %%\n- x")).toBeNull();
  });

  it("reads when it was checked, which entries it lists and what they hold", () => {
    const text = note([
      "%% schreibstube-reading checked=1760000000 %%",
      ...renderEntry(entry({ id: 1, highlights: 2, summary: "Gist." })),
      ...renderEntry(entry({ id: 2 })),
      "A line a person wrote.",
      "%% /schreibstube-reading %%"
    ]);
    const block = readReadingBlock(text);
    expect(block?.checked).toBe(1760000000);
    expect([...(block?.entries ?? [])]).toEqual([
      [1, { highlights: 2, hasSummary: true }],
      [2, { highlights: 0, hasSummary: false }]
    ]);
    expect(text.slice(block?.from, block?.to).startsWith("%% schreibstube-reading")).toBe(true);
    expect(text.slice(block?.from, block?.to).endsWith("%% /schreibstube-reading %%")).toBe(true);
  });

  it("reads a note saved with Windows line endings", () => {
    const text =
      "%% schreibstube-reading checked=7 %%\r\n- [a](https://e.com) · 2026-10-21 %%instapaper:3%%\r\n%% /schreibstube-reading %%\r\n";
    expect([...(readReadingBlock(text)?.entries.keys() ?? [])]).toEqual([3]);
  });
});

describe("isReadingDue and sinceFor", () => {
  const block = readReadingBlock(
    "%% schreibstube-reading checked=1760000000 %%\n%% /schreibstube-reading %%"
  );

  it("is always due before the first check", () => {
    expect(isReadingDue(null, null, new Date(0))).toBe(true);
    expect(sinceFor(null)).toBeNull();
  });

  it("waits the default interval when the note names none", () => {
    const checked = 1760000000 * 1000;
    expect(
      isReadingDue(block, null, new Date(checked + (DEFAULT_READING_EVERY_MINUTES - 1) * 60_000))
    ).toBe(false);
    expect(
      isReadingDue(block, null, new Date(checked + DEFAULT_READING_EVERY_MINUTES * 60_000))
    ).toBe(true);
  });

  it("keeps to the note's own interval", () => {
    const hourly = { kind: "every" as const, minutes: 60, cron: null, text: "hourly" };
    expect(isReadingDue(block, hourly, new Date((1760000000 + 3600) * 1000))).toBe(true);
  });

  it("asks again with some overlap", () => {
    expect(sinceFor(block)).toBe(1760000000 - SINCE_OVERLAP_SECONDS);
  });
});

describe("selectBookmarks", () => {
  const listed = readReadingBlock(
    [
      "%% schreibstube-reading checked=1 %%",
      ...renderEntry(entry({ id: 1 })),
      "%% /schreibstube-reading %%"
    ].join("\n")
  );

  it("takes the whole first answer: it was the section itself", () => {
    const selection = selectBookmarks({
      bookmarks: [bookmark(3), bookmark(2, { archived: false })],
      section: "archive",
      block: null
    });
    expect(selection.added.map((b) => b.id)).toEqual([3, 2]);
  });

  it("keeps only what is in the section, once, and tells new from known", () => {
    const selection = selectBookmarks({
      bookmarks: [bookmark(4), bookmark(5, { archived: false }), bookmark(1), bookmark(4)],
      section: "archive",
      block: listed
    });
    expect(selection.added.map((b) => b.id)).toEqual([4]);
    expect(selection.refreshed.map((b) => b.id)).toEqual([1]);
  });

  it("follows the liked flag for the liked list", () => {
    const selection = selectBookmarks({
      bookmarks: [bookmark(6, { liked: true, archived: false }), bookmark(7)],
      section: "liked",
      block: listed
    });
    expect(selection.added.map((b) => b.id)).toEqual([6]);
  });

  it("bounds how many known entries are looked at again", () => {
    const many = Array.from({ length: MAX_REFRESH_PER_CHECK + 10 }, (_, index) => index + 100);
    const block = readReadingBlock(
      [
        "%% schreibstube-reading checked=1 %%",
        ...many.flatMap((id) => renderEntry(entry({ id }))),
        "%% /schreibstube-reading %%"
      ].join("\n")
    );
    const selection = selectBookmarks({
      bookmarks: many.map((id) => bookmark(id)),
      section: "archive",
      block
    });
    expect(selection.refreshed).toHaveLength(MAX_REFRESH_PER_CHECK);
  });
});

describe("planHighlightWork, planSummaries and buildReadingUpdate", () => {
  // Newest first, as the note lists them: the ten newest end with entry 5,
  // and the two older ones fall outside the recent refresh.
  const fillers = Array.from({ length: RECENT_REFRESH_COUNT - 3 }, (_, index) => index + 100);
  const block = readReadingBlock(
    [
      "%% schreibstube-reading checked=1 %%",
      ...renderEntry(entry({ id: 3, highlights: 4 })),
      ...renderEntry(entry({ id: 2, highlights: 1, summary: "Done." })),
      ...fillers.flatMap((id) => renderEntry(entry({ id }))),
      ...renderEntry(entry({ id: 5 })),
      ...renderEntry(entry({ id: 1, highlights: 2 })),
      ...renderEntry(entry({ id: 4 })),
      "%% /schreibstube-reading %%"
    ].join("\n")
  );
  const selection = { added: [bookmark(9)], refreshed: [bookmark(3)] };
  const recent = [2, ...fillers, 5];

  it("reads new, changed and the newest entries, and the summaries owed", () => {
    expect(planHighlightWork({ selection, block, summaries: true, maxSummaries: 25 })).toEqual({
      fetch: [9, 3, ...recent, 1],
      recent,
      backfill: [1]
    });
    expect(planHighlightWork({ selection, block, summaries: false, maxSummaries: 25 })).toEqual({
      fetch: [9, 3, ...recent],
      recent,
      backfill: []
    });
  });

  it("reads the newest entries again even when nothing changed", () => {
    const none = { added: [], refreshed: [] };
    const work = planHighlightWork({ selection: none, block, summaries: false, maxSummaries: 25 });
    expect(work.recent).toEqual([3, 2, ...fillers, 5]);
    expect(work.recent).toHaveLength(RECENT_REFRESH_COUNT);
  });

  it("summarizes new entries first, and only those with highlights and none yet", () => {
    const work = planHighlightWork({ selection, block, summaries: true, maxSummaries: 25 });
    const counts = new Map([
      [9, 0],
      [3, 4],
      [2, 3],
      [5, 1],
      [1, 2]
    ]);
    expect(planSummaries({ selection, work, block, highlightCounts: counts, max: 25 })).toEqual([
      3, 5, 1
    ]);
    expect(
      planSummaries({
        selection,
        work,
        block,
        highlightCounts: new Map([...counts, [9, 1]]),
        max: 2
      })
    ).toEqual([9, 3]);
  });

  it("builds the entries and the changes a check writes", () => {
    const work = { fetch: [9, 3, 5, 1], recent: [5], backfill: [1] };
    const update = buildReadingUpdate({
      checked: 100,
      now: new Date(2026, 9, 21),
      selection,
      work,
      highlightCounts: new Map([
        [9, 1],
        [3, 5],
        [5, 2],
        [1, 2]
      ]),
      summaries: new Map([
        [9, "New."],
        [1, "Owed."]
      ])
    });
    expect(update).toEqual({
      checked: 100,
      added: [
        {
          id: 9,
          title: "Article 9",
          url: "https://example.com/9",
          date: "2026-10-21",
          highlights: 1,
          summary: "New."
        }
      ],
      changed: [
        { id: 3, highlights: 5 },
        { id: 5, highlights: 2 },
        { id: 1, highlights: 2, summary: "Owed." }
      ]
    });
  });
});

describe("planReadingEdit", () => {
  it("appends a block to a note that has none", () => {
    const text = note(["Some text."]);
    const edit = planReadingEdit(text, { checked: 1760000000, added: [entry()], changed: [] });
    expect(applyEdit(text, edit)).toBe(
      `${text}\n%% schreibstube-reading checked=1760000000 %%\n${renderEntry(entry())[0]}\n%% /schreibstube-reading %%\n`
    );
  });

  it("separates the block from text that does not end in a newline", () => {
    expect(applyEdit("Text", planReadingEdit("Text", { checked: 1, added: [], changed: [] }))).toBe(
      "Text\n\n%% schreibstube-reading checked=1 %%\n%% /schreibstube-reading %%\n"
    );
    expect(applyEdit("", planReadingEdit("", { checked: 1, added: [], changed: [] }))).toBe(
      "%% schreibstube-reading checked=1 %%\n%% /schreibstube-reading %%\n"
    );
  });

  it("puts new entries on top, moves the check time and leaves the rest alone", () => {
    const text = note([
      "%% schreibstube-reading checked=1 %%",
      ...renderEntry(entry({ id: 1 })),
      "My own remark.",
      "%% /schreibstube-reading %%",
      "",
      "After the block."
    ]);
    const next = applyEdit(
      text,
      planReadingEdit(text, { checked: 2, added: [entry({ id: 2, title: "Newer" })], changed: [] })
    );
    expect(next).toBe(
      note([
        "%% schreibstube-reading checked=2 %%",
        ...renderEntry(entry({ id: 2, title: "Newer" })),
        ...renderEntry(entry({ id: 1 })),
        "My own remark.",
        "%% /schreibstube-reading %%",
        "",
        "After the block."
      ])
    );
  });

  it("updates a count in place, adds one, and removes one that went", () => {
    const text = [
      "%% schreibstube-reading checked=1 %%",
      ...renderEntry(entry({ id: 1, highlights: 2 })),
      ...renderEntry(entry({ id: 2 })),
      ...renderEntry(entry({ id: 3, highlights: 1 })),
      "%% /schreibstube-reading %%"
    ].join("\n");
    const next = applyEdit(
      text,
      planReadingEdit(text, {
        checked: 2,
        added: [],
        changed: [
          { id: 1, highlights: 5 },
          { id: 2, highlights: 1 },
          { id: 3, highlights: 0 }
        ]
      })
    );
    expect(next.split("\n").slice(1, -1)).toEqual([
      ...renderEntry(entry({ id: 1, highlights: 5 })),
      ...renderEntry(entry({ id: 2, highlights: 1 })),
      ...renderEntry(entry({ id: 3 }))
    ]);
  });

  it("adds a summary that is owed, and never replaces one that is there", () => {
    const text = [
      "%% schreibstube-reading checked=1 %%",
      ...renderEntry(entry({ id: 1, highlights: 2 })),
      ...renderEntry(entry({ id: 2, highlights: 1, summary: "Kept." })),
      "%% /schreibstube-reading %%"
    ].join("\n");
    const next = applyEdit(
      text,
      planReadingEdit(text, {
        checked: 2,
        added: [],
        changed: [
          { id: 1, highlights: 2, summary: "Added." },
          { id: 2, highlights: 1, summary: "Ignored." }
        ]
      })
    );
    expect(next).toContain("  > Added.");
    expect(next).toContain("  > Kept.");
    expect(next).not.toContain("Ignored.");
  });

  it("leaves a line a person rewrote exactly as it is", () => {
    const text = [
      "%% schreibstube-reading checked=1 %%",
      "- My own words about it, id gone",
      "%% /schreibstube-reading %%"
    ].join("\n");
    const next = applyEdit(
      text,
      planReadingEdit(text, { checked: 2, added: [], changed: [{ id: 1, highlights: 9 }] })
    );
    expect(next).toBe(text.replace("checked=1", "checked=2"));
  });
});

describe("describeReadingCheck", () => {
  it("says why nothing ran", () => {
    const none = { checked: 0, added: 0, failed: 0 };
    expect(describeReadingCheck({ ...none, skipped: "disabled" })).toBe(t().reading.disabled);
    expect(describeReadingCheck({ ...none, skipped: "busy" })).toBe(t().reading.busy);
    expect(describeReadingCheck({ ...none, skipped: "noToken" })).toBe(t().reading.noToken);
    expect(describeReadingCheck(none)).toBe(t().reading.noneChecked);
  });

  it("names the failure when nothing succeeded, and counts otherwise", () => {
    expect(describeReadingCheck({ checked: 0, added: 0, failed: 1, reason: "Nope." })).toBe(
      t().reading.failed("Nope.")
    );
    expect(describeReadingCheck({ checked: 2, added: 5, failed: 1 })).toBe(
      t().reading.checked(2, 5, 1)
    );
  });
});
