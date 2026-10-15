import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildRelatedFile,
  carriesTag,
  clipPassage,
  findProjects,
  fitBudget,
  hasSubstance,
  nextRelatedRun,
  passageHeading,
  projectTag,
  readRelatedFile,
  relatedFileAction,
  sameRelatedContent,
  serializeRelatedFile,
  MAX_PASSAGE_UNITS,
  MAX_RELATED_PER_PROJECT,
  type ExportNote,
  type ExportRow,
  type RelatedFile
} from "./related-export";
import { quantize } from "./vector-math";
import { passageHashes } from "./embedding-index";
import { vaultNoteChunks } from "./vault-retrieval";

/**
 * The other half of the contract: Nimbus reads what this writes, and both
 * run the same table (contracts/RELATED.md, contracts/related-cases.json).
 */
const cases = JSON.parse(readFileSync("contracts/related-cases.json", "utf8")) as {
  projectTags: { value: string; tag: string | null }[];
  carriesTag: { text: string; tag: string; carries: boolean }[];
  substance: { text: string; substance: boolean }[];
  files: { content: string; accepted: boolean; refused?: string }[];
};

describe("the shared related contract, in the plugin", () => {
  for (const { value, tag } of cases.projectTags) {
    it(`reads the project tag of ${JSON.stringify(value)} as ${JSON.stringify(tag)}`, () => {
      expect(projectTag(value)).toBe(tag);
    });
  }
  for (const { text, tag, carries } of cases.carriesTag) {
    it(`${carries ? "finds" : "does not find"} #${tag} in ${JSON.stringify(text)}`, () => {
      expect(carriesTag(text, tag)).toBe(carries);
    });
  }
  for (const { text, substance } of cases.substance) {
    it(`${substance ? "finds" : "finds no"} substance in ${JSON.stringify(text)}`, () => {
      expect(hasSubstance(text)).toBe(substance);
    });
  }
  for (const { content, accepted, refused } of cases.files) {
    it(`${accepted ? "accepts" : `refuses (${refused ?? ""})`} ${content.slice(0, 40)}…`, () => {
      const read = readRelatedFile(content);
      expect(read.ok).toBe(accepted);
      if (!read.ok) expect(read.refused).toBe(refused);
    });
  }
});

describe("projectTag", () => {
  it("is null for anything but a string", () => {
    expect(projectTag(12)).toBeNull();
    expect(projectTag(undefined)).toBeNull();
    expect(projectTag(["a"])).toBeNull();
  });
});

describe("carriesTag", () => {
  it("takes a tag at a line start, after punctuation, and before a full stop", () => {
    expect(carriesTag("#umzug am Montag", "umzug")).toBe(true);
    expect(carriesTag("(siehe #umzug).", "umzug")).toBe(true);
    expect(carriesTag("Wort\n#Umzug", "umzug")).toBe(true);
  });
  it("refuses one inside a link, an entity or a URL", () => {
    expect(carriesTag("[[Plan#umzug]]", "umzug")).toBe(false);
    expect(carriesTag("&#umzug;", "umzug")).toBe(false);
    expect(carriesTag("x.de/#umzug", "umzug")).toBe(false);
    expect(carriesTag("a=#umzug", "umzug")).toBe(false);
    expect(carriesTag("#umzug_neu und #umzug-alt", "umzug")).toBe(false);
  });
  it("finds a later occurrence after an earlier one that does not count", () => {
    expect(carriesTag("x#umzug und dann #umzug", "umzug")).toBe(true);
  });
  it("takes a tag with characters a pattern would read", () => {
    expect(carriesTag("#a.b+c", "a.b+c")).toBe(true);
    expect(carriesTag("#axb+c", "a.b+c")).toBe(false);
    expect(carriesTag("#a", "")).toBe(false);
  });
});

describe("passageHeading", () => {
  it("names the heading the passage starts with, or nothing", () => {
    expect(passageHeading("## Compliance\nText")).toBe("Compliance");
    expect(passageHeading("# Titel  ")).toBe("Titel");
    expect(passageHeading("Text\n## Später")).toBeNull();
    expect(passageHeading("#tag am Anfang")).toBeNull();
  });
});

