import {
  type App,
  type MarkdownPostProcessorContext,
  MarkdownView,
  type Plugin,
  TFile
} from "obsidian";
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

/**
 * The ```schreibstube-index``` block: the note's headings to the depth the
 * block names, wherever it stands, kept current as the note changes. A press
 * on an entry goes to its section; a press on the heading line folds the list
 * and writes that into the block, so the note remembers it.
 */
export function registerNoteIndex(plugin: Plugin): void {
  plugin.registerMarkdownCodeBlockProcessor(NOTE_INDEX_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new NoteIndex(plugin.app, el, ctx, parseNoteIndexOptions(source)));
  });
}

class NoteIndex extends LiveNoteBlock {
  /** What was drawn last, so typing in a paragraph does not redraw the list. */
  private drawn = "";

  constructor(
    app: App,
    containerEl: HTMLElement,
    private readonly ctx: MarkdownPostProcessorContext,
    private readonly options: NoteIndexOptions
  ) {
    super(app, containerEl, ctx.sourcePath);
  }

  protected draw(content: string): void {
    const deadline = performance.now() + INDEX_BUDGET_MS;
    const plan = buildNoteIndex(content, this.options.depth, () => performance.now() > deadline);

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
      jump: (line) => this.jump(line, plan)
    });
  }

  /**
   * Into the open editor when there is one, so the change joins its undo
   * history and cannot race a save of the buffer; into the file otherwise.
   * Either way the block is found again first, and nothing is written if the
   * note moved under the press.
   */
  private async writeCollapsed(collapsed: boolean): Promise<void> {
    const section = this.ctx.getSectionInfo(this.containerEl);
    if (!section) return;

    const view = this.noteView();
    if (view && view.getMode() === "source") {
      const edit = collapseEdit(
        view.editor.getValue(),
        section.lineStart,
        section.lineEnd,
        collapsed
      );
      if (edit) {
        view.editor.replaceRange(
          edit.text,
          { line: edit.fromLine, ch: 0 },
          { line: edit.toLine, ch: 0 }
        );
      }
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (content) => {
      const edit = collapseEdit(content, section.lineStart, section.lineEnd, collapsed);
      return edit ? applyLineEdit(content, edit) : content;
    });
  }

  /**
   * To the heading's line, in the view the block is drawn in. A block in an
   * embed or a hover belongs to a note that is not the one on screen, so
   * that note is opened at the line instead.
   */
  private jump(line: number, plan: NoteIndexPlan): void {
    if (plan.kind !== "entries") return;
    const view = this.hostView();
    if (!view || view.file?.path !== this.sourcePath) {
      void this.app.workspace.openLinkText(this.sourcePath, "", false, { eState: { line } });
      return;
    }

    if (view.getMode() === "preview") {
      view.previewMode.applyScroll(line);
      return;
    }
    view.editor.setCursor(line, 0);
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    view.editor.focus();
  }

  private hostView(): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.containerEl.contains(this.containerEl)) return view;
    }
    return null;
  }
}
