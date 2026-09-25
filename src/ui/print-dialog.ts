/**
 * The print dialog: four choices beside the pages they make.
 *
 * Opened by "Doc drucken" once the note has been read and its diagrams drawn.
 * Every change sets the document again and draws its first pages, so what a
 * person sees before pressing "Drucken" is the document that is written — the
 * same bytes, when nothing changed since the preview was set. The decisions
 * about what a choice means live in `services/print-options.ts`; this is the
 * wiring between them, the typesetter and the page.
 */
import { Modal, Setting, type App, type DropdownComponent, type ToggleComponent } from "obsidian";
import { t } from "../i18n";
import { drawPdfPages, MAX_PREVIEW_PAGES } from "../pdf/pdf-preview";
import {
  MARGIN_PRESETS,
  withTemplate,
  type MarginPreset,
  type PrintOptions
} from "../services/print-options";
import type { PrintTemplate } from "../services/print-template";

/** A document set for the dialog, with what it could not carry over. */
export interface PreparedPrint {
  pdf: Uint8Array;
  warnings: string[];
}

export interface PrintDialogHost {
  templates: PrintTemplate[];
  initial: PrintOptions;
  /** Whether the template's layout sets its own margins, so the presets do nothing. */
  fixesMargin: (template: PrintTemplate) => Promise<boolean>;
  preview: (options: PrintOptions, progress: (message: string) => void) => Promise<PreparedPrint>;
  /** `ready` is the preview's document when it was set with exactly these options. */
  print: (options: PrintOptions, ready: PreparedPrint | null) => Promise<void>;
}

/** How long typing into the dialog may pause before the preview is set again. */
const SETTLE_MS = 250;

export class PrintDialog extends Modal {
  private options: PrintOptions;
  /** Bumped by every change; a preview set for an older one is thrown away. */
  private generation = 0;
  private ready: { generation: number; prepared: PreparedPrint } | null = null;
  private timer = 0;
  private closed = false;

  private marginSetting: Setting | null = null;
  private marginDropdown: DropdownComponent | null = null;
  private breakToggle: ToggleComponent | null = null;
  private statusEl!: HTMLElement;
  private pagesEl!: HTMLElement;
  private warningsEl!: HTMLElement;

  constructor(
    app: App,
    private readonly host: PrintDialogHost
  ) {
    super(app);
    this.options = host.initial;
  }

  override onOpen(): void {
    const words = t().print.dialog;
    this.modalEl.addClass("schreibstube-print-dialog");
    this.setTitle(words.title);

    const body = this.contentEl.createDiv({ cls: "schreibstube-print-dialog-body" });
    const controls = body.createDiv({ cls: "schreibstube-print-dialog-controls" });
    const preview = body.createDiv({ cls: "schreibstube-print-dialog-preview" });

    this.renderControls(controls);

    this.statusEl = preview.createDiv({ cls: "schreibstube-print-dialog-status" });
    this.pagesEl = preview.createDiv({ cls: "schreibstube-print-dialog-pages" });
    this.warningsEl = preview.createDiv({ cls: "schreibstube-print-dialog-warnings" });

    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t().common.cancel).onClick(() => {
          this.close();
        })
      )
      .addButton((button) =>
        button
          .setButtonText(words.print)
          .setCta()
          .onClick(() => {
            this.submit();
          })
      );

    void this.refreshMargin();
    this.changed();
  }

  override onClose(): void {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.contentEl.empty();
  }

  private renderControls(el: HTMLElement): void {
    const words = t().print.dialog;

    new Setting(el).setName(words.template).addDropdown((dropdown) => {
      this.host.templates.forEach((template, index) => {
        const where = template.builtIn ? t().print.builtIn : template.folder;
        dropdown.addOption(String(index), `${template.name} — ${where}`);
      });
      const current = this.host.templates.indexOf(this.options.template);
      dropdown.setValue(String(Math.max(0, current))).onChange((value) => {
        const template = this.host.templates[Number(value)];
        if (!template) return;
        this.options = withTemplate(this.options, template);
        // Each template has its own habit about rules; the toggle follows it.
        this.breakToggle?.setValue(this.options.hrIsPageBreak);
        void this.refreshMargin();
        this.changed();
      });
    });

    this.marginSetting = new Setting(el).setName(words.margins).addDropdown((dropdown) => {
      this.marginDropdown = dropdown;
      for (const preset of MARGIN_PRESETS) dropdown.addOption(preset, words.margin[preset]);
      dropdown.setValue(this.options.margin).onChange((value) => {
        this.options = { ...this.options, margin: value as MarginPreset };
        this.changed();
      });
    });

    new Setting(el).setName(words.pageBreaks).addToggle((toggle) => {
      this.breakToggle = toggle;
      toggle.setValue(this.options.hrIsPageBreak).onChange((value) => {
        if (value === this.options.hrIsPageBreak) return;
        this.options = { ...this.options, hrIsPageBreak: value };
        this.changed();
      });
    });

    new Setting(el).setName(words.frontmatter).addToggle((toggle) => {
      toggle.setValue(this.options.frontmatter).onChange((value) => {
        this.options = { ...this.options, frontmatter: value };
        this.changed();
      });
    });
  }

  /**
   * Grey the margins out for a template that sets its own, and say why: a
   * choice that changes nothing on the page is worse than no choice.
   */
  private async refreshMargin(): Promise<void> {
    const template = this.options.template;
    let fixed = false;
    try {
      fixed = await this.host.fixesMargin(template);
    } catch {
      // A template that cannot be read says so in the preview; the margin row
      // stays usable rather than guess.
    }
    if (this.closed || this.options.template !== template) return;
    this.marginDropdown?.setDisabled(fixed);
    this.marginSetting?.setDesc(fixed ? t().print.dialog.marginFixed : "");
  }

  private changed(): void {
    this.generation += 1;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.renderPreview();
    }, SETTLE_MS);
  }

  private async renderPreview(): Promise<void> {
    const words = t().print.dialog;
    const generation = this.generation;
    const stale = (): boolean => this.closed || generation !== this.generation;

    this.statusEl.setText(words.working);
    this.statusEl.removeClass("is-error");
    this.pagesEl.addClass("is-stale");

    try {
      const prepared = await this.host.preview(this.options, (message) => {
        if (!stale()) this.statusEl.setText(message);
      });
      if (stale()) return;

      const width = Math.max(200, this.pagesEl.clientWidth - 24);
      const total = await drawPdfPages(prepared.pdf, this.pagesEl, width, stale);
      if (stale()) return;

      this.ready = { generation, prepared };
      this.pagesEl.removeClass("is-stale");
      this.statusEl.setText(words.pages(Math.min(total, MAX_PREVIEW_PAGES), total));
      this.warningsEl.empty();
      for (const warning of prepared.warnings) this.warningsEl.createDiv({ text: warning });
    } catch (error) {
      if (stale()) return;
      this.ready = null;
      this.pagesEl.empty();
      this.warningsEl.empty();
      this.statusEl.addClass("is-error");
      this.statusEl.setText(words.failed(error instanceof Error ? error.message : String(error)));
    }
  }

  private submit(): void {
    const ready = this.ready?.generation === this.generation ? this.ready.prepared : null;
    const options = this.options;
    this.close();
    void this.host.print(options, ready);
  }
}
