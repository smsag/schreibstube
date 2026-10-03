// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { CURRENCY_CODES } from "../services/amounts";
import type { CalculationContext } from "../services/line-calculator";
import { installObsidianDom } from "../testing/obsidian-dom";
import { createCalculationExtension, drawSectionResults } from "./calculation-lines";

const CTX: CalculationContext = { format: "comma", currencies: CURRENCY_CODES };

beforeAll(() => installObsidianDom());

afterEach(() => {
  document.body.innerHTML = "";
});

function editor(doc: string, cursor: number, ctx: CalculationContext | null = CTX): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: createCalculationExtension(
        () => ctx,
        () => "Accept"
      )
    }),
    parent: document.body.createDiv()
  });
}

function pressTab(view: EditorView): boolean {
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  return runScopeHandlers(view, event, "editor");
}

describe("in the editor", () => {
  it("shows a line's result beside it, without writing it", () => {
    const view = editor("Miete 1.240 € - 15% =\nnichts", 0);

    expect(view.dom.querySelector(".schreibstube-calc-result")?.textContent).toBe("1.054,00 €");
    expect(view.state.doc.toString()).toBe("Miete 1.240 € - 15% =\nnichts");
  });

  it("writes the result in with Tab at the end of the line", () => {
    const view = editor("2 + 2 =  \nweiter", 9);

    expect(pressTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("2 + 2 = 4\nweiter");
    expect(view.state.selection.main.head).toBe(9);
  });

  it("leaves Tab to indent anywhere else on the line", () => {
    const view = editor("2 + 2 =", 3);

    expect(pressTab(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("2 + 2 =");
  });

  it("writes the result in when it is clicked", () => {
    const view = editor("2 + 2 =", 0);

    view.dom.querySelector<HTMLElement>(".schreibstube-calc-result")?.click();

    expect(view.state.doc.toString()).toBe("2 + 2 = 4");
  });

  it("shows nothing inside a code block, or while the setting is off", () => {
    expect(
      editor("```\n2 + 2 =\n```", 0).dom.querySelector(".schreibstube-calc-result")
    ).toBeNull();
    expect(editor("2 + 2 =", 0, null).dom.querySelector(".schreibstube-calc-result")).toBeNull();
  });
});

describe("in Reading view", () => {
  it("puts each result after the line it belongs to", () => {
    const el = document.body.createDiv();
    el.innerHTML = "<p>Grundpreis 12,5 * 8 + 3 =<br>und 2<em>3</em>4 =<br>Seite 5 =</p>";

    drawSectionResults(el, "Grundpreis 12,5 * 8 + 3 =\nund 2*3*4 =\nSeite 5 =", 0, 2, CTX);

    expect(el.innerHTML).toBe(
      '<p>Grundpreis 12,5 * 8 + 3 =<span class="schreibstube-calc-result">103</span><br>' +
        'und 2<em>3</em>4 =<span class="schreibstube-calc-result">24</span><br>Seite 5 =</p>'
    );
  });

  it("draws nothing when the rendered lines do not match the source one to one", () => {
    const el = document.body.createDiv();
    // Strict line breaks: two source lines rendered as one.
    el.innerHTML = "<p>2 + 2 = 3 + 3 =</p>";

    drawSectionResults(el, "2 + 2 =\n3 + 3 =", 0, 1, CTX);

    expect(el.querySelector(".schreibstube-calc-result")).toBeNull();
  });

  it("reads list items without the lists inside them", () => {
    const el = document.body.createDiv();
    el.innerHTML = "<ul><li>2 + 2 =<ul><li>3 + 3 =</li></ul></li></ul>";

    drawSectionResults(el, "- 2 + 2 =\n\t- 3 + 3 =", 0, 1, CTX);

    expect(
      Array.from(el.querySelectorAll(".schreibstube-calc-result")).map((s) => s.textContent)
    ).toEqual(["4", "6"]);
  });
});
