import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import type { Bookmark } from "./instapaper-request";
import {
  applyEdit,
  applyReadingCheck,
  buildReadingUpdate,
  DEFAULT_READING_EVERY_MINUTES,
  describeReadingCheck,
  diffEdit,
  entryDate,
  entryTitle,
  entryUrl,
  formatCheckedAt,
  highlightsToFetch,
  isReadingDue,
  MAX_REFRESH_PER_CHECK,
  planReadingEdit,
  planSummaries,
  READING_CHECKED_KEY,
  readCheckedAt,
  readReadingBlock,
  renderEntry,
  selectBookmarks,
  setFrontmatterValue,
  SINCE_OVERLAP_SECONDS,
  sinceFor,
  type ReadingEntry
} from "./reading-history";

const entry = (overrides: Partial<ReadingEntry> = {}): ReadingEntry => ({
  title: "An Article",
  url: "https://example.com/article",
  date: "2026-10-21",
  highlights: 0,
  summary: null,
  ...overrides
});

const at = (n: number): Partial<ReadingEntry> => ({ url: `https://example.com/${n}` });

const bookmark = (id: number, overrides: Partial<Bookmark> = {}): Bookmark => ({
  id,
  url: `https://example.com/${id}`,
  title: `Article ${id}`,
  archived: true,
  liked: false,
  time: null,
  ...overrides
});

const block = (...lines: string[]): string =>
  ["%% schreibstube-reading %%", ...lines, "%% /schreibstube-reading %%"].join("\n");

const note = (lines: string[]): string =>
  ["---", "schreibstubeReadingFrom: instapaper:archive", "---", "# Reading", "", ...lines, ""].join(
    "\n"
  );

