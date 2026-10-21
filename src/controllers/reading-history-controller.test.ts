import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { fakeVault } from "../testing/fake-app";
import { createLogger } from "../services/logger";
import { normalizeSettings } from "../services/plugin-settings";
import { t } from "../i18n";
import type { Bookmark, Highlight, ListRequestInput } from "../services/instapaper-request";
import { formatCheckedAt, READING_CHECKED_KEY } from "../services/reading-history";
import { ReadingHistoryController, type ReadingDeps } from "./reading-history-controller";

const NOW = new Date(2026, 9, 21, 12, 0);
const NOW_S = Math.floor(NOW.getTime() / 1000);
const DAY = 24 * 60 * 60;

const bookmark = (id: number, overrides: Partial<Bookmark> = {}): Bookmark => ({
  id,
  url: `https://example.com/${id}`,
  title: `Article ${id}`,
  archived: true,
  liked: false,
  time: null,
  ...overrides
});

const line = (id: number, date = "2026-10-21", highlights = 0): string =>
  `- [Article ${id}](https://example.com/${id}) · ${date}` +
  (highlights > 0 ? ` · ${t().reading.highlights(highlights)}` : "");

const frontmatter = (checkedAt?: string): string =>
  "---\nschreibstubeReadingFrom: instapaper:archive\n" +
  (checkedAt === undefined ? "" : `${READING_CHECKED_KEY}: ${checkedAt}\n`) +
  "---\n# Gelesen\n";

const listBlock = (...lines: string[]): string =>
  ["%% schreibstube-reading %%", ...lines, "%% /schreibstube-reading %%", ""].join("\n");

function setup({
  content = frontmatter(),
  archive = [bookmark(2), bookmark(1)],
  changed = [],
  serverTime = null,
  highlights = {},
  settings = {},
  summarize = async () => "A gist."
}: {
  content?: string;
  /** The section as Instapaper lists it. */
  archive?: Bookmark[];
  /** What a since-check answers. */
  changed?: Bookmark[];
  serverTime?: number | null;
  highlights?: Record<number, Highlight[]>;
  settings?: Partial<ReturnType<typeof normalizeSettings>>;
  summarize?: ReadingDeps["summarize"];
} = {}) {
  const vault = fakeVault({
    notes: [
      {
        path: "Gelesen.md",
        content,
        frontmatter: { schreibstubeReadingFrom: "instapaper:archive" }
      },
      { path: "Other.md", content: "Nothing to see." }
    ],
    secrets: { instapaper: "token", ai: "key" }
  });
  const current = normalizeSettings({
    readingEnabled: true,
    instapaperSecretName: "instapaper",
    llmSecretName: "ai",
    ...settings
  });
  const requests: ListRequestInput[] = [];
  const deps: ReadingDeps = {
    fetchBookmarks: vi.fn(async (input: ListRequestInput) => {
      requests.push(input);
      const list = input.since === null ? archive : changed;
      const size = input.since === null ? (input.limit ?? 100) : 500;
      return {
        ok: true as const,
        bookmarks: list.slice(input.offset, input.offset + size),
        total: list.length,
        serverTime
      };
    }),
    fetchHighlights: vi.fn(async (id: number) => ({
      ok: true as const,
      highlights: highlights[id] ?? []
    })),
    summarize: vi.fn(summarize),
    now: () => NOW
  };
  const controller = new ReadingHistoryController(
    vault.app as unknown as App,
    () => current,
    createLogger(() => false),
    deps
  );
  return { vault, controller, deps, requests, text: () => vault.contentOf("Gelesen.md") };
}

