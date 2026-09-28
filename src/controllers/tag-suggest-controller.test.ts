import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { Notice } from "../testing/obsidian-stub";
import { fakeVault } from "../testing/fake-app";
import { createLogger } from "../services/logger";
import { setLanguage } from "../i18n";
import type { TagSuggestHost } from "../ui/tag-suggest-modal";
import type { RecommendedEntry } from "../services/tag-suggestions";
import { TagSuggestController } from "./tag-suggest-controller";

/** What the dialog was given, and the tags the person ticks in it. */
const dialog = vi.hoisted(() => ({
  host: null as TagSuggestHost | null,
  tick: null as string[] | null,
  opened: 0
}));

vi.mock("../ui/tag-suggest-modal", () => ({
  TagSuggestModal: class {
    constructor(
      _app: unknown,
      _title: string,
      private readonly host: TagSuggestHost
    ) {}
    open(): void {
      dialog.host = this.host;
      dialog.opened += 1;
      const tick = dialog.tick;
      if (tick) void this.host.load.then(() => this.host.add(tick));
    }
  }
}));

const PAPER = [
  "# On lasers",
  "",
  "Abstract. We build a laser.",
  "",
  "Keywords: Optics; Quantum Computing; Physik"
].join("\n");

function controllerFor(
  neighbours: (path: string) => Promise<RecommendedEntry[]>,
  modelTags: (content: string, vocabulary: readonly string[]) => Promise<string[] | null> = () =>
    Promise.resolve([])
) {
  const vault = fakeVault({
    notes: [
      { path: "Paper.md", content: PAPER, frontmatter: { tags: "physik" }, tags: ["#physik"] },
      { path: "A.md", content: "", tags: ["#optik", "#physik"] },
      { path: "B.md", content: "", tags: ["#optik", "#Labor"] },
      { path: "C.md", content: "", tags: ["#physik"] },
      { path: "D.md", content: "", tags: ["#optics"] }
    ]
  });
  const controller = new TagSuggestController(
    vault.app as unknown as App,
    neighbours,
    modelTags,
    createLogger(() => false)
  );
  const paper = vault.file("Paper.md") as unknown as TFile;
  return { vault, controller, paper };
}

const related =
  (...paths: string[]) =>
  () =>
    Promise.resolve(paths.map((path) => ({ path, isNote: true, reasons: [] })));

/** Let the dialog's write, which runs without being awaited, finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TagSuggestController", () => {
  beforeEach(() => {
    setLanguage("en");
    Notice.shown = [];
    dialog.host = null;
    dialog.tick = null;
    dialog.opened = 0;
  });

  it("offers what related notes share and what the paper states, once each", async () => {
    const { controller, paper } = controllerFor(related("A.md", "B.md", "Gone.md"));
    const found = await controller.suggestions(paper);

    expect(found.vault.map((s) => s.tag)).toEqual(["optik"]);
    expect(found.vault[0]).toMatchObject({ carriers: 2, linked: false });
    // "Physik" is carried already; "Optics" is the vault's own tag.
    expect(found.stated).toEqual([
      { tag: "optics", isNew: false, origin: "stated" },
      { tag: "quantum-computing", isNew: true, origin: "stated" }
    ]);
  });

  it("still offers the paper's keywords when related notes cannot be had", async () => {
    const { controller, paper } = controllerFor(() => Promise.reject(new Error("index busy")));
    const found = await controller.suggestions(paper);
    expect(found.vault).toEqual([]);
    expect(found.stated.map((s) => s.tag)).toEqual(["optics", "quantum-computing"]);
  });

  it("asks the model in the vault's words and shows only what is not offered yet", async () => {
    const modelTags = vi.fn(() => Promise.resolve(["Optik", "Laser Physics", "physik"]));
    const { controller, paper } = controllerFor(related("A.md", "B.md"), modelTags);
    controller.open(paper);

    const answer = await dialog.host?.askModel();
    expect(answer).toEqual([{ tag: "laser-physics", isNew: true, origin: "model" }]);
    const [content, vocabulary] = modelTags.mock.calls[0] as unknown as [string, string[]];
    expect(content).toBe(PAPER);
    expect(vocabulary[0]).toBe("physik");
    expect(vocabulary).toContain("Labor");
  });

  it("passes on that the model could not be asked", async () => {
    const { controller, paper } = controllerFor(related(), () => Promise.resolve(null));
    controller.open(paper);
    expect(await dialog.host?.askModel()).toBeNull();
  });

  it("adds the ticked tags to the note's tags, keeping what was there", async () => {
    const { vault, controller, paper } = controllerFor(related());
    dialog.tick = ["optik", "Physik", "quantum-computing"];
    controller.open(paper);
    await settle();

    expect(vault.frontmatterOf("Paper.md").tags).toEqual(["physik", "optik", "quantum-computing"]);
    expect(Notice.shown.at(-1)).toContain("2 tags added");
  });

  it("says so when every ticked tag was there already", async () => {
    const { vault, controller, paper } = controllerFor(related());
    await controller.add(paper, ["#Physik"]);
    expect(vault.frontmatterOf("Paper.md").tags).toBe("physik");
    expect(Notice.shown.at(-1)).toContain("already had");
  });

  it("says what failed when the note cannot be written", async () => {
    const { vault, controller, paper } = controllerFor(related());
    vault.app.fileManager.processFrontMatter = () => Promise.reject(new Error("locked"));
    await controller.add(paper, ["optik"]);
    expect(Notice.shown.at(-1)).toContain("locked");
  });

  it("opens the dialog before the suggestions are in, and fills it after", async () => {
    let answer: (entries: RecommendedEntry[]) => void = () => undefined;
    const slow = () => new Promise<RecommendedEntry[]>((resolve) => (answer = resolve));
    const { controller, paper } = controllerFor(slow);
    controller.open(paper);
    expect(dialog.opened).toBe(1);

    answer([
      { path: "A.md", isNote: true, reasons: [] },
      { path: "B.md", isNote: true, reasons: [] }
    ]);
    const found = await dialog.host?.load;
    expect(found?.vault.map((s) => s.tag)).toEqual(["optik"]);
  });

  it("opens one dialog at a time", () => {
    const { controller, paper } = controllerFor(related());
    controller.open(paper);
    controller.open(paper);
    expect(dialog.opened).toBe(1);
    dialog.host?.closed();
    controller.open(paper);
    expect(dialog.opened).toBe(2);
  });

  it("says so and offers nothing when the note cannot be read", async () => {
    const { vault, controller, paper } = controllerFor(related("A.md", "B.md"));
    vault.app.vault.cachedRead = () => Promise.reject(new Error("gone"));
    controller.open(paper);
    expect(await dialog.host?.load).toEqual({ vault: [], stated: [] });
    expect(await dialog.host?.askModel()).toBeNull();
    expect(Notice.shown.at(-1)).toContain("gone");
  });

  it("opens nothing without a note", async () => {
    const { controller } = controllerFor(related());
    controller.open(null);
    expect(dialog.host).toBeNull();
    expect(Notice.shown).toHaveLength(1);
  });
});
