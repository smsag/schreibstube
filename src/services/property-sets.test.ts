import { describe, expect, it } from "vitest";
import { FM_CC, FM_SUBJECT, FM_TO } from "./mail-frontmatter";
import {
  applyPlan,
  BUILTIN_SETS,
  builtinSets,
  frontmatterBlock,
  hasTemplaterCode,
  isFolderSetPath,
  maskTemplaterCode,
  MAX_SET_KEYS,
  newKeys,
  planPropertySet,
  publishSet,
  readValue,
  setFromFrontmatter,
  setsToComplete,
  validKey,
  withoutTemplaterCode,
  type PropertySet
} from "./property-sets";
import { DEFAULT_PUBLISH_KEYS, type PublishKeyMap } from "./publish-index";

const mail = BUILTIN_SETS.find((set) => set.id === "schreibstube:mail")!;
const publish = publishSet(DEFAULT_PUBLISH_KEYS);

describe("the built-in sets", () => {
  it("add the keys Mail reads, not the ones sending writes", () => {
    expect(mail.entries.map((entry) => entry.key)).toEqual([FM_TO, FM_CC, FM_SUBJECT]);
  });

  it("have unique ids and only prefixed keys", () => {
    const ids = BUILTIN_SETS.map((set) => set.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const set of BUILTIN_SETS) {
      for (const entry of set.entries) expect(entry.key).toMatch(/^schreibstube[A-Z]/);
    }
  });

  it("include publishing, with an id of its own", () => {
    const ids = builtinSets(DEFAULT_PUBLISH_KEYS).map((set) => set.id);
    expect(ids).toContain("schreibstube:publish");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("publishSet", () => {
  it("adds the keys a person fills in, flagged, not the ones a run writes back", () => {
    expect(publish.entries).toEqual([
      { key: "published", value: true },
      { key: "title", value: "" },
      { key: "date", value: "" },
      { key: "description", value: "" },
      { key: "slug", value: "" }
    ]);
  });

  it("follows the keys the person mapped", () => {
    const keys: PublishKeyMap = {
      ...DEFAULT_PUBLISH_KEYS,
      published: "veroeffentlicht",
      title: "titel",
      date: "datum"
    };
    const set = publishSet(keys);
    expect(set.entries.map((entry) => entry.key)).toEqual([
      "veroeffentlicht",
      "titel",
      "datum",
      "description",
      "slug"
    ]);
    expect(set.offeredBy).toEqual(["veroeffentlicht"]);
  });
});

describe("isFolderSetPath", () => {
  it("takes Markdown notes beneath the folder only", () => {
    expect(isFolderSetPath("Vorlagen/Objekt.md", "Vorlagen")).toBe(true);
    expect(isFolderSetPath("Vorlagen/Sub/Mail.md", "Vorlagen")).toBe(true);
    expect(isFolderSetPath("Vorlagen/Bild.png", "Vorlagen")).toBe(false);
    expect(isFolderSetPath("VorlagenAlt/Objekt.md", "Vorlagen")).toBe(false);
    expect(isFolderSetPath("Objekt.md", "")).toBe(false);
  });
});

describe("frontmatterBlock", () => {
  it("returns the block between the fences", () => {
    expect(frontmatterBlock("---\na: 1\nb: 2\n---\nBody")).toBe("a: 1\nb: 2");
    expect(frontmatterBlock("---\r\na: 1\r\n---\r\n")).toBe("a: 1");
  });
  it("is empty for empty fences and null without any", () => {
    expect(frontmatterBlock("---\n---\nBody")).toBe("");
    expect(frontmatterBlock("Body only")).toBeNull();
  });
});

describe("hasTemplaterCode", () => {
  it("finds every form of Templater's tag", () => {
    expect(hasTemplaterCode("created: <% tp.date.now() %>")).toBe(true);
    expect(hasTemplaterCode("<%* tR += 'x' %>")).toBe(true);
    expect(hasTemplaterCode("<%+ tp.file.title %>")).toBe(true);
    expect(hasTemplaterCode("a < b and c % d")).toBe(false);
  });
});

describe("maskTemplaterCode", () => {
  it("leaves a tag that still reads as Templater code", () => {
    const masked = maskTemplaterCode(
      'created: <% tp.date.now("YYYY") %>\ntitle: "<%+ tp.file.title %>"'
    );
    expect(masked).toBe('created: <%%>\ntitle: "<%%>"');
    expect(hasTemplaterCode(masked)).toBe(true);
  });
});

describe("validKey", () => {
  it("refuses empty, over-long and control-character keys", () => {
    expect(validKey("status")).toBe(true);
    expect(validKey("  ")).toBe(false);
    expect(validKey("x".repeat(101))).toBe(false);
    expect(validKey("a\u0000b")).toBe(false);
  });
});

describe("readValue", () => {
  it("keeps scalars and flat lists", () => {
    expect(readValue("x")).toEqual({ ok: true, value: "x" });
    expect(readValue(3)).toEqual({ ok: true, value: 3 });
    expect(readValue(false)).toEqual({ ok: true, value: false });
    expect(readValue(undefined)).toEqual({ ok: true, value: null });
    expect(readValue(["a", 1, true])).toEqual({ ok: true, value: ["a", 1, true] });
  });
  it("writes a YAML date as the date it is", () => {
    expect(readValue(new Date("2026-09-27T00:00:00Z"))).toEqual({ ok: true, value: "2026-09-27" });
  });
  it("refuses objects, nested lists, non-finite numbers and oversize values", () => {
    expect(readValue({ a: 1 }).ok).toBe(false);
    expect(readValue([["a"]]).ok).toBe(false);
    expect(readValue([null]).ok).toBe(false);
    expect(readValue(Number.NaN).ok).toBe(false);
    expect(readValue("x".repeat(2001)).ok).toBe(false);
    expect(readValue(Array.from({ length: 51 }, () => "a")).ok).toBe(false);
  });
});

describe("setFromFrontmatter", () => {
  it("reads a set note's keys and values", () => {
    const { set, skipped } = setFromFrontmatter(
      "Vorlagen/Objekt.md",
      "Objekt",
      { objektId: "", status: "neu", tags: ["objekt"] },
      false
    );
    expect(set).toEqual({
      id: "Vorlagen/Objekt.md",
      name: "Objekt",
      source: "folder",
      templater: false,
      entries: [
        { key: "objektId", value: "" },
        { key: "status", value: "neu" },
        { key: "tags", value: ["objekt"] }
      ]
    });
    expect(skipped).toEqual([]);
  });

  it("names what it leaves out: nested values and a key repeated in another case", () => {
    const { set, skipped } = setFromFrontmatter(
      "p.md",
      "p",
      { a: 1, address: { street: "x" }, A: 2 },
      false
    );
    expect(set?.entries).toEqual([{ key: "a", value: 1 }]);
    expect(skipped).toEqual(["address", "A"]);
  });

  it("caps the number of keys", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_SET_KEYS + 3 }, (_, i) => [`k${i}`, i])
    );
    const { set, skipped } = setFromFrontmatter("p.md", "p", many, false);
    expect(set?.entries).toHaveLength(MAX_SET_KEYS);
    expect(skipped).toHaveLength(3);
  });

  it("is no set for frontmatter that is not a map, or has no usable key", () => {
    expect(setFromFrontmatter("p.md", "p", ["a"], false).set).toBeNull();
    expect(setFromFrontmatter("p.md", "p", null, false).set).toBeNull();
    expect(setFromFrontmatter("p.md", "p", { x: { y: 1 } }, false).set).toBeNull();
  });
});

