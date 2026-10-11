// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { numberFormatFor } from "../services/amounts";
import type { FormulaContext, Outcome } from "../services/formulas";
import { installObsidianDom } from "../testing/obsidian-dom";
import { registerTableFormulaPostProcessor, type TableFormulaHost } from "./table-formulas";

const CTX: FormulaContext = {
  format: numberFormatFor("comma", "en"),
  defaultCurrency: "",
  rates: null
};

beforeAll(() => installObsidianDom());

afterEach(() => {
  document.body.innerHTML = "";
});

type Processor = (el: HTMLElement) => void;

function register(inEditor = true) {
  let process: Processor = () => undefined;
  let editor = inEditor;
  const host = {
    context: vi.fn((): FormulaContext => CTX),
    unavailable: (): string => "–",
    seen: vi.fn((_outcomes: readonly Outcome[]): void => undefined),
    inEditor: (): boolean => editor,
    setEditor(on: boolean): void {
      editor = on;
    }
  } satisfies TableFormulaHost & { setEditor(on: boolean): void };
  const plugin = {
    registerMarkdownPostProcessor(fn: Processor) {
      process = fn;
    }
  };
  const tables = registerTableFormulaPostProcessor(plugin as never, host);
  return { process: (el: HTMLElement) => process(el), tables, host };
}

/** Intl puts a space that cannot break before the euro sign; tests read plain ones. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/\u00a0|\u202f/g, " ");

/**
 * A table the way Live Preview draws it: each cell holds a wrapper with what it
 * renders to. A cell's html is given as it renders, so `<strong>=sum</strong>`
 * is the formula in bold.
 */
function livePreviewTable(rows: string[][]): HTMLTableElement {
  const widget = document.body.createDiv({ cls: "cm-embed-block cm-table-widget" });
  const table = widget.createEl("table", { cls: "table-editor" });
  rows.forEach((cells, index) => {
    const row = table.createEl(index === 0 ? "thead" : "tbody").createEl("tr");
    for (const html of cells) {
      const cell = row.createEl(index === 0 ? "th" : "td");
      cell.createDiv({ cls: "table-cell-wrapper" }).innerHTML = html;
    }
  });
  return table;
}

const contentOf = (table: HTMLTableElement, row: number, col: number): HTMLElement =>
  table.rows[row]?.cells[col]?.querySelector(".table-cell-wrapper") as HTMLElement;

/** Obsidian hands over every cell it draws, one by one, and the table is read after. */
async function drawCells(process: Processor, table: HTMLTableElement): Promise<void> {
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) process(cell.querySelector(".table-cell-wrapper")!);
  }
  await Promise.resolve();
}

const BUDGET = [
  ["Item", "Amount"],
  ["Groceries", "300 €"],
  ["Car", "20 €"],
  ["<strong>Total</strong>", "=sum"]
];

