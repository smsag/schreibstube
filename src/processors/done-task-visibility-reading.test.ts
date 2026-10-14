// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { MarkdownPostProcessorContext } from "obsidian";
import type { DoneTaskVisibility } from "../services/done-task-visibility";
import {
  createDoneTaskReadingPostProcessor,
  DONE_TASK_DIMMED_CLASS,
  DONE_TASK_HIDDEN_CLASS
} from "./done-task-visibility-reading";
import { createTaskFoldPostProcessor, TASK_BODY_CLASS } from "./task-fold-reading";

/** A section as Obsidian renders a task list: `data-task` holds the mark. */
const SECTION = `
<ul>
  <li class="task-list-item" data-task=" " id="open"><input type="checkbox">open</li>
  <li class="task-list-item is-checked" data-task="x" id="done"><input type="checkbox">done
    <ul>
      <li class="task-list-item is-checked" data-task="-" id="done-child"><input type="checkbox">child</li>
      <li id="plain">a plain item</li>
    </ul>
  </li>
  <li class="task-list-item is-checked" data-task="x" id="parent"><input type="checkbox">parent
    <ul>
      <li class="task-list-item is-checked" data-task="x" id="middle"><input type="checkbox">middle
        <ul><li class="task-list-item" data-task="/" id="started"><input type="checkbox">started</li></ul>
      </li>
      <li class="task-list-item is-checked" data-task="X" id="sibling"><input type="checkbox">sibling</li>
    </ul>
  </li>
  <li class="task-list-item is-checked" data-task="?" id="flagged"><input type="checkbox">flagged</li>
  <li class="task-list-item is-checked" id="bare"><input type="checkbox">no data-task</li>
</ul>`;

function render(mode: DoneTaskVisibility, html = SECTION): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  const seen: { path: string; frontmatter: unknown }[] = [];
  const processor = createDoneTaskReadingPostProcessor((path, frontmatter) => {
    seen.push({ path, frontmatter });
    return mode;
  });
  const ctx = {
    sourcePath: "Note.md",
    frontmatter: { a: 1 }
  } as unknown as MarkdownPostProcessorContext;
  void processor(el, ctx);
  expect(seen).toEqual([{ path: "Note.md", frontmatter: { a: 1 } }]);
  return el;
}

function marked(el: HTMLElement, cls: string): string[] {
  return Array.from(el.querySelectorAll(`.${cls}`), (item) => item.id);
}

describe("done tasks in Reading view", () => {
  it("hides the outermost finished items that have no open work under them", () => {
    const el = render("hide");
    expect(marked(el, DONE_TASK_HIDDEN_CLASS)).toEqual(["done", "sibling", "bare"]);
    expect(marked(el, DONE_TASK_DIMMED_CLASS)).toEqual([]);
  });

  it("dims the same items, once each", () => {
    const el = render("dim");
    expect(marked(el, DONE_TASK_DIMMED_CLASS)).toEqual(["done", "sibling", "bare"]);
  });

  it("marks nothing when off", () => {
    const el = render("off");
    expect(el.querySelectorAll("[class*=schreibstube-done]").length).toBe(0);
  });

  it("leaves the fold of a ticked task's body to do its work beside it", () => {
    const el = document.createElement("div");
    el.innerHTML = SECTION;
    const ctx = { sourcePath: "Note.md" } as unknown as MarkdownPostProcessorContext;
    void createTaskFoldPostProcessor()(el, ctx);
    void createDoneTaskReadingPostProcessor(() => "dim")(el, ctx);
    const done = el.querySelector("#done");
    expect(done?.classList.contains(DONE_TASK_DIMMED_CLASS)).toBe(true);
    expect(done?.querySelector(`:scope > .${TASK_BODY_CLASS} #done-child`)).not.toBeNull();
  });
});
