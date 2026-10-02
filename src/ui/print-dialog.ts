/**
 * The print dialog: its choices beside the pages they make.
 *
 * Opened by "Doc drucken" once the note has been read and its diagrams drawn.
 * Every change sets the document again and draws its first pages, so what a
 * person sees before pressing "Drucken" is the document that is written — the
 * same bytes, when nothing changed since the preview was set. The decisions
 * about what a choice means live in `services/print-options.ts`; this is the
 * wiring between them, the typesetter and the page.
 */
import {
  Modal,
  Notice,
  Setting,
  type App,
  type DropdownComponent,
  type ToggleComponent
} from "obsidian";
import { t } from "../i18n";
import { PdfPreview, type PreviewMark } from "../pdf/pdf-preview";
import {
  blockAt,
  blockStart,
  breakMarks,
  toggleBreak,
  type BlockPosition
} from "../services/print-breaks";
import {
  MARGIN_PRESETS,
  SLIDE_FORMATS,
  withTemplate,
  type MarginPreset,
  type PrintOptions,
  type SlideFormat
} from "../services/print-options";
import { SLIDESHOW_PRINT_MODES, type SlideshowPrintMode } from "../services/print-slideshow";
import { SLIDE_ALIGNS, type SlideAlign } from "../services/print-slides";
import type { PrintTemplate } from "../services/print-template";
import type { PythiaInspection, PythiaRefresh } from "../services/pythia-print";

/**
 * Pythia, as the dialog sees it: what the note links to, and the one action
 * that costs something — writing the summaries again. Absent when Pythia is
 * not there or the note links to nothing of Pythia's.
 */
export interface PythiaPrintHost {
  inspection: PythiaInspection;
  /** The counts again, after a refresh changed them; null when Pythia stopped answering. */
  inspect: () => PythiaInspection | null;
  refresh: (
    signal: AbortSignal,
    progress: (done: number, total: number) => void
  ) => Promise<PythiaRefresh>;
}

/** A document set for the dialog, with what it could not carry over. */
export interface PreparedPrint {
  pdf: Uint8Array;
  warnings: string[];
  /** Where each top-level block of the note starts in `pdf`, for a click to find. */
  blocks: BlockPosition[];
}

export interface PrintDialogHost {
  templates: PrintTemplate[];
  /** Whether a marked passage is printed rather than the whole note, which the title says. */
  passage: boolean;
  initial: PrintOptions;
  /** Whether the note holds a slideshow; the choice about them is offered only then. */
  hasSlideshows: boolean;
  /** Whether the template's layout sets its own margins, so the presets do nothing. */
  fixesMargin: (template: PrintTemplate) => Promise<boolean>;
  /** Whether the template's layout reads the text-face choice, so it is offered. */
  readsMonospace: (template: PrintTemplate) => Promise<boolean>;
  preview: (options: PrintOptions, progress: (message: string) => void) => Promise<PreparedPrint>;
  /** Pythia's footnotes, when the note links to Pythia. */
  pythia?: PythiaPrintHost;
  /** `ready` is the preview's document when it was set with exactly these options. */
  /** Starts the print. Not accepted when one is already running, and the dialog stays. */
  print: (
    options: PrintOptions,
    ready: PreparedPrint | null
  ) => { accepted: boolean; done: Promise<void> };
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
  private breakSetting: Setting | null = null;
  private formatSetting: Setting | null = null;
  private alignSetting: Setting | null = null;
  private notesSetting: Setting | null = null;
  /** The preview on the panel, which holds its document until it is replaced. */
  private shown: PdfPreview | null = null;
  private faceSetting: Setting | null = null;
  private pythiaSetting: Setting | null = null;
  /** The hint about pointing at the preview, and the button that takes every break away. */
  private clickBreakSetting: Setting | null = null;
  /** Where each block starts in the preview on the panel. */
  private blocks: BlockPosition[] = [];
  /** The block under the pointer, whose break-to-be is drawn; null for none. */
  private guide: number | null = null;
  /** Ends a refresh still running when the dialog closes: nobody is waiting for it. */
  private readonly refreshing = new AbortController();
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
    this.setTitle(this.host.passage ? words.titlePassage : words.title);