describe("in Live Preview", () => {
  it("shows a formula's result in its cell", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);

    await drawCells(process, table);

    expect(plain(contentOf(table, 3, 1).textContent)).toBe("320 €");
    expect(contentOf(table, 3, 1).querySelector(".schreibstube-formula")).not.toBeNull();
  });

  it("keeps the formula on the cell, as a hover", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);

    await drawCells(process, table);

    expect(table.rows[3]?.cells[1]?.getAttribute("title")).toBe("=sum");
  });

  it("leaves the cells that are not formulas as they are", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);

    await drawCells(process, table);

    expect(contentOf(table, 3, 0).innerHTML).toBe("<strong>Total</strong>");
    expect(contentOf(table, 1, 1).textContent).toBe("300 €");
    expect(table.rows[1]?.cells[1]?.hasAttribute("title")).toBe(false);
  });

  it("reads a table once, however many of its cells were drawn", async () => {
    const { process, host } = register();
    const table = livePreviewTable(BUDGET);

    await drawCells(process, table);

    expect(host.context).toHaveBeenCalledTimes(1);
  });

  it("keeps a result in the emphasis the formula had", async () => {
    const { process } = register();
    const table = livePreviewTable([
      ["Item", "Amount"],
      ["Car", "20 €"],
      ["Total", "<strong>=sum</strong>"]
    ]);

    await drawCells(process, table);

    const strong = contentOf(table, 2, 1).firstElementChild;
    expect(strong?.tagName).toBe("STRONG");
    expect(plain(strong?.textContent)).toBe("20 €");
  });

  it("says nothing of the cells it skipped: the notes are for Reading view", async () => {
    const { process } = register();
    const table = livePreviewTable([
      ["Item", "Amount"],
      ["Groceries", "plenty"],
      ["Car", "20 €"],
      ["Total", "=sum"]
    ]);

    await drawCells(process, table);

    expect(contentOf(table, 3, 1).querySelector(".schreibstube-formula-note")).toBeNull();
    expect(plain(contentOf(table, 3, 1).textContent)).toBe("20 €");
  });

  it("does not count a result it drew as an amount in the next formula", async () => {
    const { process, tables } = register();
    const table = livePreviewTable([
      ["Item", "Amount"],
      ["Groceries", "300 €"],
      ["Subtotal", "=sum"],
      ["Car", "20 €"],
      ["Total", "=sum"]
    ]);

    await drawCells(process, table);
    expect(plain(contentOf(table, 2, 1).textContent)).toBe("300 €");
    expect(plain(contentOf(table, 4, 1).textContent)).toBe("320 €");

    // Drawn again with the first result on screen: still 320, not 620.
    tables.redrawEditor();
    expect(plain(contentOf(table, 4, 1).textContent)).toBe("320 €");
  });

  it("leaves the cell whose editor is open alone", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);
    const cell = table.rows[3]?.cells[1] as HTMLTableCellElement;
    const editor = cell.createDiv({ cls: "table-cell-wrapper" });
    editor.createDiv({ cls: "cm-editor" }).textContent = "=sum";

    await drawCells(process, table);

    expect(contentOf(table, 3, 1).textContent).toBe("=sum");
    expect(cell.hasAttribute("title")).toBe(false);
  });

  it("shows the result again when Obsidian draws the cell after an edit", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);
    await drawCells(process, table);

    // The amount was edited; Obsidian rebuilds that cell from its text and hands it over.
    contentOf(table, 2, 1).innerHTML = "40 €";
    process(contentOf(table, 2, 1));
    await Promise.resolve();

    expect(plain(contentOf(table, 3, 1).textContent)).toBe("340 €");
    expect(contentOf(table, 3, 1).querySelectorAll(".schreibstube-formula")).toHaveLength(1);
  });

  it("follows a formula that was edited into another one", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);
    await drawCells(process, table);

    contentOf(table, 3, 1).innerHTML = "=avg";
    process(contentOf(table, 3, 1));
    await Promise.resolve();

    expect(plain(contentOf(table, 3, 1).textContent)).toBe("160 €");
    expect(table.rows[3]?.cells[1]?.getAttribute("title")).toBe("=avg");
  });

  it("lets go of a cell that was edited into something that is not a formula", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);
    await drawCells(process, table);

    contentOf(table, 3, 1).innerHTML = "n/a";
    process(contentOf(table, 3, 1));
    await Promise.resolve();

    expect(contentOf(table, 3, 1).textContent).toBe("n/a");
    expect(table.rows[3]?.cells[1]?.hasAttribute("title")).toBe(false);
    expect(table.rows[3]?.cells[1]?.hasAttribute("data-schreibstube-formula")).toBe(false);
  });

  it("tells the host which results are on screen, so rates can be fetched for them", async () => {
    const { process, host } = register();
    const table = livePreviewTable(BUDGET);

    await drawCells(process, table);

    const outcomes = host.seen.mock.calls[0]?.[0] ?? [];
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe("value");
  });

  it("draws nothing while the setting is off", async () => {
    const { process, host } = register(false);
    const table = livePreviewTable(BUDGET);

    await drawCells(process, table);

    expect(contentOf(table, 3, 1).textContent).toBe("=sum");
    expect(host.context).not.toHaveBeenCalled();
  });

  it("draws a table that was already on screen when the setting is switched on", async () => {
    const { process, tables, host } = register(false);
    const table = livePreviewTable(BUDGET);
    await drawCells(process, table);

    host.setEditor(true);
    tables.redrawEditor();

    expect(plain(contentOf(table, 3, 1).textContent)).toBe("320 €");
    expect(table.rows[3]?.cells[1]?.getAttribute("title")).toBe("=sum");
  });

  it("takes its results away again when the setting is switched off", async () => {
    const { process, tables, host } = register();
    const table = livePreviewTable([
      ["Item", "Amount"],
      ["Car", "20 €"],
      ["Total", "<strong>=sum</strong>"],
      ["Plain", "=max"]
    ]);
    await drawCells(process, table);
    expect(plain(contentOf(table, 2, 1).textContent)).toBe("20 €");

    host.setEditor(false);
    tables.redrawEditor();

    expect(contentOf(table, 2, 1).innerHTML).toBe("<strong>=sum</strong>");
    expect(contentOf(table, 3, 1).innerHTML).toBe("=max");
    expect(table.rows[2]?.cells[1]?.hasAttribute("title")).toBe(false);
  });

  it("draws the tables on screen again when asked, with fresh results", async () => {
    const { process, tables } = register();
    const table = livePreviewTable(BUDGET);
    await drawCells(process, table);

    // An amount changed under a result that is on screen.
    contentOf(table, 1, 1).innerHTML = "100 €";
    tables.redrawEditor();

    expect(plain(contentOf(table, 3, 1).textContent)).toBe("120 €");
  });

  it("forgets a table once it has left the document", async () => {
    const { process, tables, host } = register();
    const table = livePreviewTable(BUDGET);
    await drawCells(process, table);
    host.context.mockClear();

    table.closest(".cm-table-widget")?.remove();
    tables.redrawEditor();

    expect(host.context).not.toHaveBeenCalled();
  });

  it("draws a table Obsidian has not put on the page yet, which is how it first hands it over", async () => {
    const { process } = register();
    const table = livePreviewTable(BUDGET);
    table.closest(".cm-table-widget")?.remove();

    await drawCells(process, table);

    expect(plain(contentOf(table, 3, 1).textContent)).toBe("320 €");
  });

  it("does not take a wrapper outside Live Preview's table for one of its cells", () => {
    const { process, host } = register();
    const table = document.body.createEl("table");
    const cell = table.createEl("tbody").createEl("tr").createEl("td");
    const wrapper = cell.createDiv({ cls: "table-cell-wrapper" });
    wrapper.textContent = "=sum";

    process(wrapper);

    expect(host.context).not.toHaveBeenCalled();
    expect(wrapper.textContent).toBe("=sum");
  });
});

