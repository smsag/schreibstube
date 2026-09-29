import { describe, expect, it } from "vitest";
import {
  MAX_HITS,
  MAX_QUERY_CHARS,
  clampLimit,
  consentOf,
  itemKey,
  mergeHits,
  normalizeSourceConsent,
  publicItemId,
  readExclude,
  readLink,
  readNames,
  readPublicItemId,
  readQuery,
  readSource,
  readSourceId,
  relevance,
  splitItemKey,
  wants,
  type Hit
} from "./semantic-api";

const isIcon = (name: string) => name === "pythia" || name === "book";
const source = (extra: Record<string, unknown> = {}) => ({
  kind: "conversation",
  label: "Conversation in Pythia",
  plural: "Pythia conversations",
  list: () => [],
  onChanged: () => () => undefined,
  ...extra
});
const hit = (id: string, score: number, kind = "note"): Hit => ({
  kind,
  id,
  title: id,
  score,
  similarity: score
});

describe("the API's boundary", () => {
  it("bounds a limit", () => {
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10_000)).toBe(MAX_HITS);
    expect(clampLimit(2.7)).toBe(2);
    expect(clampLimit("20")).toBe(10);
    expect(clampLimit(Number.NaN)).toBe(10);
  });

  it("reads a query as text, trimmed and bounded", () => {
    expect(readQuery("  küche ")).toBe("küche");
    expect(readQuery("k".repeat(MAX_QUERY_CHARS + 5))).toHaveLength(MAX_QUERY_CHARS);
    expect(readQuery(42)).toBe("");
  });

  it("reads a list of names as strings, and nothing asked as everything", () => {
    expect([...(readNames(["note", 1, "note", "highlight"]) ?? [])]).toEqual(["note", "highlight"]);
    expect(readNames(undefined)).toBeNull();
    expect(wants(null, "anything")).toBe(true);
    expect(wants(new Set(["note"]), "image")).toBe(false);
    expect([...readExclude(["a", 1, null, "b"])]).toEqual(["a", "b"]);
  });
});

describe("a source registering", () => {
  it("takes the kind, labels and icon it declares", () => {
    const read = readSource(source({ icon: "pythia" }), isIcon);
    expect("descriptor" in read && read.descriptor).toEqual({
      kind: "conversation",
      label: "Conversation in Pythia",
      plural: "Pythia conversations",
      icon: "pythia"
    });
  });

  it("drops an icon the set does not have, rather than refusing the source", () => {
    const read = readSource(source({ icon: "unicorn" }), isIcon);
    expect("descriptor" in read && read.descriptor.icon).toBeUndefined();
  });

  it("refuses a kind that is the vault's, or not a word", () => {
    expect(readSource(source({ kind: "note" }), isIcon)).toHaveProperty("problem");
    expect(readSource(source({ kind: "Chats!" }), isIcon)).toHaveProperty("problem");
  });

  it("refuses a source without its functions or its labels", () => {
    expect(readSource(source({ list: [] }), isIcon)).toHaveProperty("problem");
    expect(readSource(source({ plural: "  " }), isIcon)).toHaveProperty("problem");
    expect(readSource(null, isIcon)).toHaveProperty("problem");
  });

  it("reads incremental listing only when both halves are there", () => {
    const both = readSource(source({ ids: () => [], changedSince: () => [] }), isIcon);
    const half = readSource(source({ ids: () => [] }), isIcon);
    expect("source" in both && typeof both.source.changedSince).toBe("function");
    expect("source" in half && half.source.ids).toBeUndefined();
  });

  it("keeps the source's own `this` for the functions it declared", () => {
    const owner = {
      ...source(),
      items: [{ id: "a" }],
      list(this: { items: unknown[] }) {
        return this.items;
      }
    };
    const read = readSource(owner, isIcon);
    expect("source" in read && read.source.list()).toEqual([{ id: "a" }]);
  });

  it("takes an id only as a plugin could have it", () => {
    expect(readSourceId("pythia")).toBe("pythia");
    expect(readSourceId("my-plugin-2")).toBe("my-plugin-2");
    expect(readSourceId("Pythia")).toBeNull();
    expect(readSourceId("a:b")).toBeNull();
    expect(readSourceId(7)).toBeNull();
  });

  it("opens only links Obsidian or a browser should", () => {
    expect(readLink("obsidian://pythia?id=1")).toBe("obsidian://pythia?id=1");
    expect(readLink("https://example.com/x")).toBe("https://example.com/x");
    expect(readLink("javascript:alert(1)")).toBeNull();
    expect(readLink("file:///etc/passwd")).toBeNull();
  });
});

describe("an item's id", () => {
  it("is never taken for a vault path, and splits back into source and item", () => {
    const key = itemKey("pythia", "c:1");
    expect(splitItemKey(key)).toEqual({ source: "pythia", item: "c:1" });
    expect(splitItemKey("Notizen/source.md")).toBeNull();
  });

  it("reads back as the caller wrote it", () => {
    expect(readPublicItemId(publicItemId("pythia", "c:1"))).toEqual({
      source: "pythia",
      item: "c:1"
    });
    expect(readPublicItemId("Notizen/a.md")).toBeNull();
  });
});

describe("relevance across kinds", () => {
  it("reads a similarity against its own floor", () => {
    expect(relevance(0.65, 0.65)).toBe(0);
    expect(relevance(1, 0.65)).toBe(1);
    expect(relevance(0.5, 0.65)).toBe(0);
    expect(relevance(Number.NaN, 0.5)).toBe(0);
  });

  it("puts first what clears its floor by more, whatever the raw numbers", () => {
    // A note barely past 0.65 against a conversation well past 0.57.
    const note = { ...hit("a.md", relevance(0.66, 0.65)), similarity: 0.66 };
    const talk = { ...hit("pythia:c1", relevance(0.64, 0.57), "conversation"), similarity: 0.64 };
    expect(mergeHits([[note], [talk]], 2).map((h) => h.id)).toEqual(["pythia:c1", "a.md"]);
  });

  it("caps the merged list", () => {
    expect(
      mergeHits([[hit("a", 0.9), hit("b", 0.5)], [hit("c", 0.7)]], 2).map((h) => h.id)
    ).toEqual(["a", "c"]);
  });
});

describe("the person's answer for each source", () => {
  it("keeps allowed and denied sources, and nothing else", () => {
    const answers = normalizeSourceConsent(
      JSON.parse('{"pythia": true, "other": false, "Bad Id": true, "x": "yes", "__proto__": true}')
    );
    expect({ ...answers }).toEqual({ pythia: true, other: false });
    expect(Object.getPrototypeOf(answers)).toBeNull();
    expect(normalizeSourceConsent([])).toEqual({});
  });

  it("says pending for a source never answered", () => {
    const answers = normalizeSourceConsent({ pythia: true, other: false });
    expect(consentOf(answers, "pythia")).toBe("allowed");
    expect(consentOf(answers, "other")).toBe("denied");
    expect(consentOf(answers, "new")).toBe("pending");
    expect(consentOf(answers, "toString")).toBe("pending");
  });
});
