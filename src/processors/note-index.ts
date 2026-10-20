import { type App, type MarkdownPostProcessorContext, type Plugin, TFile } from "obsidian";
import {
  applyLineEdit,
  buildNoteIndex,
  collapseEdit,
  INDEX_BUDGET_MS,
  NOTE_INDEX_LANGUAGE,
  type NoteIndexOptions,
  type NoteIndexPlan,
  parseNoteIndexOptions
} from "../services/note-index";
import { drawNoteIndex } from "../ui/note-index-view";
import { LiveNoteBlock } from "./live-note-block";
import { MAX_LIVE_CHARS } from "./live-limits";

/**
 * The ```schreibstube-index``` block: the note's headings to the depth the
 * block names, wherever it stands, kept current as the note changes. A press
 * on an entry goes to its section; a press on the heading line folds the list
 * and writes that into the block, so the note remembers it.
 */
export function registerNoteIndex(
  plugin: Plugin,
  drawText?: (el: HTMLElement, text: string) => void
): void {
  plugin.registerMarkdownCodeBlockProcessor(NOTE_INDEX_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new NoteIndex(plugin.app, el, ctx, source, drawText));
  });
}

class NoteIndex extends LiveNoteBlock {
  private readonly options: NoteIndexOptions;
  /** What was drawn last, so typing in a paragraph does not redraw the list. */
  private drawn = "";
  /**
   * The length of a note whose scan ran out of time. A note at least that
   * long is not scanned again on every keystroke, each one holding the editor
   * for the whole budget to reach the same answer; one that shrank is.
   */
  private slowAt: number | null = null;
  /** Where the block stands after a fold this instance wrote, until Obsidian renders it anew. */
  private written: { lineStart: number; lineEnd: number } | null = null;

  constructor(
    app: App,
    containerEl: HTMLElement,
    private readonly ctx: MarkdownPostProcessorContext,
    /** The block's text as the note holds it now, which a press must find again. */
    private source: string,
    private readonly drawText?: (el: HTMLElement, text: string) => void
  ) {
    super(app, containerEl, ctx.sourcePath);
    this.options = parseNoteIndexOptions(source);
  }

  protected draw(content: string): void {
    const plan = this.plan(content);

    const signature = JSON.stringify(plan);
    if (signature === this.drawn) return;
    this.drawn = signature;

    drawNoteIndex(this.containerEl, plan, this.options, {
      toggle: (collapsed) => {
        // Kept here too: a heading typed before the block's new text is
        // rendered redraws this instance, and must not unfold it again.
        this.options.collapsed = collapsed;
        void this.writeCollapsed(collapsed);
      },
      jump: (line) => this.jump(line, plan),
      ...(this.drawText ? { drawText: this.drawText } : {})
    });
  }

  private plan(content: string): NoteIndexPlan {
    // Past the live limit the note is a log or a dump, not prose being
    // written, and the other live extensions leave it alone too.
    if (content.length > MAX_LIVE_CHARS) return { kind: "too-slow" };
    if (this.slowAt !== null && content.length >= this.slowAt) return { kind: "too-slow" };

    const deadline = performance.now() + INDEX_BUDGET_MS;
    const plan = buildNoteIndex(content, this.options.depth, () => performance.now() > deadline);
    this.slowAt = plan.kind === "too-slow" ? content.length : null;
    return plan;
  }

  /**
   * Into an open editor when there is one, so the change joins its undo
   * history and cannot race a save of its buffer; into the file otherwise.
   * Either way the block is found again first, by its text, and nothing is
   * written if the note moved under the press.
   */
  private async writeCollapsed(collapsed: boolean): Promise<void> {
    const section = this.written ?? this.ctx.getSectionInfo(this.containerEl);
    if (!section) return;
    const find = (content: string) => {
      const edit = collapseEdit(
        content,
        section.lineStart,
        section.lineEnd,
        this.source,
        collapsed
      );
      if (edit) {
        this.source = edit.source;
        this.written = edit.block;
      }
      return edit;
    };

    const view = this.noteEditor();
    if (view && view.getMode() === "source") {
      const edit = find(view.editor.getValue());
      if (!edit) return;
      view.editor.replaceRange(
        edit.text,
        { line: edit.fromLine, ch: 0 },
        { line: edit.toLine, ch: 0 }
      );
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (content) => {
      const edit = find(content);
      return edit ? applyLineEdit(content, edit) : content;
    });
  }

  /**
   * To the heading's line, in the view the block is drawn in. A block in an
   * embed or a hover belongs to a note that is not the one on screen, so
   * that note is opened at the line instead.
   *
   * Only the scroll moves: the index is for finding a place, and focusing the
   * editor there put a phone's keyboard over the very section just reached.
   * The cursor stays where the writer left it, so a heading in Live Preview
   * is not opened up to its markup either.
   */
  private jump(line: number, plan: NoteIndexPlan): void {
    if (plan.kind !== "entries") return;
    const view = this.findView((candidate) => candidate.containerEl.contains(this.containerEl));
    if (!view || view.file?.path !== this.sourcePath) {
      void this.app.workspace.openLinkText(this.sourcePath, "", false, { eState: { line } });
      return;
    }

    if (view.getMode() === "preview") {
      view.previewMode.applyScroll(line);
      return;
    }
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
  }
}