    const body = this.contentEl.createDiv({ cls: "schreibstube-print-dialog-body" });
    const controls = body.createDiv({ cls: "schreibstube-print-dialog-controls" });
    const preview = body.createDiv({ cls: "schreibstube-print-dialog-preview" });

    this.renderControls(controls);

    this.statusEl = preview.createDiv({ cls: "schreibstube-print-dialog-status" });
    this.pagesEl = preview.createDiv({ cls: "schreibstube-print-dialog-pages" });
    this.warningsEl = preview.createDiv({ cls: "schreibstube-print-dialog-warnings" });
    this.pagesEl.addEventListener("click", (event) => {
      this.pointed(event);
    });
    this.pagesEl.addEventListener("mousemove", (event) => {
      this.hovered(event);
    });
    this.pagesEl.addEventListener("mouseleave", () => {
      this.showGuide(null);
    });

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

    this.showForTemplate();
    void this.refreshMargin();
    void this.refreshFace();
    this.changed();
  }

  override onClose(): void {
    this.closed = true;
    void this.shown?.close();
    this.shown = null;
    this.refreshing.abort();
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
        this.showForTemplate();
        void this.refreshMargin();
        void this.refreshFace();
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

    // Hidden until the layout is known to read it: a choice that changes
    // nothing on the page is worse than no choice.
    this.faceSetting = new Setting(el).setName(words.textFace).addDropdown((dropdown) => {
      dropdown.addOption("mono", words.textFaceMono);
      dropdown.addOption("sans", words.textFaceSans);
      dropdown.setValue(this.options.monospace ? "mono" : "sans").onChange((value) => {
        this.options = { ...this.options, monospace: value === "mono" };
        this.changed();
      });
    });
    this.faceSetting.settingEl.toggle(false);

    this.formatSetting = new Setting(el).setName(words.format).addDropdown((dropdown) => {
      for (const format of SLIDE_FORMATS) dropdown.addOption(format, words.formats[format]);
      dropdown.setValue(this.options.format).onChange((value) => {
        this.options = { ...this.options, format: value as SlideFormat };
        this.changed();
      });
    });

    this.alignSetting = new Setting(el).setName(words.align).addDropdown((dropdown) => {
      for (const align of SLIDE_ALIGNS) dropdown.addOption(align, words.aligns[align]);
      dropdown.setValue(this.options.align).onChange((value) => {
        this.options = { ...this.options, align: value as SlideAlign };
        this.changed();
      });
    });

    this.notesSetting = new Setting(el)
      .setName(words.speakerNotes)
      .setDesc(words.speakerNotesDesc)
      .addToggle((toggle) => {
        toggle.setValue(this.options.speakerNotes).onChange((value) => {
          this.options = { ...this.options, speakerNotes: value };
          this.changed();
        });
      });

    this.breakSetting = new Setting(el).setName(words.pageBreaks).addToggle((toggle) => {
      this.breakToggle = toggle;
      toggle.setValue(this.options.hrIsPageBreak).onChange((value) => {
        if (value === this.options.hrIsPageBreak) return;
        this.options = { ...this.options, hrIsPageBreak: value };
        this.changed();
      });
    });

    this.clickBreakSetting = new Setting(el).setDesc(words.breakHint);
    this.showBreakCount();

    new Setting(el).setName(words.frontmatter).addToggle((toggle) => {
      toggle.setValue(this.options.frontmatter).onChange((value) => {
        this.options = { ...this.options, frontmatter: value };
        this.changed();
      });
    });

    this.renderPythia(el);

    if (!this.host.hasSlideshows) return;
    new Setting(el).setName(words.slideshows).addDropdown((dropdown) => {
      for (const mode of SLIDESHOW_PRINT_MODES) dropdown.addOption(mode, words.slideshow[mode]);
      dropdown.setValue(this.options.slideshows).onChange((value) => {
        this.options = { ...this.options, slideshows: value as SlideshowPrintMode };
        this.changed();
      });
    });
  }

  /**
   * A deck has a format, an alignment and speaker notes and no page breaks —
   * a rule starts a slide — so the dialog offers the first three and not the
   * last for a slide template, and the reverse for every other.
   */
  private showForTemplate(): void {
    const slides = this.options.template.slides;
    this.formatSetting?.settingEl.toggle(slides);
    this.alignSetting?.settingEl.toggle(slides);
    this.notesSetting?.settingEl.toggle(slides);
    this.breakSetting?.settingEl.toggle(!slides);
    this.clickBreakSetting?.settingEl.toggle(!slides);
    this.pagesEl.toggleClass("is-breakable", !slides);
  }

  /**
   * Pythia's two controls: the footnotes, a choice like any other, and the
   * refresh, which is a button rather than a choice. It asks a model for new
   * summaries, which costs money and takes seconds, so it runs once, when it
   * is pressed — a toggle would run it again with every preview, or print
   * something other than what the preview showed.
   */
  private renderPythia(el: HTMLElement): void {
    const pythia = this.host.pythia;
    if (!pythia) return;
    const words = t().print.dialog;
    new Setting(el)
      .setName(words.pythiaFootnotes)
      .setDesc(words.pythiaLinks(pythia.inspection.links))
      .addToggle((toggle) => {
        toggle.setValue(this.options.pythiaFootnotes).onChange((value) => {
          // Pythia's copy is another text than the note's, so the breaks set
          // on one are not known to stand where they were on the other.
          this.options = { ...this.options, pythiaFootnotes: value, breaksBefore: [] };
          this.showBreakCount();
          this.changed();
        });
      });
    this.pythiaSetting = new Setting(el);
    this.showPythiaCounts(pythia.inspection);
  }

  /** The refresh button for these counts, or nothing when there is nothing to write. */
  private showPythiaCounts(counts: PythiaInspection): void {
    const setting = this.pythiaSetting;
    const pythia = this.host.pythia;
    if (!setting || !pythia) return;
    setting.controlEl.empty();
    const todo = counts.outdated + counts.missing;
    setting.settingEl.toggle(todo > 0);
    if (todo === 0) return;
    setting.addButton((button) =>
      button
        .setButtonText(t().print.dialog.pythiaUpdate(counts.outdated, counts.missing))
        .onClick(() => {
          button.setDisabled(true);
          void this.refreshPythia(pythia);
        })
    );
  }

  private async refreshPythia(pythia: PythiaPrintHost): Promise<void> {
    const words = t().print.dialog;
    const signal = this.refreshing.signal;
    try {
      const result = await pythia.refresh(signal, (done, total) => {
        if (!this.closed) this.statusEl.setText(words.pythiaUpdating(done, total));
      });
      if (this.closed) return;
      new Notice(words.pythiaUpdated(result.refreshed, result.failed));
    } catch (error) {
      if (this.closed) return;
      new Notice(words.pythiaUpdateFailed(error instanceof Error ? error.message : String(error)));
    }
    // What Pythia holds now, whatever the refresh managed: the button follows
    // it, and the preview is set again with the new summaries.
    const counts = pythia.inspect();
    if (counts) this.showPythiaCounts(counts);
    else this.pythiaSetting?.settingEl.toggle(false);
    // New summaries are new text: the breaks set on the old are let go.
    this.options = { ...this.options, breaksBefore: [] };
    this.showBreakCount();
    this.changed();
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

  /** Offer the text face only for a template whose layout reads it. */
  private async refreshFace(): Promise<void> {
    const template = this.options.template;
    let reads = false;
    try {
      reads = await this.host.readsMonospace(template);
    } catch {
      // A template that cannot be read says so in the preview; a choice it
      // might ignore is left out rather than guessed at.
    }
    if (this.closed || this.options.template !== template) return;
    this.faceSetting?.settingEl.toggle(reads);
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
      const next = await PdfPreview.open(prepared.pdf, this.pagesEl, width, stale);
      if (!next) return;
      if (stale()) {
        void next.close();
        return;
      }
      void this.shown?.close();
      this.shown = next;
      this.blocks = prepared.blocks;
      this.drawMarks();

      this.ready = { generation, prepared };
      this.pagesEl.removeClass("is-stale");
      this.statusEl.setText(words.pages(next.pages));
      this.warningsEl.empty();
      for (const warning of prepared.warnings) this.warningsEl.createDiv({ text: warning });
    } catch (error) {
      if (stale()) return;
      this.ready = null;
      void this.shown?.close();
      this.shown = null;
      this.blocks = [];
      this.pagesEl.empty();
      this.warningsEl.empty();
      this.statusEl.addClass("is-error");
      this.statusEl.setText(words.failed(error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * A click on a page: a break before the block it lands in, or none where
   * there was one. A slide starts its own page, so a deck takes none.
   */
  private pointed(event: MouseEvent): void {
    const block = this.blockUnder(event);
    if (block === null) return;
    const breaks = toggleBreak(this.options.breaksBefore, block);
    if (breaks.join() === this.options.breaksBefore.join()) return;
    this.options = { ...this.options, breaksBefore: breaks };
    this.showBreakCount();
    this.changed();
  }

  private hovered(event: MouseEvent): void {
    const block = this.blockUnder(event);
    // The first block starts the document's first page; there is no break to show before it.
    this.showGuide(block !== null && block > 0 ? block : null);
  }

  /**
   * The block under a pointer on the preview as it stands. None while the
   * next preview is being set: the positions are the old pages', and a
   * click answers once the new ones are there.
   */
  private blockUnder(event: MouseEvent): number | null {
    if (this.options.template.slides || !this.shown || this.pagesEl.hasClass("is-stale")) {
      return null;
    }
    const point = this.shown.pointAt(event.clientY, event.target);
    return point ? blockAt(this.blocks, point.page, point.y) : null;
  }

  private showGuide(block: number | null): void {
    if (block === this.guide) return;
    this.guide = block;
    this.drawMarks();
  }

  /** The breaks set, each at the top of the block it moved, and the one the pointer would set. */
  private drawMarks(): void {
    if (!this.shown) return;
    const words = t().print.dialog;
    const breaks = this.options.breaksBefore;
    const marks: PreviewMark[] = breakMarks(this.blocks, breaks).map((position) => ({
      page: position.page,
      y: position.y,
      kind: "break",
      label: words.breakSet
    }));
    const start = this.guide === null ? null : blockStart(this.blocks, this.guide);
    if (start && !breaks.includes(start.block)) {
      marks.push({ page: start.page, y: start.y, kind: "guide", label: words.breakHere });
    }
    this.shown.showMarks(marks);
  }

  /** The button that takes every break away, while there are any. */
  private showBreakCount(): void {
    const setting = this.clickBreakSetting;
    if (!setting) return;
    setting.controlEl.empty();
    const count = this.options.breaksBefore.length;
    if (count === 0) return;
    setting.addButton((button) =>
      button.setButtonText(t().print.dialog.breaksClear(count)).onClick(() => {
        this.options = { ...this.options, breaksBefore: [] };
        this.showBreakCount();
        this.changed();
      })
    );
  }

  private submit(): void {
    const ready = this.ready?.generation === this.generation ? this.ready.prepared : null;
    // Closed only once the print is taken: a refusal with the dialog gone
    // would take the options a person had just chosen with it.
    if (this.host.print(this.options, ready).accepted) this.close();
  }
}
