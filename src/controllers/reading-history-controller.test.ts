import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { fakeVault } from "../testing/fake-app";
import { createLogger } from "../services/logger";
import { normalizeSettings } from "../services/plugin-settings";
import { t } from "../i18n";
import type { Bookmark, Highlight, ListRequestInput } from "../services/instapaper-request";
import { ReadingHistoryController, type ReadingDeps } from "./reading-history-controller";

const NOW = new Date(2026, 9, 21, 12, 0);
const NOW_S = Math.floor(NOW.getTime() / 1000);

const bookmark = (id: number, overrides: Partial<Bookmark> = {}): Bookmark => ({
  id,
  url: `https://example.com/${id}`,
  title: `Article ${id}`,
  archived: true,
  liked: false,
  ...overrides
});

const READING_NOTE = "---\nschreibstubeReadingFrom: instapaper:archive\n---\n# Gelesen\n";

function setup({
  content = READING_NOTE,
  pages = [[bookmark(2), bookmark(1)]],
  highlights = {},
  settings = {},
  summarize = async () => "A gist."
}: {
  content?: string;
  pages?: Bookmark[][];
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
      const page = pages[input.offset / 500] ?? [];
      return { ok: true as const, bookmarks: page, total: pages.flat().length };
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
  return { vault, controller, deps, requests };
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

  it("writes the first check's entries newest first, with their counts", async () => {
    const { controller, vault, requests } = setup({
      highlights: { 2: [{ text: "Marked.", note: "" }] }
    });

    expect(await controller.checkAll(false)).toEqual({ checked: 1, added: 2, failed: 0 });
    expect(requests).toEqual([{ section: "archive", since: null, offset: 0, token: "token" }]);
    expect(vault.contentOf("Gelesen.md")).toBe(
      `${READING_NOTE}\n` +
        `%% schreibstube-reading checked=${NOW_S} %%\n` +
        `- [Article 2](https://example.com/2) · 2026-10-21 · ${t().reading.highlights(1)} %%instapaper:2%%\n` +
        "- [Article 1](https://example.com/1) · 2026-10-21 %%instapaper:1%%\n" +
        "%% /schreibstube-reading %%\n"
    );
  });

  it("asks what changed since the last check, and adds only what is new and archived", async () => {
    const block =
      "%% schreibstube-reading checked=1760000000 %%\n" +
      "- [Article 1](https://example.com/1) · 2026-10-20 %%instapaper:1%%\n" +
      "%% /schreibstube-reading %%\n";
    const { controller, vault, requests } = setup({
      content: `${READING_NOTE}\n${block}`,
      pages: [[bookmark(3), bookmark(4, { archived: false }), bookmark(1)]],
      highlights: { 1: [{ text: "Later mark.", note: "" }] }
    });

    expect(await controller.checkAll(true)).toEqual({ checked: 1, added: 1, failed: 0 });
    expect(requests[0]?.since).toBe(1760000000 - 300);
    const text = vault.contentOf("Gelesen.md");
    expect(text).toContain(`%% schreibstube-reading checked=${NOW_S} %%\n- [Article 3]`);
    expect(text).not.toContain("Article 4");
    expect(text).toContain(`· 2026-10-20 · ${t().reading.highlights(1)} %%instapaper:1%%`);
  });

  it("waits until a note is due, unless asked", async () => {
    const recent = `${READING_NOTE}\n%% schreibstube-reading checked=${NOW_S - 60} %%\n%% /schreibstube-reading %%\n`;
    const { controller, deps } = setup({ content: recent });
    expect(await controller.checkAll(false)).toEqual({ checked: 0, added: 0, failed: 0 });
    expect(deps.fetchBookmarks).not.toHaveBeenCalled();
    expect((await controller.checkAll(true)).checked).toBe(1);
  });

  it("reads further pages, and keeps the old check time when they did not all fit", async () => {
    const old = `${READING_NOTE}\n%% schreibstube-reading checked=1760000000 %%\n%% /schreibstube-reading %%\n`;
    const pages = Array.from({ length: 5 }, (_, page) =>
      Array.from({ length: 500 }, (_, index) => bookmark(page * 500 + index + 1))
    );
    const { controller, vault, requests } = setup({ content: old, pages });

    const summary = await controller.checkAll(true);
    expect(requests.map((request) => request.offset)).toEqual([0, 500, 1000, 1500]);
    expect(summary.added).toBe(2000);
    expect(vault.contentOf("Gelesen.md")).toContain("checked=1760000000 %%");
  });

  it("writes nothing when Instapaper refuses, and names why", async () => {
    const { controller, vault, deps } = setup();
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
    expect(vault.contentOf("Gelesen.md")).toBe(READING_NOTE);
  });

  it("writes nothing when a highlight request fails", async () => {
    const { controller, vault, deps } = setup();
    vi.mocked(deps.fetchHighlights).mockResolvedValue({ ok: false, message: "Nope." });
    expect((await controller.checkAll(true)).reason).toBe("Nope.");
    expect(vault.contentOf("Gelesen.md")).toBe(READING_NOTE);
  });

  it("refuses a reading list it cannot read", async () => {
    const { controller, vault } = setup();
    vault.frontmatterOf("Gelesen.md").schreibstubeReadingFrom = "pocket:archive";
    expect((await controller.checkAll(true)).reason).toBe(t().reading.sourceUnknown);
  });

  describe("with summaries on", () => {
    it("summarizes articles with highlights, and only those", async () => {
      const { controller, vault, deps } = setup({
        settings: { readingSummaries: true },
        highlights: { 2: [{ text: "Marked.", note: "Mine." }] },
        summarize: async () => '"Writing beats talking."'
      });
      await controller.checkAll(true);
      expect(deps.summarize).toHaveBeenCalledTimes(1);
      expect(vi.mocked(deps.summarize).mock.calls[0]?.[1]).toContain("- Marked.\n  (note: Mine.)");
      expect(vault.contentOf("Gelesen.md")).toContain(
        "%%instapaper:2%%\n  > Writing beats talking.\n"
      );
    });

    it("writes no summaries, and asks for none, without an AI key", async () => {
      const { controller, vault, deps } = setup({
        settings: { readingSummaries: true, llmSecretName: "" },
        highlights: { 2: [{ text: "Marked.", note: "" }] }
      });
      await controller.checkAll(true);
      expect(deps.summarize).not.toHaveBeenCalled();
      expect(vault.contentOf("Gelesen.md")).toContain("%%instapaper:2%%\n- [Article 1]");
    });

    it("keeps the entry when the summary fails, and finishes it on a later check", async () => {
      const { controller, vault, deps } = setup({
        settings: { readingSummaries: true },
        pages: [[bookmark(2)]],
        highlights: { 2: [{ text: "Marked.", note: "" }] }
      });
      vi.mocked(deps.summarize).mockRejectedValueOnce(new Error("provider down"));

      expect((await controller.checkAll(true)).failed).toBe(0);
      expect(vault.contentOf("Gelesen.md")).not.toContain("  > ");

      vi.mocked(deps.fetchBookmarks).mockResolvedValueOnce({ ok: true, bookmarks: [], total: 0 });
      await controller.checkAll(true);
      expect(vault.contentOf("Gelesen.md")).toContain("%%instapaper:2%%\n  > A gist.\n");
    });
  });
});