describe("withoutTemplaterCode", () => {
  it("empties the values that hold code, keeping a list a list", () => {
    const { entries, blanked } = withoutTemplaterCode([
      { key: "created", value: "<% tp.date.now() %>" },
      { key: "tags", value: ["objekt", "<% tp.file.folder() %>"] },
      { key: "status", value: "neu" }
    ]);
    expect(entries).toEqual([
      { key: "created", value: null },
      { key: "tags", value: [] },
      { key: "status", value: "neu" }
    ]);
    expect(blanked).toEqual(["created", "tags"]);
  });
});

describe("planPropertySet and applyPlan", () => {
  it("adds only what is missing and never touches a value, empty or not", () => {
    const frontmatter: Record<string, unknown> = {
      schreibstubeto: ["a@b.de"],
      schreibstubeSubject: ""
    };
    const plan = planPropertySet(frontmatter, mail);
    expect(plan.add.map((entry) => entry.key)).toEqual([FM_CC]);
    expect(plan.kept).toEqual([FM_TO, FM_SUBJECT]);

    expect(applyPlan(frontmatter, plan)).toEqual([FM_CC]);
    expect(frontmatter).toEqual({
      schreibstubeto: ["a@b.de"],
      schreibstubeSubject: "",
      [FM_CC]: []
    });
  });

  it("re-checks at write time: a key that appeared meanwhile is kept", () => {
    const plan = planPropertySet({}, mail);
    const frontmatter: Record<string, unknown> = { [FM_SUBJECT]: "Typed meanwhile" };
    expect(applyPlan(frontmatter, plan)).toEqual([FM_TO, FM_CC]);
    expect(frontmatter[FM_SUBJECT]).toBe("Typed meanwhile");
  });

  it("gives every note its own list, never a shared one", () => {
    const plan = planPropertySet({}, mail);
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    applyPlan(first, plan);
    applyPlan(second, plan);
    (first[FM_TO] as string[]).push("x");
    expect(second[FM_TO]).toEqual([]);
    expect(mail.entries[0]?.value).toEqual([]);
  });
});

describe("newKeys", () => {
  it("lists keys that were not there before, ignoring case", () => {
    expect(newKeys(["a", "B"], ["a", "b", "c"])).toEqual(["c"]);
  });
});

describe("setsToComplete", () => {
  const objekt: PropertySet = {
    id: "Vorlagen/Objekt.md",
    name: "Objekt",
    source: "folder",
    templater: false,
    entries: [
      { key: "objektId", value: "" },
      { key: "status", value: "neu" }
    ]
  };

  it("offers the rest of a set whose key was just added", () => {
    expect(setsToComplete([mail, objekt], [FM_TO], { [FM_TO]: [] })).toEqual([
      { set: mail, missing: [FM_CC, FM_SUBJECT] }
    ]);
  });

  it("offers nothing when the added key belongs to no set, or the set is complete", () => {
    expect(setsToComplete([mail], ["other"], {})).toEqual([]);
    expect(setsToComplete([objekt], ["status"], { objektId: "4711", status: "neu" })).toEqual([]);
  });

  it("never offers a one-key set: adding its key completed it", () => {
    const print = BUILTIN_SETS.find((set) => set.id === "schreibstube:print")!;
    expect(setsToComplete([print], [print.entries[0]!.key], {})).toEqual([]);
  });

  it("offers publishing for its flag, never for a title or date added for other ends", () => {
    expect(setsToComplete([publish], ["date"], { date: "2026-10-01" })).toEqual([]);
    expect(setsToComplete([publish], ["Title"], { Title: "Tagebuch" })).toEqual([]);
    expect(setsToComplete([publish], ["Published"], { Published: true, title: "Hallo" })).toEqual([
      { set: publish, missing: ["date", "description", "slug"] }
    ]);
  });
});
