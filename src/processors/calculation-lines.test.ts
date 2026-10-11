// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
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

/** Live Preview or Source mode, the way Obsidian keeps it: a field in the editor's state. */
const setLive = StateEffect.define<boolean>();
const live = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setLive) ? e.value : v), value)
});

function editor(
  doc: string,
  cursor: number,
  ctx: CalculationContext | null = CTX,
  livePreview = false
): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        live.init(() => livePreview),
        createCalculationExtension(
          () => ctx,
          () => "Accept",
          (state) => state.field(live)
        )
      ]
    }),
    parent: document.body.createDiv()
  });
}

const lineText = (view: EditorView, index = 0): string =>
  view.dom.querySelectorAll(".cm-line")[index]?.textContent ?? "";

function pressTab(view: EditorView): boolean {
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  return runScopeHandlers(view, event, "editor");
}

describe("in the editor, beside the line (Source mode)", () => {
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

describe("in the editor, in place of the calculation (Live Preview)", () => {
  it("shows the result where the calculation was typed, and keeps the label", () => {
    const view = editor("Grundpreis 12,5 * 8 + 3 =\nweiter", 0, CTX, true);

    expect(lineText(view)).toBe("Grundpreis 103");
    expect(view.dom.querySelector(".schreibstube-calc-shown")?.getAttribute("title")).toBe(
      "12,5 * 8 + 3 ="
    );
    expect(view.dom.querySelector(".schreibstube-calc-result")).toBeNull();
    expect(view.state.doc.toString()).toBe("Grundpreis 12,5 * 8 + 3 =\nweiter");
  });

  it("shows the calculation again, with the result beside it, where the cursor is on it", () => {
    const view = editor("Grundpreis 12,5 * 8 + 3 =", 25, CTX, true);

    expect(lineText(view)).toBe("Grundpreis 12,5 * 8 + 3 =103");
    expect(view.dom.querySelector(".schreibstube-calc-shown")).toBeNull();
    expect(view.dom.querySelector(".schreibstube-calc-result")?.textContent).toBe("103");
  });

  it("treats the edges of the calculation as being on it", () => {
    const view = editor("Miete 2 + 2 =", 6, CTX, true);
    expect(view.dom.querySelector(".schreibstube-calc-shown")).toBeNull();

    view.dispatch({ selection: { anchor: 5 } });
    expect(view.dom.querySelector(".schreibstube-calc-shown")?.textContent).toBe("4");
  });

  it("follows the cursor on to the line and off it again", () => {
    const view = editor("2 + 2 =\n3 + 3 =", 0, CTX, true);
    expect(lineText(view, 0)).toBe("2 + 2 =4");
    expect(lineText(view, 1)).toBe("6");

    view.dispatch({ selection: { anchor: 10 } });
    expect(lineText(view, 0)).toBe("4");
    expect(lineText(view, 1)).toBe("3 + 3 =6");
  });

  it("keeps the calculation shown while a space after the `=` has the cursor", () => {
    const view = editor("2 + 2 = ", 8, CTX, true);

    expect(lineText(view)).toBe("2 + 2 = 4");
  });

  it("shows the calculation of every line a selection reaches", () => {
    const view = editor("2 + 2 =\n3 + 3 =\nweiter", 0, CTX, true);

    view.dispatch({ selection: { anchor: 3, head: 20 } });

    expect(view.dom.querySelector(".schreibstube-calc-shown")).toBeNull();
    expect(view.dom.querySelectorAll(".schreibstube-calc-result")).toHaveLength(2);
  });

  it("still writes the result in with Tab at the end of the line", () => {
    const view = editor("Miete 2 + 2 =", 13, CTX, true);

    expect(pressTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Miete 2 + 2 = 4");
  });

  it("writes the result in when the result beside the calculation is clicked", () => {
    const view = editor("2 + 2 =", 7, CTX, true);

    view.dom.querySelector<HTMLElement>(".schreibstube-calc-result")?.click();

    expect(view.state.doc.toString()).toBe("2 + 2 = 4");
  });

  it("does not write when the shown result is clicked: it only gives way to the text", () => {
    const view = editor("Miete 2 + 2 =", 0, CTX, true);

    view.dom.querySelector<HTMLElement>(".schreibstube-calc-shown")?.click();

    expect(view.state.doc.toString()).toBe("Miete 2 + 2 =");
  });

  it("draws again when the editor changes between Live Preview and Source mode", () => {
    const view = editor("Miete 2 + 2 =", 0, CTX, true);
    expect(lineText(view)).toBe("Miete 4");

    view.dispatch({ effects: setLive.of(false) });
    expect(lineText(view)).toBe("Miete 2 + 2 =4");

    view.dispatch({ effects: setLive.of(true) });
    expect(lineText(view)).toBe("Miete 4");
  });

  it("shows nothing for a line that is not a calculation, or while the setting is off", () => {
    expect(
      editor("Seite 5 =", 0, CTX, true).dom.querySelector(".schreibstube-calc-shown")
    ).toBeNull();
    expect(
      editor("2 + 2 =", 0, null, true).dom.querySelector(".schreibstube-calc-shown")
    ).toBeNull();
    expect(lineText(editor("2 + 2 =", 0, null, true))).toBe("2 + 2 =");
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
