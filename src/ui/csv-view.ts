/**
 * A `.csv` or `.tsv` file, shown as the table it holds.
 *
 * Obsidian has no view for either, so it hid them from its own file list and
 * opened nothing when one was pressed — in a vault where the plugin turns the
 * same files into Markdown tables. With this view registered the extensions
 * count as supported: the core file list and quick switcher show them, and a
 * press opens the table.
 *
 * It only reads. Editing a spreadsheet export in a grid is what the
 * spreadsheet is for, and a view that wrote back would rewrite the quoting
 * and the delimiter the next program expects. Sorting, a search, hidden
 * columns and a total are ways of looking, kept with the tab; the copy takes
 * what is shown. Which cells there are, the header guess and which columns
 * are numbers are decided in `csv-table`; what the tab shows of them in
 * `csv-grid-view`.
 */
import { FileView, Menu, type TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import {
  INITIAL_VIEW_STATE,
  MAX_QUERY_LENGTH,
  nextSort,
  normalizeViewState,
  shownGrid,
  shownMarkdown,
  toggleHidden,
  totalsRow,
  type CsvViewState,
  type ShownGrid
} from "../services/csv-grid-view";
import { MAX_CSV_BYTES, csvRefusal, csvToGrid, isCsvExtension } from "../services/csv-table";
import type { FormulaContext, Outcome } from "../services/formulas";
import { evaluateGrid } from "../services/table-formulas";
import type { MarkdownTable } from "../services/text-to-table";

export const CSV_VIEW_TYPE = "schreibstube-csv";
export const CSV_EXTENSIONS = ["csv", "tsv"] as const;

/** Long enough that a word typed is one redraw of two thousand rows, not one per letter. */
const SEARCH_DELAY_MS = 150;

export interface CsvViewHost {
  copy(markdown: string, rows: number, columns: number, path: string): Promise<void>;
  /** The number format and currency a total is written in, as a note's `=sum` is. */
  formulaContext(): FormulaContext;
  /** A total that is no number — mixed currencies — in words. */
  unavailable(outcome: Outcome): string;
}

interface Grid {
  table: MarkdownTable;
  numeric: boolean[];
}

export class CsvView extends FileView {
  override allowNoFile = false;
  /** Bumped by every load; a read that comes back after the next one began gives way. */
  private generation = 0;
  private grid: Grid | null = null;
  private state: CsvViewState = INITIAL_VIEW_STATE;
  /** The file the state was kept for: another file opened in the tab starts afresh. */
  private stateFile: string | null = null;
  private summaryEl: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private searchTimer: number | null = null;
  private readonly totalsAction: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: CsvViewHost
  ) {
    super(leaf);
    const words = t().explorer.csv;
    this.addAction("copy", t().explorer.menu.copyCsvTable, () => void this.copyShown());
    this.addAction("columns-3", words.columns, (event) => this.chooseColumns(event));
    this.totalsAction = this.addAction("sigma", words.showTotals, () =>
      this.update({ totals: !this.state.totals })
    );
  }

  override getViewType(): string {
    return CSV_VIEW_TYPE;
  }

  override getIcon(): string {
    return "table";
  }

  override canAcceptExtension(extension: string): boolean {
    return isCsvExtension(extension);
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const kept = state as { file?: unknown; csv?: unknown } | null;
    this.state = normalizeViewState(kept?.csv);
    this.stateFile = typeof kept?.file === "string" ? kept.file : null;
    await super.setState(state, result);
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), csv: this.state };
  }

  protected override async onOpen(): Promise<void> {
    // A file changed by a sync or a spreadsheet is shown as it is now.
    this.registerEvent(
      this.app.vault.on("modify", (changed) => {
        if (this.file && changed === this.file) void this.draw(this.file);
      })
    );
  }

  protected override async onClose(): Promise<void> {
    this.cancelSearch();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    if (file.path !== this.stateFile) this.state = INITIAL_VIEW_STATE;
    this.stateFile = file.path;
    this.showTotalsState();
    await this.draw(file);
  }

  override async onUnloadFile(): Promise<void> {
    this.generation += 1;
    this.cancelSearch();
    this.grid = null;
    this.summaryEl = null;
    this.scrollEl = null;
    this.contentEl.empty();
  }

  private async draw(file: TFile): Promise<void> {
    const generation = ++this.generation;
    const words = t().explorer.csv;

    let message: string | null = null;
    let grid: Grid | null = null;
    if (file.stat.size > MAX_CSV_BYTES) {
      message = words.tooLarge(Math.round(MAX_CSV_BYTES / 1000));
    } else {
      try {
        const outcome = csvToGrid(await this.app.vault.cachedRead(file), words.column);
        if (outcome.ok) grid = { table: outcome.table, numeric: outcome.numeric };
        else message = csvRefusal(outcome.reason);
      } catch {
        message = words.readFailed;
      }
    }
    if (generation !== this.generation) return;

    this.grid = grid;
    const root = this.contentEl;
    root.addClass("schreibstube-csv");
    if (!grid) {
      root.empty();
      this.summaryEl = null;
      this.scrollEl = null;
      root.createEl("p", { cls: "schreibstube-csv-refused", text: words.notShown(message ?? "") });
      return;
    }
    // The search box survives a file changed underneath it: it may hold focus.
    if (!this.summaryEl || !this.scrollEl) this.build(root);
    this.renderTable();
  }

  private build(root: HTMLElement): void {
    const words = t().explorer.csv;
    root.empty();
    const bar = root.createDiv({ cls: "schreibstube-csv-bar" });
    const search = bar.createEl("input", {
      cls: "schreibstube-csv-search",
      type: "search",
      attr: { placeholder: words.search, "aria-label": words.search, maxlength: MAX_QUERY_LENGTH },
      value: this.state.query
    });
    search.addEventListener("input", () => this.searchSoon(search.value));
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || search.value === "") return;
      event.preventDefault();
      search.value = "";
      this.cancelSearch();
      this.update({ query: "" });
    });
    this.summaryEl = bar.createDiv({ cls: "schreibstube-csv-summary" });
    this.scrollEl = root.createDiv({ cls: "schreibstube-csv-scroll" });
  }

  private searchSoon(query: string): void {
    this.cancelSearch();
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      this.update({ query: query.slice(0, MAX_QUERY_LENGTH) });
    }, SEARCH_DELAY_MS);
  }

  private cancelSearch(): void {
    if (this.searchTimer === null) return;
    window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
  }

  private update(change: Partial<CsvViewState>): void {
    this.state = { ...this.state, ...change };
    this.showTotalsState();
    this.renderTable();
    this.app.workspace.requestSaveLayout();
  }

  private showTotalsState(): void {
    const words = t().explorer.csv;
    this.totalsAction.toggleClass("is-active", this.state.totals);
    this.totalsAction.setAttribute(
      "aria-label",
      this.state.totals ? words.hideTotals : words.showTotals
    );
  }

  private shown(): { shown: ShownGrid; totals: string[] | null } | null {
    if (!this.grid) return null;
    const ctx = this.host.formulaContext();
    const shown = shownGrid(this.grid.table, this.grid.numeric, this.state, ctx.format);
    const totals = this.state.totals ? totalsRow(shown.numeric, t().explorer.csv.total) : null;
    return { shown, totals };
  }

  private renderTable(): void {
    const view = this.shown();
    if (!view || !this.summaryEl || !this.scrollEl || !this.grid) return;
    const { shown, totals } = view;
    const words = t().explorer.csv;

    this.summaryEl.empty();
    const columns = shown.columns.length;
    this.summaryEl.appendText(
      shown.matched === shown.total
        ? words.shown(shown.total, columns)
        : words.shownOf(shown.matched, shown.total, columns)
    );
    const hidden = this.grid.table.header.length - columns;
    if (hidden > 0) {
      this.summaryEl.appendText(` · ${words.hidden(hidden)} · `);
      const all = this.summaryEl.createEl("a", { text: words.showAll, href: "#" });
      all.addEventListener("click", (event) => {
        event.preventDefault();
        this.update({ hidden: [] });
      });
    }

    this.scrollEl.empty();
    const table = this.scrollEl.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    shown.header.forEach((name, index) => {
      const column = shown.columns[index]!;
      const sorted = this.state.sort?.column === column ? this.state.sort.direction : null;
      const th = head.createEl("th", {
        attr: {
          "aria-sort": sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
        }
      });
      if (shown.numeric[index]) th.addClass("is-number");
      // Not a <button>: Obsidian styles every one, and a header is no control
      // the role set was drawn for. The keys a button answers to are given back.
      const label = th.createSpan({
        cls: "schreibstube-csv-sort",
        text: name,
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": words.sortBy(name || words.column(column + 1))
        }
      });
      if (sorted) label.addClass(`is-sorted-${sorted}`);
      const sort = () => this.update({ sort: nextSort(this.state.sort, column) });
      label.addEventListener("click", sort);
      label.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        sort();
      });
    });

    const body = table.createEl("tbody");
    for (const row of shown.rows) {
      const tr = body.createEl("tr");
      row.forEach((cell, index) => {
        tr.createEl("td", cellInfo(cell, shown.numeric[index] === true));
      });
    }
    if (shown.rows.length === 0 && this.state.query.trim()) {
      body.createEl("tr").createEl("td", {
        cls: "schreibstube-csv-empty",
        text: words.noMatch(this.state.query.trim()),
        attr: { colspan: columns }
      });
    }

    if (totals) this.renderTotals(table, shown, totals);
  }

  /**
   * The totals as a note's `=sum` would show them under the same rows: the
   * same reading of amounts, currencies and the number format.
   */
  private renderTotals(table: HTMLElement, shown: ShownGrid, totals: string[]): void {
    const results = evaluateGrid([shown.header, ...shown.rows, totals], this.host.formulaContext());
    const totalRow = shown.rows.length + 1;
    const tr = table.createEl("tfoot").createEl("tr");
    totals.forEach((cell, index) => {
      const result = results.find((entry) => entry.row === totalRow && entry.col === index);
      if (!result) {
        tr.createEl("td", { text: cell.replace(/^\*\*|\*\*$/g, "") });
        return;
      }
      tr.createEl("td", {
        cls: "is-number",
        text: result.shown ?? this.host.unavailable(result.outcome),
        attr: { title: "=sum" }
      });
    });
  }

  private chooseColumns(event: MouseEvent): void {
    const grid = this.grid;
    if (!grid) return;
    const words = t().explorer.csv;
    const menu = new Menu();
    const width = grid.table.header.length;
    grid.table.header.forEach((name, column) => {
      menu.addItem((item) =>
        item
          .setTitle(name || words.column(column + 1))
          .setChecked(!this.state.hidden.includes(column))
          .onClick(() => this.update({ hidden: toggleHidden(this.state.hidden, column, width) }))
      );
    });
    menu.showAtMouseEvent(event);
  }

  private async copyShown(): Promise<void> {
    const view = this.shown();
    if (!view || !this.file) return;
    const { shown, totals } = view;
    await this.host.copy(
      shownMarkdown(shown, totals),
      shown.rows.length,
      shown.columns.length,
      this.file.path
    );
  }
}

function cellInfo(text: string, number: boolean): DomElementInfo {
  return number ? { text, cls: "is-number" } : { text };
}