describe("renderEntry", () => {
  it("writes title, link and date, and nothing hidden", () => {
    expect(renderEntry(entry())).toEqual([
      "- [An Article](https://example.com/article) · 2026-10-21"
    ]);
  });

  it("adds the count and the summary when there are any", () => {
    expect(renderEntry(entry({ highlights: 3, summary: "Short and sharp." }))).toEqual([
      `- [An Article](https://example.com/article) · 2026-10-21 · ${t().reading.highlights(3)}`,
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

  it("keeps a link from ending early, and spells each address one way", () => {
    expect(entryUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_%28bar%29"
    );
    expect(entryUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(entryUrl("HTTPS://Example.com")).toBe("https://example.com/");
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
    expect(readReadingBlock("%% schreibstube-reading %%\n- x")).toBeNull();
  });

  it("knows its entries by their links, with what they hold", () => {
    const text = note([
      block(
        ...renderEntry(entry({ ...at(1), highlights: 2, summary: "Gist." })),
        ...renderEntry(entry({ ...at(2), title: "A [tricky] (title)" })),
        "A line a person wrote."
      )
    ]);
    const parsed = readReadingBlock(text);
    expect([...(parsed?.entries ?? [])]).toEqual([
      ["https://example.com/1", { highlights: 2, hasSummary: true }],
      ["https://example.com/2", { highlights: 0, hasSummary: false }]
    ]);
    expect(parsed?.legacyChecked).toBeNull();
    expect(text.slice(parsed?.from, parsed?.to)).toMatch(
      /^%% schreibstube-reading %%[\s\S]*%% \/schreibstube-reading %%$/
    );
  });

  it("reads a note saved with Windows line endings", () => {
    const text =
      "%% schreibstube-reading %%\r\n- [a](https://e.com/) · 2026-10-21\r\n%% /schreibstube-reading %%\r\n";
    expect([...(readReadingBlock(text)?.entries.keys() ?? [])]).toEqual(["https://e.com/"]);
  });

  it("still reads a block 1.88.0 wrote, ids and check time included", () => {
    const text = [
      "%% schreibstube-reading checked=1760000000 %%",
      `- [a](https://e.com/) · 2026-10-21 · ${t().reading.highlights(2)} %%instapaper:7%%`,
      "%% /schreibstube-reading %%"
    ].join("\n");
    const parsed = readReadingBlock(text);
    expect(parsed?.legacyChecked).toBe(1760000000);
    expect([...(parsed?.entries ?? [])]).toEqual([
      ["https://e.com/", { highlights: 2, hasSummary: false }]
    ]);
  });
});

describe("the check time", () => {
  it("is written and read back as a local date-time property", () => {
    const seconds = new Date(2026, 9, 21, 12, 55, 7).getTime() / 1000;
    expect(formatCheckedAt(seconds)).toBe("2026-10-21T12:55:07");
    expect(readCheckedAt("2026-10-21T12:55:07", null)).toBe(seconds);
    expect(readCheckedAt("2026-10-21T12:55", null)).toBe(seconds - 7);
  });

  it("falls back to a 1.88.0 block's marker, and otherwise counts as never", () => {
    const legacy = readReadingBlock(
      "%% schreibstube-reading checked=5 %%\n%% /schreibstube-reading %%"
    );
    expect(readCheckedAt(undefined, legacy)).toBe(5);
    expect(readCheckedAt("yesterday", null)).toBeNull();
    expect(readCheckedAt(42, null)).toBeNull();
  });

  it("is always due before the first check", () => {
    expect(isReadingDue(null, null, new Date(0))).toBe(true);
    expect(sinceFor(null)).toBeNull();
  });

  it("waits the default interval when the note names none", () => {
    const checked = 1760000000;
    const after = (minutes: number) => new Date((checked + minutes * 60) * 1000);
    expect(isReadingDue(checked, null, after(DEFAULT_READING_EVERY_MINUTES - 1))).toBe(false);
    expect(isReadingDue(checked, null, after(DEFAULT_READING_EVERY_MINUTES))).toBe(true);
  });

  it("keeps to the note's own interval", () => {
    const hourly = { kind: "every" as const, minutes: 60, cron: null, text: "hourly" };
    expect(isReadingDue(1760000000, hourly, new Date((1760000000 + 3600) * 1000))).toBe(true);
  });

  it("asks again with a day's overlap, for devices in other time zones", () => {
    expect(sinceFor(1760000000)).toBe(1760000000 - SINCE_OVERLAP_SECONDS);
    expect(SINCE_OVERLAP_SECONDS).toBeGreaterThanOrEqual(14 * 3600);
  });
});

describe("selectBookmarks", () => {
  const listed = readReadingBlock(block(...renderEntry(entry(at(1)))));

  it("takes the whole first answer: it was the section itself", () => {
    const selection = selectBookmarks({
      bookmarks: [bookmark(3), bookmark(2, { archived: false })],
      section: "archive",
      block: null,
      firstRun: true
    });
    expect(selection.added.map((b) => b.id)).toEqual([3, 2]);
  });

  it("keeps only what is in the section, once per link, and tells new from known", () => {
    const selection = selectBookmarks({
      bookmarks: [
        bookmark(4),
        bookmark(5, { archived: false }),
        bookmark(1),
        bookmark(6, { url: "https://example.com/4" })
      ],
      section: "archive",
      block: listed,
      firstRun: false
    });
    expect(selection.added.map((b) => b.id)).toEqual([4]);
    expect(selection.refreshed.map((b) => b.id)).toEqual([1]);
  });

  it("knows a listed article by its link, whatever its id now", () => {
    const selection = selectBookmarks({
      bookmarks: [bookmark(99, { url: "https://example.com/1" })],
      section: "archive",
      block: listed,
      firstRun: false
    });
    expect(selection.added).toEqual([]);
    expect(selection.refreshed.map((b) => b.id)).toEqual([99]);
  });

  it("follows the liked flag for the liked list", () => {
    const selection = selectBookmarks({
      bookmarks: [bookmark(6, { liked: true, archived: false }), bookmark(7)],
      section: "liked",
      block: listed,
      firstRun: false
    });
    expect(selection.added.map((b) => b.id)).toEqual([6]);
  });

  it("bounds how many known entries are looked at again", () => {
    const many = Array.from({ length: MAX_REFRESH_PER_CHECK + 10 }, (_, index) => index + 100);
    const parsed = readReadingBlock(block(...many.flatMap((n) => renderEntry(entry(at(n))))));
    const selection = selectBookmarks({
      bookmarks: many.map((id) => bookmark(id)),
      section: "archive",
      block: parsed,
      firstRun: false
    });
    expect(selection.refreshed).toHaveLength(MAX_REFRESH_PER_CHECK);
  });
});

describe("highlightsToFetch, planSummaries and buildReadingUpdate", () => {
  const parsed = readReadingBlock(
    block(
      ...renderEntry(entry({ ...at(3), highlights: 4 })),
      ...renderEntry(entry({ ...at(2), highlights: 1, summary: "Done." }))
    )
  );
  const selection = { added: [bookmark(9)], refreshed: [bookmark(3), bookmark(2)] };

  it("reads highlights for every new and every known bookmark", () => {
    expect(highlightsToFetch(selection)).toEqual([9, 3, 2]);
  });

  it("summarizes new entries first, then listed ones without one, with highlights", () => {
    const counts = new Map([
      [9, 0],
      [3, 4],
      [2, 3]
    ]);
    expect(planSummaries({ selection, block: parsed, highlightCounts: counts, max: 25 })).toEqual([
      3
    ]);
    expect(
      planSummaries({
        selection,
        block: parsed,
        highlightCounts: new Map([...counts, [9, 1]]),
        max: 1
      })
    ).toEqual([9]);
  });

  it("builds the entries and the changes a check writes", () => {
    const update = buildReadingUpdate({
      now: new Date(2026, 9, 21),
      selection,
      highlightCounts: new Map([
        [9, 1],
        [3, 5],
        [2, 1]
      ]),
      summaries: new Map([
        [9, "New."],
        [3, "Owed."]
      ])
    });
    expect(update).toEqual({
      added: [
        {
          title: "Article 9",
          url: "https://example.com/9",
          date: "2026-10-21",
          highlights: 1,
          summary: "New."
        }
      ],
      changed: [
        { url: "https://example.com/3", highlights: 5, summary: "Owed." },
        { url: "https://example.com/2", highlights: 1 }
      ]
    });
  });
});

describe("planReadingEdit", () => {
  it("appends a block to a note that has none", () => {
    const text = note(["Some text."]);
    const edit = planReadingEdit(text, { added: [entry()], changed: [] });
    expect(applyEdit(text, edit)).toBe(`${text}\n${block(renderEntry(entry())[0] ?? "")}\n`);
  });

  it("separates the block from text that does not end in a newline", () => {
    expect(applyEdit("Text", planReadingEdit("Text", { added: [], changed: [] }))).toBe(
      `Text\n\n${block()}\n`
    );
    expect(applyEdit("", planReadingEdit("", { added: [], changed: [] }))).toBe(`${block()}\n`);
  });

  it("puts new entries on top and leaves the rest alone", () => {
    const text = note([
      block(...renderEntry(entry(at(1))), "My own remark."),
      "",
      "After the block."
    ]);
    const next = applyEdit(
      text,
      planReadingEdit(text, { added: [entry({ ...at(2), title: "Newer" })], changed: [] })
    );
    expect(next).toBe(
      note([
        block(
          ...renderEntry(entry({ ...at(2), title: "Newer" })),
          ...renderEntry(entry(at(1))),
          "My own remark."
        ),
        "",
        "After the block."
      ])
    );
  });

  it("updates a count in place, adds one, and removes one that went", () => {
    const text = block(
      ...renderEntry(entry({ ...at(1), highlights: 2 })),
      ...renderEntry(entry(at(2))),
      ...renderEntry(entry({ ...at(3), highlights: 1 }))
    );
    const next = applyEdit(
      text,
      planReadingEdit(text, {
        added: [],
        changed: [
          { url: "https://example.com/1", highlights: 5 },
          { url: "https://example.com/2", highlights: 1 },
          { url: "https://example.com/3", highlights: 0 }
        ]
      })
    );
    expect(next).toBe(
      block(
        ...renderEntry(entry({ ...at(1), highlights: 5 })),
        ...renderEntry(entry({ ...at(2), highlights: 1 })),
        ...renderEntry(entry(at(3)))
      )
    );
  });

  it("drops a 1.88.0 id and marker when it rewrites them", () => {
    const text = [
      "%% schreibstube-reading checked=5 %%",
      "- [a](https://e.com/) · 2026-10-21 %%instapaper:7%%",
      "%% /schreibstube-reading %%"
    ].join("\n");
    const next = applyEdit(
      text,
      planReadingEdit(text, { added: [], changed: [{ url: "https://e.com/", highlights: 2 }] })
    );
    expect(next).toBe(block(`- [a](https://e.com/) · 2026-10-21 · ${t().reading.highlights(2)}`));
  });

  it("adds a summary that is owed, and never replaces one that is there", () => {
    const text = block(
      ...renderEntry(entry({ ...at(1), highlights: 2 })),
      ...renderEntry(entry({ ...at(2), highlights: 1, summary: "Kept." }))
    );
    const next = applyEdit(
      text,
      planReadingEdit(text, {
        added: [],
        changed: [
          { url: "https://example.com/1", highlights: 2, summary: "Added." },
          { url: "https://example.com/2", highlights: 1, summary: "Ignored." }
        ]
      })
    );
    expect(next).toContain("  > Added.");
    expect(next).toContain("  > Kept.");
    expect(next).not.toContain("Ignored.");
  });

  it("completes a link listed twice where it is first, and leaves a rewritten line alone", () => {
    const text = block(
      ...renderEntry(entry(at(1))),
      ...renderEntry(entry(at(1))),
      "- My own words about it, link gone"
    );
    const next = applyEdit(
      text,
      planReadingEdit(text, {
        added: [],
        changed: [{ url: "https://example.com/1", highlights: 3 }]
      })
    );
    expect(next.split("\n").slice(1, -1)).toEqual([
      ...renderEntry(entry({ ...at(1), highlights: 3 })),
      ...renderEntry(entry(at(1))),
      "- My own words about it, link gone"
    ]);
  });
});

describe("setFrontmatterValue", () => {
  it("sets a key that is there and adds one that is not", () => {
    expect(setFrontmatterValue("---\na: 1\nkey: old\n---\nBody", "key", "new")).toBe(
      "---\na: 1\nkey: new\n---\nBody"
    );
    expect(setFrontmatterValue("---\na: 1\n---\nBody", "key", "new")).toBe(
      "---\na: 1\nkey: new\n---\nBody"
    );
  });

  it("gives a note without frontmatter some", () => {
    expect(setFrontmatterValue("Body", "key", "v")).toBe("---\nkey: v\n---\nBody");
  });

  it("will not stand one line in for a list, or write into an unclosed block", () => {
    expect(setFrontmatterValue("---\nkey:\n  - a\n---\n", "key", "v")).toBeNull();
    expect(setFrontmatterValue("---\nkey: v\nBody", "key", "w")).toBeNull();
  });
});

describe("applyReadingCheck and diffEdit", () => {
  it("brings the list up to date and sets the check time", () => {
    const seconds = new Date(2026, 9, 21, 12, 0, 0).getTime() / 1000;
    const text = note(["Some text."]);
    const next = applyReadingCheck(text, { added: [entry()], changed: [] }, seconds);
    expect(next).toContain(`${READING_CHECKED_KEY}: 2026-10-21T12:00:00\n---`);
    expect(next).toContain(block(renderEntry(entry())[0] ?? ""));
  });

  it("finds the one change between two texts", () => {
    expect(diffEdit("abcXYZdef", "abcQdef")).toEqual({ from: 3, to: 6, text: "Q" });
    expect(diffEdit("same", "same")).toEqual({ from: 4, to: 4, text: "" });
    expect(applyEdit("aaa", diffEdit("aaa", "aaaa"))).toBe("aaaa");
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
