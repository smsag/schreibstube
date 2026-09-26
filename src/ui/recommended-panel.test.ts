// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../testing/obsidian-dom";
import { setLanguage } from "../i18n";
import { RecommendedPanel, type Recommendation, type RecommendedHost } from "./recommended-panel";

beforeAll(() => installObsidianDom());
beforeEach(() => setLanguage("en"));

const card = (path: string, kinds: ("link" | "meaning" | "tag")[] = ["link"]) => ({
  path,
  title: path.replace(/\.md$/, ""),
  folder: "",
  reasons: kinds.map((kind) => ({ kind, count: 1 }) as const)
});

function setup(recommend?: (path: string) => Promise<Recommendation | null>) {
  const root = document.createElement("div");
  const host: RecommendedHost = {
    cards: () => [card("linked.md")],
    ...(recommend ? { recommend } : {}),
    titleOf: (path) => path,
    open: vi.fn(async () => undefined),
    openConversation: vi.fn(),
    showMenu: vi.fn()
  };
  return { root, host, panel: new RecommendedPanel(root, host) };
}

/** The card titles, without an icon's glyph in front of a conversation's. */
const titles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll(".schreibstube-related-card-title")).map(
    (el) => el.lastChild?.textContent ?? ""
  );
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("RecommendedPanel", () => {
  it("draws the link graph's answer at once", () => {
    const { root, panel } = setup();
    panel.show("a.md");
    expect(titles(root)).toEqual(["linked"]);
  });

  it("draws meaning's answer when it comes: pictures, notes, conversations", async () => {
    const { root, panel, host } = setup(async () => ({
      notes: [card("linked.md"), card("kitchen.md", ["meaning"])],
      pictures: [{ path: "Bilder/see.jpg", title: "see", src: "app://see.jpg" }],
      conversations: [{ id: "c1", title: "Exposé Seestraße" }]
    }));
    panel.show("a.md");
    await settle();

    expect(titles(root)).toEqual(["linked", "kitchen", "Exposé Seestraße"]);
    expect(root.querySelector(".schreibstube-related-picture img")?.getAttribute("src")).toBe(
      "app://see.jpg"
    );
    expect(root.textContent).toContain("similar in meaning");

    (root.querySelector(".is-conversation") as HTMLElement).click();
    expect(host.openConversation).toHaveBeenCalledWith("c1");
  });

  it("drops an answer for a note that is no longer shown", async () => {
    const answers = new Map<string, (value: Recommendation) => void>();
    const { root, panel } = setup((path) => new Promise((r) => answers.set(path, r)));
    panel.show("a.md");
    panel.show("b.md");
    answers.get("a.md")?.({ notes: [card("stale.md")], pictures: [], conversations: [] });
    await settle();
    expect(titles(root)).toEqual(["linked"]);
  });

  it("does not ask again for the same note on every change", () => {
    const recommend = vi.fn(async () => null);
    const { panel } = setup(recommend);
    panel.show("a.md");
    panel.refresh();
    panel.refresh();
    expect(recommend).toHaveBeenCalledTimes(1);
  });

  it("says so when there is no note", () => {
    const { root, panel } = setup();
    panel.show(null);
    expect(root.textContent).toContain("Open a note");
  });
});
