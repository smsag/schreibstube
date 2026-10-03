import { Notice, type App, type Editor, type Menu, type TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { obsidianLanguageTag, t } from "../i18n";
import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import { CURRENCY_CODES, numberFormatFor } from "../services/amounts";
import { calculationFormatFor, type CalculationContext } from "../services/line-calculator";
import { RATES_RETRY_MS, ratesStale, type ExchangeRates } from "../services/exchange-rates";
import { fetchEcbRates } from "../platform/rates-client";
import { formatRateDate, type FormulaContext, type Outcome } from "../services/formulas";
import { selectionTotal } from "../services/selection-total";
import { copyText } from "../ui/copy-text";

import {
  applyFreezes,
  formulaOutcomes,
  freezePlan,
  resolveFormulas,
  type FreezeEntry
} from "../services/table-formulas";

/** A note as it leaves the vault, and what to freeze once it has. */
export interface ExportedNote {
  /** The note's text with every formula replaced by its result. */
  text: string;
  /** The `(fixed)` results of exactly this copy, to be written back once it has left. */
  freezes: FreezeEntry[];
}

/**
 * What mail, publish and print ask of the formulas in a note: its text as it
 * leaves the vault, and the `(fixed)` results of that copy written back once
 * it has — from the copy, not from the note as it is by then, so what is
 * frozen is what the recipient got.
 */
export interface NoteFormulas {
  forExport(markdown: string): Promise<ExportedNote>;
  /** Write the frozen results into the note; answers how many. Throws when the note's formulas changed. */
  freeze(file: TFile, freezes: readonly FreezeEntry[]): Promise<number>;
}

/** For a controller nobody gave formulas to: the note leaves as it is. */
export const NO_FORMULAS: NoteFormulas = {
  forExport: async (markdown) => ({ text: markdown, freezes: [] }),
  freeze: async () => 0
};

/** A formula anywhere in the text, so a note without one is passed through untouched. */
const FORMULA_HINT = /=(?:sum|avg|median|count|min|max)/i;

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
  private pending: Promise<{ rates: ExchangeRates | null; error: string | null }> | null = null;
  private redraw: () => void = () => undefined;

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
   * The context of a calculation line, or null while they are switched off:
   * the same number format and the same rates as a table's formula, so a
   * number means the same in both.
   */
  calculationContext(): CalculationContext | null {
    const settings = this.getSettings();
    if (!settings.calculateLines) return null;
    const { format, defaultCurrency, rates } = this.context();
    return {
      format: calculationFormatFor(format),
      currencies: CURRENCY_CODES,
      conversion:
        rates && defaultCurrency
          ? { into: defaultCurrency, rates, day: formatRateDate(rates.date, format) }
          : null
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

  useRedraw(redraw: () => void): void {
    this.redraw = redraw;
  }

  /**
   * Fetch the day's rates and keep them. One request at a time, shared by
   * everyone who asks while it runs; asked for by a person, it says how it
   * went — also when the request was already on its way for someone else.
   */
  async updateRates(asked: boolean): Promise<ExchangeRates | null> {
    if (!this.pending) {
      this.lastAttempt = this.now();
      this.pending = fetchEcbRates(this.now())
        .then(async (rates) => {
          await this.saveRates(rates);
          return { rates, error: null };
        })
        .catch((error: unknown) => {
          this.logger.debug("Exchange rates not fetched:", error);
          return { rates: null, error: error instanceof Error ? error.message : String(error) };
        })
        .finally(() => {
          this.pending = null;
        });
    }
    const { rates, error } = await this.pending;
    if (asked) {
      new Notice(
        t().common.notice(
          rates
            ? t().sums.ratesUpdated(formatRateDate(rates.date, this.context().format))
            : t().sums.ratesFailed(error ?? "")
        )
      );
    }
    return rates;
  }

  /**
   * Results on screen: fetch rates in the background if they would change
   * one, and draw the notes again when they are here.
   */
  seen(outcomes: readonly Outcome[]): void {
    if (!this.wantsRates(outcomes)) return;
    void this.updateRates(false).then((rates) => {
      if (rates) this.redraw();
    });
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

  async forExport(markdown: string): Promise<ExportedNote> {
    if (!FORMULA_HINT.test(markdown)) return { text: markdown, freezes: [] };
    const ctx = await this.exportContext(markdown);
    return {
      text: resolveFormulas(markdown, ctx, (outcome) => this.unavailable(outcome)),
      freezes: freezePlan(markdown, ctx)
    };
  }

  async freeze(file: TFile, freezes: readonly FreezeEntry[]): Promise<number> {
    // Nothing to write is no write: a note whose waiting formulas have no
    // number yet, or that only mentions one in its prose, is left untouched.
    if (!freezes.some((entry) => entry.text !== null)) return 0;
    if (applyFreezes(await this.app.vault.read(file), freezes) === null) {
      throw new Error(t().sums.freezeStale);
    }
    let frozen = 0;
    await this.app.vault.process(file, (data) => {
      const result = applyFreezes(data, freezes);
      if (!result) return data;
      frozen = result.frozen;
      return result.text;
    });
    return frozen;
  }

  /** The command: freeze now, before anything is sent, at what the note says now. */
  async freezeNote(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      const frozen = await this.freeze(
        file,
        freezePlan(content, await this.exportContext(content))
      );
      new Notice(t().common.notice(t().sums.frozen(frozen)));
    } catch (error) {
      this.logger.error(`Could not freeze the totals in ${file.path}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t().common.notice(message));
    }
  }

  // --- the selection ------------------------------------------------------

  startStatusBar(el: HTMLElement): void {
    this.statusEl = el;
    el.addClass("mod-clickable", "schreibstube-sum-status");
    el.setAttr("aria-label", t().sums.statusBarTitle);
    el.addEventListener("click", () => {
      if (this.statusTotal !== null) void this.copy(this.statusTotal);
    });
    this.showTotal(null);
  }

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
    const total = selectionTotal(text, this.context(), 2, true);
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

  sumSelection(editor: Editor): void {
    const total = selectionTotal(editor.getSelection(), this.context(), 1);
    if (!total) {
      new Notice(t().common.notice(t().sums.noAmounts));
      return;
    }
    const text = total.text ?? this.unavailable(total.outcome);
    new Notice(t().common.notice(t().sums.total(text, total.count)));
  }

  addMenuItem(menu: Menu, editor: Editor): void {
    const total = selectionTotal(editor.getSelection(), this.context(), 1, true);
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
    await copyText(
      text,
      { copied: t().sums.copied(text), failed: t().sums.copyFailed },
      this.logger
    );
  }
}
