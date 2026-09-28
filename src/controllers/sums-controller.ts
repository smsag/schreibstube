import { Notice, type App, type Editor, type Menu, type TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { obsidianLanguageTag, t } from "../i18n";
import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import { numberFormatFor } from "../services/amounts";
import { RATES_RETRY_MS, ratesStale, type ExchangeRates } from "../services/exchange-rates";
import { fetchEcbRates } from "../services/rates-client";
import { formatRateDate, type FormulaContext, type Outcome } from "../services/formulas";
import { selectionTotal } from "../services/selection-total";
import {
  formulaOutcomes,
  freezeFormulas,
  hasUnfrozenFormulas,
  resolveFormulas
} from "../services/table-formulas";

/**
 * What mail, publish and print ask of the formulas in a note: its text as it
 * leaves the vault, and the `(fixed)` results written back once it has.
 */
export interface NoteFormulas {
  /** The note's text with every formula replaced by its result. */
  forExport(markdown: string): Promise<string>;
  /** Write each `(fixed)` result not yet frozen into the note; answers how many. */
  freeze(file: TFile): Promise<number>;
}

/** For a controller nobody gave formulas to: the note leaves as it is. */
export const NO_FORMULAS: NoteFormulas = {
  forExport: async (markdown) => markdown,
  freeze: async () => 0
};

/** How long the selection is left to settle before its total is read. */
const SELECTION_SETTLE_MS = 120;

/**
 * Sums and formulas, wired to Obsidian.
 *
 * The reading, the arithmetic and the table rules live in services; this is
 * where they meet the settings, the status bar, the editor and the network.
 * The one network call is the exchange rates, made only when a total that
 * converting would put together is looked at or sent, and only when a person
 * switched converting on.
 */
export class SumsController implements NoteFormulas {
  private pending: Promise<ExchangeRates | null> | null = null;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private statusEl: HTMLElement | null = null;
  private statusTotal: string | null = null;
  private statusTimer = 0;
  private lastSelection = "";

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly saveRates: (rates: ExchangeRates) => Promise<void>,
    private readonly logger: Logger,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** The settings as the formulas read them, with the rates kept from last time. */
  context(): FormulaContext {
    const settings = this.getSettings();
    return {
      format: numberFormatFor(settings.sumsNumberStyle, obsidianLanguageTag()),
      defaultCurrency: settings.sumsDefaultCurrency,
      rates: settings.sumsConvert ? settings.sumsRates : null
    };
  }

  /**
   * Whether fetching rates would change one of these results: converting is
   * on, one of them mixes currencies or was converted at rates now old, and
   * the last attempt was not a moment ago.
   */
  private wantsRates(outcomes: readonly Outcome[]): boolean {
    const settings = this.getSettings();
    if (!settings.sumsConvert || !settings.sumsDefaultCurrency) return false;
    const affected = outcomes.some(
      (outcome) =>
        outcome.kind === "subtotals" ||
        outcome.kind === "mixed" ||
        (outcome.kind === "value" && outcome.rateDate !== null)
    );
    if (!affected || !ratesStale(settings.sumsRates, this.now())) return false;
    return this.now() - this.lastAttempt > RATES_RETRY_MS;
  }

  /**
   * Fetch the day's rates and keep them. One request at a time; asked for by
   * a person, it says how it went, otherwise it only logs.
   */
  updateRates(asked: boolean): Promise<ExchangeRates | null> {
    if (this.pending) return this.pending;
    this.lastAttempt = this.now();
    this.pending = fetchEcbRates(this.now())
      .then(async (rates) => {
        await this.saveRates(rates);
        if (asked) {
          const date = formatRateDate(rates.date, this.context().format);
          new Notice(t().common.notice(t().sums.ratesUpdated(date)));
        }
        return rates;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug("Exchange rates not fetched:", error);
        if (asked) new Notice(t().common.notice(t().sums.ratesFailed(message)));
        return null;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** Results on screen: fetch rates in the background if they would change one. */
  seen(outcomes: readonly Outcome[]): void {
    if (this.wantsRates(outcomes)) void this.updateRates(false);
  }

  /** A result without a number, in words. */
  unavailable(outcome: Outcome): string {
    return outcome.kind === "mixed" ? t().sums.mixed : t().sums.unavailable;
  }

  // --- leaving the vault --------------------------------------------------

  /** The context for a note about to leave: with fresh rates, when they matter to it. */
  private async exportContext(markdown: string): Promise<FormulaContext> {
    const ctx = this.context();
    if (!this.wantsRates(formulaOutcomes(markdown, ctx))) return ctx;
    await this.updateRates(false);
    return this.context();
  }

  async forExport(markdown: string): Promise<string> {
    if (!/=(?:sum|avg|median|count|min|max)/i.test(markdown)) return markdown;
    const ctx = await this.exportContext(markdown);
    return resolveFormulas(markdown, ctx, (outcome) => this.unavailable(outcome));
  }

  async freeze(file: TFile): Promise<number> {
    const content = await this.app.vault.read(file);
    if (!hasUnfrozenFormulas(content)) return 0;
    const ctx = await this.exportContext(content);
    let frozen = 0;
    await this.app.vault.process(file, (data) => {
      const result = freezeFormulas(data, ctx);
      frozen = result.frozen;
      return result.text;
    });
    return frozen;
  }

  /** The command: freeze now, before anything is sent. */
  async freezeNote(file: TFile): Promise<void> {
    try {
      const frozen = await this.freeze(file);
      new Notice(t().common.notice(t().sums.frozen(frozen)));
    } catch (error) {
      this.logger.error(`Could not freeze the totals in ${file.path}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(message));
    }
  }

  // --- the selection ------------------------------------------------------

  /** The status bar item, hidden until a selection has two amounts or more. */
  startStatusBar(el: HTMLElement): void {
    this.statusEl = el;
    el.addClass("mod-clickable", "schreibstube-sum-status");
    el.setAttr("aria-label", t().sums.statusBarTitle);
    el.addEventListener("click", () => {
      if (this.statusTotal !== null) void this.copy(this.statusTotal);
    });
    this.showTotal(null);
  }

  /** Follows the selection of every editor; the one being selected in is the one shown. */
  editorExtension(): Extension {
    return EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return;
      const view = update.view;
      window.clearTimeout(this.statusTimer);
      this.statusTimer = window.setTimeout(() => {
        const text = view.state.selection.ranges
          .filter((range) => !range.empty)
          .map((range) => view.state.sliceDoc(range.from, range.to))
          .join("\n");
        this.showSelection(text);
      }, SELECTION_SETTLE_MS);
    });
  }

  /** Another note or no editor in front: its selection is not the one shown. */
  clearSelection(): void {
    window.clearTimeout(this.statusTimer);
    this.showSelection("");
  }

  stop(): void {
    window.clearTimeout(this.statusTimer);
  }

  private showSelection(text: string): void {
    this.lastSelection = text;
    const total = selectionTotal(text, this.context());
    if (!total || total.text === null) {
      this.showTotal(null);
      return;
    }
    this.showTotal(total.text, total.count);
    if (this.wantsRates([total.outcome])) {
      void this.updateRates(false).then((rates) => {
        if (rates && this.lastSelection === text) this.showSelection(text);
      });
    }
  }

  private showTotal(total: string | null, count = 0): void {
    this.statusTotal = total;
    const el = this.statusEl;
    if (!el) return;
    if (total === null) {
      el.setText("");
      el.toggleClass("is-hidden", true);
      return;
    }
    el.setText(t().sums.statusBar(total, count));
    el.toggleClass("is-hidden", false);
  }

  /** The command, for a phone, which has no status bar: the total as a notice. */
  sumSelection(editor: Editor): void {
    const total = selectionTotal(editor.getSelection(), this.context(), 1);
    if (!total) {
      new Notice(t().common.notice(t().sums.noAmounts));
      return;
    }
    const text = total.text ?? this.unavailable(total.outcome);
    new Notice(t().common.notice(t().sums.total(text, total.count)));
  }

  /** The editor's menu offers the total of what is selected, to copy. */
  addMenuItem(menu: Menu, editor: Editor): void {
    const total = selectionTotal(editor.getSelection(), this.context(), 1);
    if (!total || total.text === null) return;
    const text = total.text;
    menu.addItem((item) =>
      item
        .setTitle(t().sums.menuItem(text))
        .setIcon("sigma")
        .setSection("selection")
        .onClick(() => void this.copy(text))
    );
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(t().common.notice(t().sums.copied(text)));
    } catch (error) {
      this.logger.debug("Could not copy the total:", error);
    }
  }
}
