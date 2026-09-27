// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../testing/obsidian-dom";
import { setLanguage } from "../i18n";
import { RecommendedPanel, type Recommendation, type RecommendedHost } from "./recommended-panel";
import { iconGlyph } from "./icon-font";
import { TASK_PILL_CLASS } from "./task-count-label";

beforeAll(() => installObsidianDom());
beforeEach(() => setLanguage("en"));

const card = (path: string, kinds: ("link" | "meaning" | "tag")[] = ["link"]) => ({
  path,
  title: path.replace(/\.md$/, ""),
  folder: "",
  reasons: kinds.map((kind) => ({ kind, count: 1 }) as const)
});

const note = (path: string, kinds?: ("link" | "meaning" | "tag")[]) => ({
  kind: "note" as const,
  card: card(path, kinds)
});

function setup(recommend?: (path: string) => Promise<Recommendation | null>, count = 7) {
  const root = document.createElement("div");
  const host: RecommendedHost = {
    cards: () => [card("linked.md")],
    count: () => count,
    ...(recommend ? { recommend } : {}),
    titleOf: (path) => path,
    open: vi.fn(async () => undefined),
    openConversation: vi.fn(),
    showMenu: vi.fn(),
    glyphOf: (path) => (path.endsWith(".png") ? "photo" : "file-text"),
    copyLink: vi.fn()
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

  it("draws meaning's answer as one list, in the order it was ranked, not by kind", async () => {
    const { root, panel, host } = setup(async () => ({
      items: [
        { kind: "conversation", conversation: { id: "c1", title: "Exposé Seestraße" } },
        note("linked.md"),
        {
          kind: "picture",
          picture: { path: "Bilder/see.jpg", title: "see", src: "app://see.jpg" }
        },
        note("kitchen.md", ["meaning"])
      ]
    }));
    panel.show("a.md");
    await settle();

    expect(titles(root)).toEqual(["Exposé Seestraße", "linked", "see", "kitchen"]);
    expect(root.querySelectorAll(".schreibstube-related-list")).toHaveLength(1);
    expect(root.querySelector(".schreibstube-related-section")).toBeNull();
    expect(root.querySelector(".is-picture img")?.getAttribute("src")).toBe("app://see.jpg");
    expect(root.textContent).toContain("similar in meaning");

    (root.querySelector(".is-conversation") as HTMLElement).click();
    expect(host.openConversation).toHaveBeenCalledWith("c1");
  });

  it("draws each entry as a register row: what it is, its title, and why", async () => {
    const { root, panel } = setup(async () => ({
      items: [
        {
          ...note("Erfolge/elli.md", ["meaning", "tag"]),
          card: {
            ...card("Erfolge/elli.md", ["meaning", "tag"]),
            folder: "Erfolge",
            title: "ELLI PIM"
          }
        },
        { kind: "conversation", conversation: { id: "c1", title: "Left Shift Testing" } },
        {
          kind: "picture",
          picture: { path: "Bilder/plan.png", title: "plan", src: "app://plan.png" }
        }
      ]
    }));
    panel.show("a.md");
    await settle();

    expect(root.querySelector("ol.schreibstube-related-list")).not.toBeNull();
    // What each entry is, as the Explorer draws it; Pythia's mark for a
    // conversation. No number: the order is the ranking, and the <ol> says so.
    const glyphs = Array.from(root.querySelectorAll(".schreibstube-related-glyph"));
    expect(glyphs.map((el) => el.textContent)).toEqual([
      iconGlyph("file-text"),
      iconGlyph("pythia"),
      iconGlyph("photo")
    ]);
    expect(glyphs.every((el) => el.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(root.querySelector(".schreibstube-related-rank")).toBeNull();

    const meta = Array.from(root.querySelectorAll(".schreibstube-related-card-meta")).map((el) =>
      Array.from(el.children).map((part) => part.textContent)
    );
    expect(meta).toEqual([
      ["Erfolge", "similar in meaning · 1 shared tag"],
      ["Conversation in Pythia", "similar in meaning"],
      ["Picture", "similar in meaning"]
    ]);
    // Reasons are words on the line now, never chips.
    expect(root.querySelector(".schreibstube-related-chip")).toBeNull();
  });

  it("starts a picture's title on the edge every other title starts on, its thumbnail apart at the end", async () => {
    const { root, panel } = setup(async () => ({
      items: [
        note("a.md"),
        { kind: "picture", picture: { path: "p.png", title: "p", src: "app://p.png" } }
      ]
    }));
    panel.show("x.md");
    await settle();

    // The same places in the same order for every kind: icon, text, actions,
    // and for a picture its thumbnail last, never in front of the text.
    const shape = (el: Element) => Array.from(el.children).map((child) => child.classList[0]);
    const [noteRow, pictureRow] = Array.from(root.querySelectorAll(".schreibstube-related-card"));
    expect(shape(noteRow!)).toEqual([
      "schreibstube-related-glyph",
      "schreibstube-related-card-text",
      "schreibstube-related-actions"
    ]);
    expect(shape(pictureRow!)).toEqual([
      "schreibstube-related-glyph",
      "schreibstube-related-card-text",
      "schreibstube-related-actions",
      "schreibstube-related-card-thumb"
    ]);
  });

  it("heads the list under a note with the section and its count, and the sidebar with the note", async () => {
    const recommend = async () => ({ items: [note("a.md"), note("b.md")] });
    const under = setup(recommend);
    const footer = new RecommendedPanel(under.root, under.host, { heading: false });
    footer.show("x.md");
    await settle();
    expect(under.root.querySelector(".schreibstube-related-section-label")?.textContent).toBe(
      "Recommended"
    );
    const count = under.root.querySelector(".schreibstube-related-section-count");
    expect(count?.textContent).toBe("2");
    // The Explorer's task pill, the one way a count is drawn beside a name.
    expect(count?.classList.contains(TASK_PILL_CLASS)).toBe(true);
    expect(under.root.querySelector(".schreibstube-related-header")).toBeNull();

    const side = setup(recommend);
    side.panel.show("x.md");
    await settle();
    expect(side.root.querySelector(".schreibstube-related-title")?.textContent).toBe("x.md");
    expect(side.root.querySelector(".schreibstube-related-summary")?.textContent).toBe(
      "2 recommendations"
    );
  });

  it("folds under a note at a press on its heading, and opens again for the next note", async () => {
    const recommend = async () => ({ items: [note("a.md"), note("b.md")] });
    const under = setup(recommend);
    const footer = new RecommendedPanel(under.root, under.host, { heading: false });
    footer.show("x.md");
    await settle();
    const heading = () => under.root.querySelector<HTMLElement>(".schreibstube-related-section")!;
    expect(heading().getAttribute("aria-expanded")).toBe("true");

    heading().click();
    expect(under.root.querySelector(".schreibstube-related-list")).toBeNull();
    expect(heading().getAttribute("aria-expanded")).toBe("false");
    // Still counted while folded, so the heading says what it holds.
    expect(under.root.querySelector(".schreibstube-related-section-count")?.textContent).toBe("2");

    heading().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(titles(under.root)).toEqual(["a", "b"]);

    heading().click();
    footer.show("y.md");
    await settle();
    expect(heading().getAttribute("aria-expanded")).toBe("true");
    expect(titles(under.root)).toEqual(["a", "b"]);
  });

  it("offers a file's Obsidian URL and a pane to the right, without opening the entry as well", async () => {
    const { root, panel, host } = setup(async () => ({
      items: [
        note("Docs/readme.md"),
        { kind: "conversation", conversation: { id: "c1", title: "Chat" } }
      ]
    }));
    panel.show("x.md");
    await settle();
    const [fileRow, chatRow] = Array.from(root.querySelectorAll(".schreibstube-related-card"));
    const buttons = (row: Element) =>
      Array.from(row.querySelectorAll<HTMLButtonElement>(".schreibstube-related-action"));
    expect(buttons(fileRow!).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Copy Obsidian URL",
      "Open to the right"
    ]);

    buttons(fileRow!)[0]!.click();
    expect(host.copyLink).toHaveBeenCalledWith({ kind: "file", path: "Docs/readme.md" });
    buttons(fileRow!)[1]!.click();
    expect(host.open).toHaveBeenCalledTimes(1);
    expect(host.open).toHaveBeenCalledWith("Docs/readme.md", "split");

    // A conversation has a link but no pane of its own: Pythia opens it.
    expect(buttons(chatRow!).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Copy Obsidian URL"
    ]);
    buttons(chatRow!)[0]!.click();
    expect(host.copyLink).toHaveBeenLastCalledWith({ kind: "conversation", id: "c1" });
    expect(host.openConversation).not.toHaveBeenCalled();
  });

  it("shows as many entries as the setting says", async () => {
    const { root, panel } = setup(
      async () => ({ items: ["a.md", "b.md", "c.md", "d.md"].map((path) => note(path)) }),
      2
    );
    panel.show("x.md");
    await settle();
    expect(titles(root)).toEqual(["a", "b"]);
  });

  it("drops an answer for a note that is no longer shown", async () => {
    const answers = new Map<string, (value: Recommendation) => void>();
    const { root, panel } = setup((path) => new Promise((r) => answers.set(path, r)));
    panel.show("a.md");
    panel.show("b.md");
    answers.get("a.md")?.({ items: [note("stale.md")] });
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