describe("ReadingHistoryController", () => {
  it("lists only the notes that name a reading list", () => {
    const { controller } = setup();
    expect(controller.readingNotes().map((file) => file.path)).toEqual(["Gelesen.md"]);
  });

  it("does nothing while switched off, and says so", async () => {
    const { controller, deps } = setup({ settings: { readingEnabled: false } });
    expect(await controller.checkAll(true)).toEqual({
      checked: 0,
      added: 0,
      failed: 0,
      skipped: "disabled"
    });
    expect(deps.fetchBookmarks).not.toHaveBeenCalled();
  });

  it("asks for a token before asking Instapaper", async () => {
    const { controller, deps } = setup({ settings: { instapaperSecretName: "" } });
    expect((await controller.checkAll(true)).skipped).toBe("noToken");
    expect(deps.fetchBookmarks).not.toHaveBeenCalled();
  });

  it("lists the newest hundred on the first check, and writes when it checked", async () => {
    const { controller, requests, text } = setup({
      highlights: { 2: [{ text: "Marked.", note: "" }] }
    });

    expect(await controller.checkAll(false)).toEqual({ checked: 1, added: 2, failed: 0 });
    expect(requests).toEqual([
      { section: "archive", since: null, offset: 0, limit: 100, token: "token" }
    ]);
    expect(text()).toBe(
      `${frontmatter(formatCheckedAt(NOW_S))}\n${listBlock(line(2, "2026-10-21", 1), line(1))}`
    );
  });

  it("takes the newest page, newest first, from a section sorted oldest first", async () => {
    const archive = Array.from({ length: 250 }, (_, index) =>
      bookmark(index + 1, { time: 1700000000 + index })
    );
    const { controller, requests, text } = setup({ archive });

    expect((await controller.checkAll(true)).added).toBe(100);
    expect(requests.map((request) => request.offset)).toEqual([0, 150]);
    const ids = [...text().matchAll(/example\.com\/(\d+)\)/g)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(250);
    expect(ids.at(-1)).toBe(151);
  });

  it("dates the check by Instapaper's clock, not the device's", async () => {
    const { controller, text } = setup({ serverTime: NOW_S - 3600 });
    await controller.checkAll(true);
    expect(text()).toContain(`${READING_CHECKED_KEY}: ${formatCheckedAt(NOW_S - 3600)}\n`);
  });

  it("asks what changed since the last check, and the newest few, adding only what is new", async () => {
    const last = NOW_S - 7 * 3600;
    const { controller, requests, text } = setup({
      content: `${frontmatter(formatCheckedAt(last))}\n${listBlock(line(1, "2026-10-20"))}`,
      changed: [bookmark(3), bookmark(4, { archived: false }), bookmark(1)],
      archive: [bookmark(1)],
      highlights: { 1: [{ text: "Later mark.", note: "" }] }
    });

    expect(await controller.checkAll(true)).toEqual({ checked: 1, added: 1, failed: 0 });
    expect(requests).toEqual([
      { section: "archive", since: last - DAY, offset: 0, token: "token" },
      { section: "archive", since: null, offset: 0, limit: 10, token: "token" }
    ]);
    expect(text()).toBe(
      `${frontmatter(formatCheckedAt(NOW_S))}\n` + listBlock(line(3), line(1, "2026-10-20", 1))
    );
  });

  it("counts highlights added to a recent entry that Instapaper did not mark as changed", async () => {
    const last = NOW_S - 7 * 3600;
    const { controller, text } = setup({
      content: `${frontmatter(formatCheckedAt(last))}\n${listBlock(line(1, "2026-10-20"))}`,
      changed: [],
      archive: [bookmark(1)],
      highlights: { 1: [{ text: "Marked on the train.", note: "" }] }
    });

    await controller.checkAll(true);
    expect(text()).toContain(line(1, "2026-10-20", 1));
  });

  it("waits until a note is due, unless asked", async () => {
    const { controller, deps } = setup({
      content: `${frontmatter(formatCheckedAt(NOW_S - 60))}\n${listBlock()}`
    });
    expect(await controller.checkAll(false)).toEqual({ checked: 0, added: 0, failed: 0 });
    expect(deps.fetchBookmarks).not.toHaveBeenCalled();
    expect((await controller.checkAll(true)).checked).toBe(1);
  });

  it("reads further pages, and keeps the old check time when they did not all fit", async () => {
    const last = NOW_S - 7 * 3600;
    const changed = Array.from({ length: 2500 }, (_, index) => bookmark(index + 1));
    const { controller, requests, text } = setup({
      content: `${frontmatter(formatCheckedAt(last))}\n${listBlock()}`,
      changed,
      archive: []
    });

    const summary = await controller.checkAll(true);
    expect(requests.filter((r) => r.since !== null).map((r) => r.offset)).toEqual([
      0, 500, 1000, 1500
    ]);
    expect(summary.added).toBe(2000);
    expect(text()).toContain(`${READING_CHECKED_KEY}: ${formatCheckedAt(last)}\n`);
  });

  it("moves a 1.88.0 note over: its marker's time is asked from, then kept in the frontmatter", async () => {
    const legacy =
      "%% schreibstube-reading checked=1760000000 %%\n" +
      "- [Article 1](https://example.com/1) · 2026-10-20 %%instapaper:1%%\n" +
      "%% /schreibstube-reading %%\n";
    const { controller, requests, text } = setup({
      content: `${frontmatter()}\n${legacy}`,
      changed: [bookmark(5)],
      archive: []
    });

    await controller.checkAll(true);
    expect(requests[0]?.since).toBe(1760000000 - DAY);
    expect(text()).toContain(`${READING_CHECKED_KEY}: ${formatCheckedAt(NOW_S)}\n`);
    expect(text()).toContain(`%% schreibstube-reading %%\n${line(5)}\n`);
  });

  it("writes nothing when Instapaper refuses, and names why", async () => {
    const { controller, deps, text } = setup();
    vi.mocked(deps.fetchBookmarks).mockResolvedValueOnce({
      ok: false,
      message: t().reading.rateLimited
    });

    expect(await controller.checkAll(true)).toEqual({
      checked: 0,
      added: 0,
      failed: 1,
      reason: t().reading.rateLimited
    });
    expect(text()).toBe(frontmatter());
  });

  it("writes nothing when a highlight request fails", async () => {
    const { controller, deps, text } = setup();
    vi.mocked(deps.fetchHighlights).mockResolvedValue({ ok: false, message: "Nope." });
    expect((await controller.checkAll(true)).reason).toBe("Nope.");
    expect(text()).toBe(frontmatter());
  });

  it("refuses a reading list it cannot read", async () => {
    const { controller, vault } = setup();
    vault.frontmatterOf("Gelesen.md").schreibstubeReadingFrom = "pocket:archive";
    expect((await controller.checkAll(true)).reason).toBe(t().reading.sourceUnknown);
  });

  describe("with summaries on", () => {
    it("summarizes articles with highlights, and only those", async () => {
      const { controller, deps, text } = setup({
        settings: { readingSummaries: true },
        highlights: { 2: [{ text: "Marked.", note: "Mine." }] },
        summarize: async () => '"Writing beats talking."'
      });
      await controller.checkAll(true);
      expect(deps.summarize).toHaveBeenCalledTimes(1);
      expect(vi.mocked(deps.summarize).mock.calls[0]?.[1]).toContain("- Marked.\n  (note: Mine.)");
      expect(text()).toContain(`${line(2, "2026-10-21", 1)}\n  > Writing beats talking.\n`);
    });

    it("writes no summaries, and asks for none, without an AI key", async () => {
      const { controller, deps, text } = setup({
        settings: { readingSummaries: true, llmSecretName: "" },
        highlights: { 2: [{ text: "Marked.", note: "" }] }
      });
      await controller.checkAll(true);
      expect(deps.summarize).not.toHaveBeenCalled();
      expect(text()).toContain(`${line(2, "2026-10-21", 1)}\n${line(1)}`);
    });

    it("keeps the entry when the summary fails, and finishes it on a later check", async () => {
      const { controller, deps, text } = setup({
        settings: { readingSummaries: true },
        archive: [bookmark(2)],
        highlights: { 2: [{ text: "Marked.", note: "" }] }
      });
      vi.mocked(deps.summarize).mockRejectedValueOnce(new Error("provider down"));

      expect((await controller.checkAll(true)).failed).toBe(0);
      expect(text()).not.toContain("  > ");

      await controller.checkAll(true);
      expect(text()).toContain(`${line(2, "2026-10-21", 1)}\n  > A gist.\n`);
    });
  });
});
