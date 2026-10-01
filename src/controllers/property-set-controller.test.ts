import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { Notice } from "../testing/obsidian-stub";
import { fakeVault } from "../testing/fake-app";
import { createLogger } from "../services/logger";
import { DEFAULT_PUBLISH_KEYS, type PublishKeyMap } from "../services/publish-index";
import { setLanguage } from "../i18n";
import type { SetChoice } from "../ui/property-set-picker";
import type { SchreibstubeSettings } from "../types";
import { PropertySetController } from "./property-set-controller";

/** What the picker offered, and the answer the person gives it. */
const picker = vi.hoisted(() => ({
  offered: [] as SetChoice[],
  choose: null as null | ((choices: readonly SetChoice[]) => SetChoice | undefined)
}));

vi.mock("../ui/property-set-picker", () => ({
  PropertySetPickerModal: class {
    constructor(
      _app: unknown,
      private readonly choices: readonly SetChoice[],
      _placeholder: string,
      private readonly onChoose: (choice: SetChoice) => void
    ) {}
    open(): void {
      picker.offered = [...this.choices];
      const choice = picker.choose?.(this.choices);
      if (choice) this.onChoose(choice);
    }
  }
}));

const SET_FOLDER = "Vorlagen/Sets";

function controllerFor(folder: string, publishKeys: PublishKeyMap = DEFAULT_PUBLISH_KEYS) {
  const vault = fakeVault({
    notes: [
      { path: "Kapitel 1.md", content: "Text", frontmatter: { title: "Anfang" } },
      {
        path: `${SET_FOLDER}/Kapitel.md`,
        content: "---\nstatus: Entwurf\nwords: 0\n---\nBody is not part of the set.",
        frontmatter: { status: "Entwurf", words: 0 }
      },
      { path: `${SET_FOLDER}/Notizen ohne Frontmatter.md`, content: "Nur Text" }
    ]
  });
  const settings = {
    propertySetFolder: folder,
    publishFrontmatterKeys: publishKeys
  } as SchreibstubeSettings;
  const controller = new PropertySetController(
    vault.app as unknown as App,
    () => settings,
    createLogger(() => false)
  );
  return { vault, controller };
}

/** Let the picker's choice, which applies without being awaited, finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PropertySetController.pick", () => {
  beforeEach(() => {
    setLanguage("en");
    Notice.shown = [];
    picker.offered = [];
    picker.choose = null;
  });

  it("offers the person's own sets beside Schreibstube's", async () => {
    const { vault, controller } = controllerFor(SET_FOLDER);
    await controller.pick(vault.file("Kapitel 1.md") as unknown as TFile);

    const own = picker.offered.filter((choice) => choice.origin === `${SET_FOLDER}/Kapitel.md`);
    expect(own).toEqual([
      {
        id: `${SET_FOLDER}/Kapitel.md`,
        name: "Kapitel",
        origin: `${SET_FOLDER}/Kapitel.md`,
        keys: ["status", "words"]
      }
    ]);
    expect(picker.offered.some((choice) => choice.id === "schreibstube:mail")).toBe(true);
    // A note in the folder without frontmatter is not a set.
    expect(picker.offered.some((choice) => choice.name === "Notizen ohne Frontmatter")).toBe(false);
  });

  it("writes an own set's keys into the note when it is chosen", async () => {
    const { vault, controller } = controllerFor(SET_FOLDER);
    picker.choose = (choices) => choices.find((choice) => choice.name === "Kapitel");
    await controller.pick(vault.file("Kapitel 1.md") as unknown as TFile);
    await settle();

    expect(vault.frontmatterOf("Kapitel 1.md")).toEqual({
      title: "Anfang",
      status: "Entwurf",
      words: 0
    });
  });

  it("writes publishing's keys as the settings map them, keeping what the note has", async () => {
    const { vault, controller } = controllerFor("", {
      ...DEFAULT_PUBLISH_KEYS,
      published: "veroeffentlicht",
      date: "datum"
    });
    picker.choose = (choices) => choices.find((choice) => choice.id === "schreibstube:publish");
    await controller.pick(vault.file("Kapitel 1.md") as unknown as TFile);
    await settle();

    expect(vault.frontmatterOf("Kapitel 1.md")).toEqual({
      title: "Anfang",
      veroeffentlicht: false,
      datum: "",
      description: "",
      slug: "",
      publishedAt: "",
      publishedUrl: ""
    });
  });

  it("offers only Schreibstube's sets while no folder is set", async () => {
    const { vault, controller } = controllerFor("");
    await controller.pick(vault.file("Kapitel 1.md") as unknown as TFile);

    expect(picker.offered.length).toBeGreaterThan(0);
    expect(picker.offered.every((choice) => choice.id.startsWith("schreibstube:"))).toBe(true);
  });

  it("says so when no note is open", async () => {
    const { controller } = controllerFor(SET_FOLDER);
    await controller.pick(null);

    expect(picker.offered).toEqual([]);
    expect(Notice.shown).toHaveLength(1);
  });
});
