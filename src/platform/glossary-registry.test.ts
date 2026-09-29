import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { fakeVault, type FakeNote } from "../testing/fake-app";
import { compileGlossaries } from "../services/glossary-matcher";
import { GlossaryRegistry } from "./glossary-registry";
import { TERM_AVOID_KEY } from "../services/glossary-term-folder";

const TERM = "Glossar/Terms/Kartellrecht.md";

function setup(notes: FakeNote[], folder = "Glossar") {
  const vault = fakeVault({ notes });
  let current = folder;
  const registry = new GlossaryRegistry(vault.app as unknown as App, () => current);
  return { vault, registry, setFolder: (next: string) => (current = next) };
}

const pythiaNotes = (): FakeNote[] => [
  {
    path: TERM,
    content: "---\ntype: term\n---\nDas Recht gegen Absprachen.\n\n> Ein Beleg.\n",
    frontmatter: { type: "term", source: "model", language: "de", [TERM_AVOID_KEY]: ["cartel law"] }
  },
  {
    path: "Glossar/Terms/Makler.md",
    content: "Vermittler.",
    frontmatter: { type: "term", source: "manual" }
  },
  {
    path: "Glossar/People/Ada.md",
    content: "Eine Person.",
    frontmatter: { type: "person", [TERM_AVOID_KEY]: ["Adda"] }
  },
  {
    path: "Glossaries/House.md",
    content:
      "---\nschreibstubeGlossary: true\n---\n| Concept | Term | Status |\n|--|--|--|\n| a | A | preferred |\n",
    frontmatter: { schreibstubeGlossary: true }
  }
];

describe("GlossaryRegistry with a term folder", () => {
  it("offers the folder beside the glossary notes", () => {
    const { registry } = setup(pythiaNotes());
    expect(registry.listCandidates()).toEqual([
      { path: "Glossar", name: "Glossar" },
      { path: "Glossaries/House.md", name: "House" }
    ]);
  });

  it("offers no folder when none is set, or when it holds no notes", () => {
    expect(setup(pythiaNotes(), "").registry.listCandidates()).toHaveLength(1);
    expect(setup(pythiaNotes(), "Leer").registry.listCandidates()).toHaveLength(1);
  });

  it("lists terms for the picker, and people not at all", () => {
    const { registry } = setup(pythiaNotes());
    expect(registry.termNotes().map((entry) => entry.term)).toEqual(["Kartellrecht", "Makler"]);
  });

  it("lists only the terms that carry a rule", () => {
    const { registry } = setup(pythiaNotes());
    expect(registry.termRules().map((rule) => [rule.term, rule.avoid])).toEqual([
      ["Kartellrecht", ["cartel law"]]
    ]);
  });

  it("loads the folder as a glossary, the definition marked as the model's", async () => {
    const { registry } = setup(pythiaNotes());
    const loaded = await registry.load(["Glossar"]);
    expect(loaded.missing).toEqual([]);
    const [hit] = compileGlossaries(loaded.glossaries).findHits("Hier gilt cartel law.");
    expect(hit?.replacement).toBe("Kartellrecht");
    expect(hit?.note).toContain("Das Recht gegen Absprachen.");
    expect(hit?.note).toContain("model");
  });

  it("rebuilds after a note in the folder changes, and only then", async () => {
    const { vault, registry } = setup(pythiaNotes());
    await registry.load(["Glossar"]);
    vault.frontmatterOf(TERM)[TERM_AVOID_KEY] = ["Kartellgesetz"];

    registry.invalidate("Glossaries/House.md");
    let matcher = compileGlossaries((await registry.load(["Glossar"])).glossaries);
    expect(matcher.findHits("Kartellgesetz")).toEqual([]);

    registry.invalidate(TERM);
    matcher = compileGlossaries((await registry.load(["Glossar"])).glossaries);
    expect(matcher.findHits("Kartellgesetz")).toHaveLength(1);
  });

  it("loads the folder together with a glossary note", async () => {
    const { registry } = setup(pythiaNotes());
    const loaded = await registry.load(["Glossaries/House.md", "Glossar"]);
    expect(loaded.glossaries.map((g) => g.path)).toEqual(["Glossaries/House.md", "Glossar"]);
  });
});