describe("clipPassage", () => {
  it("cuts at 600 code units, never inside a surrogate pair", () => {
    expect(clipPassage("a".repeat(700))).toHaveLength(MAX_PASSAGE_UNITS);
    expect(clipPassage("kurz")).toBe("kurz");
    const pair = `${"a".repeat(599)}😀rest`;
    expect(clipPassage(pair)).toBe("a".repeat(599));
  });
});

describe("findProjects", () => {
  const note = (path: string, frontmatter: unknown): ExportNote => ({
    path,
    mtime: 0,
    frontmatter,
    tags: []
  });
  it("sorts by tag, keeps the first note by path, and skips opted-out notes", () => {
    expect(
      findProjects([
        note("z.md", { nimbusProject: "#Beta" }),
        note("b.md", { nimbusProject: "alpha" }),
        note("a.md", { nimbusProject: "Alpha" }),
        note("c.md", { nimbusProject: "gamma", schreibstubeIndex: false }),
        note("d.md", { nimbusProject: "" }),
        note("e.md", null)
      ])
    ).toEqual([
      { tag: "alpha", note: "a.md" },
      { tag: "beta", note: "z.md" }
    ]);
  });
});

// A tiny model: every passage points along the topics its text names.
const TOPICS = ["KISTEN", "STEUER", "GARTEN", "MOEBEL"];
function vectorFor(text: string): Int8Array {
  const v = new Float32Array(TOPICS.length + 1);
  TOPICS.forEach((topic, i) => {
    if (text.includes(topic)) v[i] = 1;
  });
  v[TOPICS.length] = 0.05;
  return quantize(v);
}

const FILLER = "mit genug Worten darin damit es Substanz hat und nicht nur Rauschen ist";

