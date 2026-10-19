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
 * and the delimiter the next program expects. Which cells there are, the
 * header guess and which columns are numbers are decided in `csv-table`.
 */
import { FileView, type TFile, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import {
  MAX_CSV_BYTES,
  csvRefusal,
  csvToGrid,
  isCsvExtension,
  type CsvGridOutcome
} from "../services/csv-table";

export const CSV_VIEW_TYPE = "schreibstube-csv";
export const CSV_EXTENSIONS = ["csv", "tsv"] as const;

export interface CsvViewHost {
  copyTable(file: TFile): Promise<void>;
}

export class CsvView extends FileView {
  override allowNoFile = false;
  /** Bumped by every load; a read that comes back after the next one began gives way. */
  private generation = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: CsvViewHost
  ) {
    super(leaf);
    this.addAction("copy", t().explorer.menu.copyCsvTable, () => {
      if (this.file) void this.host.copyTable(this.file);
    });
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

  protected override async onOpen(): Promise<void> {
    // A file changed by a sync or a spreadsheet is shown as it is now.
    this.registerEvent(
      this.app.vault.on("modify", (changed) => {
        if (this.file && changed === this.file) void this.draw(this.file);
      })
    );
  }

  override async onLoadFile(file: TFile): Promise<void> {
    await this.draw(file);
  }

  override async onUnloadFile(): Promise<void> {
    this.generation += 1;
    this.contentEl.empty();
  }

  private async draw(file: TFile): Promise<void> {
    const generation = ++this.generation;
    const words = t().explorer.csv;

    let outcome: CsvGridOutcome | { ok: false; message: string };
    if (file.stat.size > MAX_CSV_BYTES) {
      outcome = { ok: false, message: words.tooLarge(Math.round(MAX_CSV_BYTES / 1000)) };
    } else {
      try {
        outcome = csvToGrid(await this.app.vault.cachedRead(file), words.column);
      } catch {
        outcome = { ok: false, message: words.readFailed };
      }
    }
    if (generation !== this.generation) return;

    const root = this.contentEl;
    root.empty();
    root.addClass("schreibstube-csv");

    if (!outcome.ok) {
      const reason = "message" in outcome ? outcome.message : csvRefusal(outcome.reason);
      root.createEl("p", { cls: "schreibstube-csv-refused", text: words.notShown(reason) });
      return;
    }

    const { table, columns, numeric } = outcome;
    root.createDiv({
      cls: "schreibstube-csv-summary",
      text: words.shown(table.rows.length, columns)
    });
    const el = root.createDiv({ cls: "schreibstube-csv-scroll" }).createEl("table");
    const head = el.createEl("thead").createEl("tr");
    table.header.forEach((cell, column) => {
      head.createEl("th", cellInfo(cell, numeric[column] === true));
    });
    const body = el.createEl("tbody");
    for (const row of table.rows) {
      const tr = body.createEl("tr");
      row.forEach((cell, column) => {
        tr.createEl("td", cellInfo(cell, numeric[column] === true));
      });
    }
  }
}

function cellInfo(text: string, number: boolean): DomElementInfo {
  return number ? { text, cls: "is-number" } : { text };
}
