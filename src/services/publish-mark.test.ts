import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLISH_KEYS } from "./publish-index";
import { publishMarkFor, type PublishMarkInput } from "./publish-mark";

/**
 * The file pane's publication mark: shown for a note marked for publication in
 * an account's folder, and titled with whether the latest run carried it.
 */

const grembl = {
  id: "grembl",
  name: "Grembl",
  folder: "Writings/Grembl",
  target: "writings",
  writeBack: true
};

const run = "2026-09-24T08:22:10.000Z";
const afterRun = "2026-09-24T08:22:11.500Z";
const beforeRun = "2026-09-20T12:00:00.000Z";

function mark(overrides: Partial<PublishMarkInput> = {}) {
  return publishMarkFor({
    path: "Writings/Grembl/Test.md",
    frontmatter: { published: true },
    accounts: [grembl],
    keys: DEFAULT_PUBLISH_KEYS,
    lastRuns: {},
    ...overrides
  });
}

describe("publishMarkFor, which notes carry it", () => {
  it("marks a flagged note in an account's folder", () => {
    expect(mark().state).not.toBe("none");
  });

  it("leaves a note without the flag unmarked, since silence means no", () => {
    expect(mark({ frontmatter: {} }).state).toBe("none");
    expect(mark({ frontmatter: { published: false } }).state).toBe("none");
  });

  it("reads the flag the way publishing does, yes and ja included", () => {
    expect(mark({ frontmatter: { published: "ja" } }).state).not.toBe("none");
  });

  it("leaves a flagged note outside every account's folder unmarked", () => {
    expect(mark({ path: "Privates/Test.md" }).state).toBe("none");
  });

  it("does not take a sibling folder with a longer name for the account's", () => {
    expect(mark({ path: "Writings/Grembl_Archive/Test.md" }).state).toBe("none");
  });

  it("reads the key the settings name for the flag", () => {
    const keys = { ...DEFAULT_PUBLISH_KEYS, published: "online" };
    expect(mark({ keys, frontmatter: { online: true } }).state).not.toBe("none");
    expect(mark({ keys, frontmatter: { published: true } }).state).toBe("none");
  });

  it("names the deepest account when folders nest", () => {
    const writings = { ...grembl, id: "writings", name: "Writings", folder: "Writings" };
    expect(mark({ accounts: [writings, grembl] })).toMatchObject({ account: "Grembl" });
    expect(mark({ accounts: [grembl, writings] })).toMatchObject({ account: "Grembl" });
  });
});

describe("publishMarkFor, what its title says", () => {
  const recorded = {
    published: true,
    publishedAt: afterRun,
    publishedUrl: "https://writings.grembl.de/test/"
  };

  it("says published, where and when, when the latest run recorded the note", () => {
    expect(
      mark({ frontmatter: recorded, lastRuns: { grembl: { at: run, written: 3, deleted: 0 } } })
    ).toEqual({
      state: "published",
      account: "Grembl",
      url: "https://writings.grembl.de/test/",
      at: afterRun
    });
  });

  it("says not yet published when nothing was ever recorded in the note", () => {
    expect(mark()).toEqual({ state: "marked", account: "Grembl", recorded: true, lastRun: null });
  });

  it("does not claim a page a later run took down, from an older record", () => {
    // Unmarked, published without it, then marked again: the record is from
    // before the takedown, and the page is not online until the next run.
    const stale = { ...recorded, publishedAt: beforeRun };
    expect(
      mark({ frontmatter: stale, lastRuns: { grembl: { at: run, written: 0, deleted: 1 } } })
    ).toMatchObject({ state: "marked", recorded: true });
  });

  it("trusts a record when this vault knows of no run", () => {
    expect(mark({ frontmatter: recorded }).state).toBe("published");
  });

  it("says only what it knows when the account records nothing in notes", () => {
    const quiet = { ...grembl, writeBack: false };
    expect(
      mark({
        accounts: [quiet],
        frontmatter: recorded,
        lastRuns: { grembl: { at: run, written: 3, deleted: 0 } }
      })
    ).toEqual({ state: "marked", account: "Grembl", recorded: false, lastRun: run });
  });

  it("reads a time YAML handed over as a date", () => {
    const asDate = { ...recorded, publishedAt: new Date(afterRun) };
    expect(mark({ frontmatter: asDate }).state).toBe("published");
  });

  it("treats an unreadable time as no record", () => {
    expect(mark({ frontmatter: { ...recorded, publishedAt: "gestern" } }).state).toBe("marked");
  });

  it("keeps the mark without an address when the record has none", () => {
    const { publishedUrl: _unused, ...withoutUrl } = recorded;
    expect(mark({ frontmatter: withoutUrl })).toMatchObject({ state: "published", url: "" });
  });
});