function world(
  notes: { path: string; content: string; frontmatter?: unknown; mtime?: number }[],
  opts: { stale?: string[]; unindexed?: string[] } = {}
) {
  const exportNotes: ExportNote[] = notes.map((n) => ({
    path: n.path,
    mtime: n.mtime ?? Date.UTC(2026, 9, 12),
    frontmatter: n.frontmatter ?? {},
    tags: [...n.content.matchAll(/#([\w/-]+)/g)].map((m) => (m[1] ?? "").toLowerCase())
  }));
  const rows: ExportRow[] = notes
    .filter((n) => !opts.unindexed?.includes(n.path))
    .map((n) => {
      const chunks = vaultNoteChunks(n.content, 500);
      const hashes = passageHashes(chunks);
      if (opts.stale?.includes(n.path)) hashes[0] = (hashes[0] ?? 0) + 1;
      return { id: n.path, chunks: chunks.map(vectorFor), passages: hashes };
    });
  const texts = new Map(notes.map((n) => [n.path, n.content]));
  return {
    notes: exportNotes,
    rows,
    model: "m",
    floor: 0.65,
    maxChars: 500,
    now: Date.UTC(2026, 9, 14, 18),
    load: async (path: string) => texts.get(path) ?? null
  };
}

describe("buildRelatedFile", () => {
  const base = [
    {
      path: "Projekte/Umzug.md",
      content: `# Umzug\nKISTEN packen ${FILLER}`,
      frontmatter: { nimbusProject: "#Umzug" }
    },
    { path: "Kisten.md", content: `## Packliste\nKISTEN zählen ${FILLER}` },
    { path: "Steuer.md", content: `STEUER erklären ${FILLER}` },
    { path: "Getaggt.md", content: `#umzug/kisten KISTEN ${FILLER}` },
    {
      path: "Bericht.md",
      content: `KISTEN Bericht ${FILLER}`,
      frontmatter: { type: "Summary" }
    }
  ];

  it("lists the notes like the project's passages, without its own and reports", async () => {
    const file = await buildRelatedFile(world(base));
    expect(file.writtenAt).toBe("2026-10-14T18:00:00.000Z");
    expect(file.projects).toHaveLength(1);
    const [project] = file.projects;
    expect(project?.tag).toBe("umzug");
    expect(project?.note).toBe("Projekte/Umzug.md");
    expect(project?.related.map((r) => r.path)).toEqual(["Kisten.md"]);
    expect(project?.related[0]).toEqual({
      path: "Kisten.md",
      heading: "Packliste",
      text: `## Packliste\nKISTEN zählen ${FILLER}`,
      score: expect.any(Number) as number,
      modified: "2026-10-12T00:00:00.000Z"
    });
    expect(project?.related[0]?.score).toBeGreaterThanOrEqual(0.65);
    expect(readRelatedFile(serializeRelatedFile(file)).ok).toBe(true);
  });

  it("searches from other notes' tagged passages too", async () => {
    const file = await buildRelatedFile(
      world([
        { path: "P.md", content: "Kurz", frontmatter: { nimbusProject: "umzug" } },
        { path: "Meeting.md", content: `## Umzug\n#umzug MOEBEL bestellen ${FILLER}` },
        { path: "Moebel.md", content: `MOEBEL aussuchen ${FILLER}` },
        { path: "Garten.md", content: `GARTEN gießen ${FILLER}` }
      ])
    );
    expect(file.projects[0]?.related.map((r) => r.path)).toEqual(["Moebel.md"]);
  });

  it("has nothing for a project with no passage of substance", async () => {
    const file = await buildRelatedFile(
      world([
        { path: "P.md", content: "## Ziel\n## Aufgaben", frontmatter: { nimbusProject: "x" } },
        { path: "A.md", content: `KISTEN ${FILLER}` }
      ])
    );
    expect(file.projects).toEqual([{ tag: "x", note: "P.md", related: [] }]);
  });

  it("skips a note whose text moved since it was embedded", async () => {
    const file = await buildRelatedFile(world(base, { stale: ["Kisten.md"] }));
    expect(file.projects[0]?.related).toEqual([]);
  });

  it("does not search from a project note whose text moved", async () => {
    const file = await buildRelatedFile(
      world(
        base.filter((n) => n.path !== "Getaggt.md"),
        { stale: ["Projekte/Umzug.md"] }
      )
    );
    expect(file.projects[0]?.related).toEqual([]);
  });

  it("leaves out a note whose best passage is only headings", async () => {
    const file = await buildRelatedFile(
      world([
        base[0]!,
        {
          path: "Leer.md",
          content: `## KISTEN\n## KISTEN zwei\n\nSTEUER ${FILLER.repeat(8)}`
        }
      ])
    );
    expect(file.projects[0]?.related).toEqual([]);
  });

  it("leaves out a note that carries the tag though Obsidian did not say so", async () => {
    const w = world(base);
    const notes = w.notes.map((n) => (n.path === "Getaggt.md" ? { ...n, tags: [] } : n));
    const file = await buildRelatedFile({ ...w, notes });
    expect(file.projects[0]?.related.map((r) => r.path)).toEqual(["Kisten.md"]);
  });

  it("skips rows of notes no longer in the vault and unreadable notes", async () => {
    const w = world(base);
    const file = await buildRelatedFile({
      ...w,
      notes: w.notes.filter((n) => n.path !== "Kisten.md"),
      load: async (path) => (path === "Kisten.md" ? null : w.load(path))
    });
    expect(file.projects[0]?.related).toEqual([]);
    const failing = await buildRelatedFile({
      ...w,
      load: (path) => (path === "Kisten.md" ? Promise.reject(new Error("io")) : w.load(path))
    });
    expect(failing.projects[0]?.related).toEqual([]);
  });

  it("keeps the best twenty, one per note, best first then by path", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      path: `K${String(29 - i).padStart(2, "0")}.md`,
      content: `KISTEN ${i % 2 ? "STEUER" : ""} ${FILLER}`
    }));
    const file = await buildRelatedFile(world([base[0]!, ...many]));
    const related = file.projects[0]?.related ?? [];
    expect(related).toHaveLength(MAX_RELATED_PER_PROJECT);
    const plain = many
      .filter((_, i) => i % 2 === 0)
      .map((n) => n.path)
      .sort();
    expect(related.slice(0, 15).map((r) => r.path)).toEqual(plain);
    const scores = related.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("writes an empty list when there are no projects", async () => {
    const file = await buildRelatedFile(world([{ path: "a.md", content: "a" }]));
    expect(file.projects).toEqual([]);
    expect(readRelatedFile(serializeRelatedFile(file)).ok).toBe(true);
  });
});

function sample(related = 1, text = "Text"): RelatedFile {
  return {
    format: "schreibstube-related",
    version: 1,
    writtenAt: "2026-10-14T18:00:00.000Z",
    model: "m",
    floor: 0.65,
    projects: [
      {
        tag: "umzug",
        note: "P.md",
        related: Array.from({ length: related }, (_, i) => ({
          path: `N${i}.md`,
          heading: null,
          text,
          score: 0.7,
          modified: "2026-10-13T08:00:00.000Z"
        }))
      }
    ]
  };
}