describe("in Reading view", () => {
  function section(): HTMLElement {
    const el = document.body.createDiv();
    el.innerHTML =
      "<table><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody>" +
      "<tr><td>Groceries</td><td>plenty</td></tr>" +
      "<tr><td>Car</td><td>20 €</td></tr>" +
      "<tr><td><strong>Total</strong></td><td><strong>=sum</strong></td></tr></tbody></table>";
    return el;
  }

  it("shows the result in the cell, with what was skipped beside it", () => {
    const { process } = register();
    const el = section();

    process(el);

    const total = el.querySelectorAll("tr")[3]?.cells[1] as HTMLTableCellElement;
    expect(plain(total.querySelector("strong .schreibstube-formula")?.textContent)).toBe("20 €");
    expect(total.querySelector(".schreibstube-formula-note")?.textContent).toBe("(1 cell skipped)");
    expect(total.getAttribute("title")).toBe("=sum");
  });

  it("is drawn whether or not the editor shows results", () => {
    const { process } = register(false);
    const el = section();

    process(el);

    expect(el.querySelector(".schreibstube-formula")).not.toBeNull();
  });

  it("leaves a section without a table alone", () => {
    const { process, host } = register();
    const el = document.body.createDiv();
    el.innerHTML = "<p>=sum</p>";

    process(el);

    expect(host.context).not.toHaveBeenCalled();
    expect(el.innerHTML).toBe("<p>=sum</p>");
  });
});
