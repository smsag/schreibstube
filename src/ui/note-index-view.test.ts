// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import type { NoteIndexOptions, NoteIndexPlan } from "../services/note-index";
import { installObsidianDom } from "../testing/obsidian-dom";
import { drawNoteIndex } from "./note-index-view";

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});

const open: NoteIndexOptions = { depth: 2, collapsed: false, unreadableLine: null };
const plan: NoteIndexPlan = {
  kind: "entries",
  entries: [
    { text: "Lage", line: 3, indent: 0 },
    { text: "Mikrolage", line: 7, indent: 1 }
  ]
};

function draw(drawn: NoteIndexPlan, options: NoteIndexOptions = open) {
  const container = document.body.createDiv();
  const actions = { toggle: vi.fn(), jump: vi.fn() };
  drawNoteIndex(container, drawn, options, actions);
  const head = container.querySelector<HTMLElement>(".schreibstube-note-index-line")!;
  const list = container.querySelector<HTMLElement>(".schreibstube-note-index-list");
  return { container, actions, head, list };
}

describe("drawNoteIndex", () => {
  it("heads the list with its count, figures in bold, as the task ribbon does", () => {
    const { head } = draw(plan);
    expect(head.textContent).toContain("Contents · 2 sections");
    expect(head.querySelector("strong")?.textContent).toBe("2");
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("folds with Obsidian's own arrow, inside the heading line so a press on it folds", () => {
    const { head, container } = draw(plan);
    const arrow = head.querySelector<HTMLElement>(".schreibstube-note-index-chevron");
    expect(arrow?.classList.contains("collapse-icon")).toBe(true);
    arrow!.click();
    expect(container.classList.contains("is-collapsed")).toBe(true);
  });

  it("lists each heading, indented as the outline reads", () => {
    const { list } = draw(plan);
    const items = Array.from(list!.querySelectorAll<HTMLElement>("li"));
    expect(items.map((item) => item.textContent)).toEqual(["Lage", "Mikrolage"]);
    expect(items.map((item) => item.style.getPropertyValue("--schreibstube-index-indent"))).toEqual(
      ["0", "1"]
    );
  });

  it("goes to a heading's own line when it is pressed, and nowhere else", () => {
    const { list, actions } = draw(plan);
    const outside = vi.fn();
    document.body.addEventListener("click", outside);
    list!.querySelectorAll<HTMLElement>("a")[1]!.click();
    expect(actions.jump).toHaveBeenCalledWith(7);
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener("click", outside);
  });

  it("folds on a press of the heading line, at once, and reports it", () => {
    const { container, head, list, actions } = draw(plan);
    head.click();
    expect(actions.toggle).toHaveBeenCalledWith(true);
    expect(container.classList.contains("is-collapsed")).toBe(true);
    expect(list!.style.display).toBe("none");
    expect(head.getAttribute("aria-expanded")).toBe("false");

    head.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(actions.toggle).toHaveBeenLastCalledWith(false);
    expect(list!.style.display).toBe("");
  });

  it("starts folded when the block says so", () => {
    const { list, head } = draw(plan, { ...open, collapsed: true });
    expect(list!.style.display).toBe("none");
    expect(head.getAttribute("aria-label")).toBe("Show the index");
  });

  it("says why there is no list, with nothing to press", () => {
    expect(draw({ kind: "empty" }).head.textContent).toBe("No headings up to level 2");
    expect(draw({ kind: "too-long", count: 214, fits: 1 }).head.textContent).toBe(
      "Index too long: 214 headings up to level 2. Set depth: 1 or split the note."
    );
    expect(draw({ kind: "too-long", count: 214, fits: null }).head.textContent).toBe(
      "Index too long: 214 headings up to level 2. Split the note."
    );
    const slow = draw({ kind: "too-slow" });
    expect(slow.head.textContent).toContain("took too long");
    expect(slow.head.getAttribute("role")).toBeNull();
    expect(slow.list).toBeNull();
  });

  it("names a line it did not understand, under the list", () => {
    const { container } = draw(plan, { ...open, unreadableLine: 2 });
    expect(container.querySelector(".schreibstube-note-index-hint")?.textContent).toContain(
      "Line 2 of the block was not understood"
    );
  });
});