describe("sameRelatedContent", () => {
  it("ignores writtenAt and nothing else", () => {
    const text = serializeRelatedFile(sample());
    expect(sameRelatedContent(text, { ...sample(), writtenAt: "2026-10-15T00:00:00.000Z" })).toBe(
      true
    );
    expect(sameRelatedContent(text, { ...sample(), floor: 0.6 })).toBe(false);
    expect(sameRelatedContent(text, sample(2))).toBe(false);
    expect(sameRelatedContent(null, sample())).toBe(false);
    expect(sameRelatedContent("{kaputt", sample())).toBe(false);
  });
});

describe("readRelatedFile", () => {
  const variant = (change: Record<string, unknown>): string =>
    JSON.stringify({ ...sample(), ...change });
  const entry = (change: Record<string, unknown>): string =>
    JSON.stringify({
      ...sample(),
      projects: [
        { ...sample().projects[0], related: [{ ...sample().projects[0]!.related[0], ...change }] }
      ]
    });

  it("refuses what is not the writer's shape", () => {
    expect(readRelatedFile("[]")).toEqual({ ok: false, refused: "json" });
    expect(readRelatedFile(variant({ model: 1 }))).toEqual({ ok: false, refused: "model" });
    expect(readRelatedFile(variant({ floor: "x" }))).toEqual({ ok: false, refused: "floor" });
    expect(readRelatedFile(variant({ projects: {} }))).toEqual({ ok: false, refused: "projects" });
    expect(readRelatedFile(variant({ projects: [1] }))).toEqual({ ok: false, refused: "projects" });
    expect(readRelatedFile(variant({ projects: [{ tag: "a", note: "", related: [] }] }))).toEqual({
      ok: false,
      refused: "projects"
    });
    expect(readRelatedFile(variant({ writtenAt: "gestern" }))).toEqual({
      ok: false,
      refused: "writtenAt"
    });
    for (const bad of [
      { path: "" },
      { heading: 3 },
      { text: "x".repeat(601) },
      { score: "0.7" },
      { modified: "2026-10-13" }
    ]) {
      expect(readRelatedFile(entry(bad))).toEqual({ ok: false, refused: "projects" });
    }
    expect(readRelatedFile(entry({ heading: "Kopf" })).ok).toBe(true);
  });

  it("refuses a file over 2 MB", () => {
    expect(readRelatedFile(" ".repeat(2 * 1024 * 1024 + 1))).toEqual({
      ok: false,
      refused: "size"
    });
  });
});

describe("fitBudget", () => {
  it("drops the last entries of the longest lists until the file fits", () => {
    const big = sample(20, "ü".repeat(600));
    const limit = serializeRelatedFile(sample(10, "ü".repeat(600))).length;
    const fitted = fitBudget(big, limit);
    const size = new TextEncoder().encode(serializeRelatedFile(fitted)).length;
    expect(size).toBeLessThanOrEqual(limit);
    expect(fitted.projects[0]?.related.length).toBeLessThan(20);
    expect(fitted.projects[0]?.related[0]?.path).toBe("N0.md");
    expect(big.projects[0]?.related).toHaveLength(20);
  });
  it("stops when there is nothing left to drop", () => {
    expect(fitBudget(sample(1), 10).projects[0]?.related).toEqual([]);
  });
});

describe("relatedFileAction", () => {
  it("writes on the desktop, deletes there when switched off, and leaves it on a phone", () => {
    expect(relatedFileAction({ device: "desktop", switchedOn: true })).toBe("write");
    expect(relatedFileAction({ device: "desktop", switchedOn: false })).toBe("delete");
    expect(relatedFileAction({ device: "mobile", switchedOn: true })).toBe("none");
    expect(relatedFileAction({ device: "mobile", switchedOn: false })).toBe("none");
  });
});

describe("nextRelatedRun", () => {
  it("waits for quiet, and at least five minutes after the last run", () => {
    expect(nextRelatedRun(1_000, Number.NEGATIVE_INFINITY, 30_000, 300_000)).toBe(31_000);
    expect(nextRelatedRun(100_000, 0, 30_000, 300_000)).toBe(300_000);
    expect(nextRelatedRun(400_000, 0, 30_000, 300_000)).toBe(430_000);
  });
});
