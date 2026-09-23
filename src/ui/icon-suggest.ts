import {
  EditorSuggest,
  type App,
  type Editor,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type TFile
} from "obsidian";
import { completedShortcode, rankIcons, shortcodeTrigger } from "../services/icon-shortcode";
import { allIconNames, applyIcon, installIconFont } from "./icon-font";

/** How many icons the popup lists. A screen's worth; the query narrows it. */
const SUGGESTION_LIMIT = 12;

/**
 * The picker that opens on `:fo` and inserts `:folder: `.
 *
 * Obsidian's own mechanism for `[[` and `#`, given a trigger of ours. When a
 * colon starts one is decided in `shortcodeTrigger` — after a word it never
 * does, so a colon in prose stays a colon — and the ranking in `rankIcons`;
 * this class only asks the editor where the cursor is and draws the rows.
 */
export class IconShortcodeSuggest extends EditorSuggest<string> {
  private readonly names = allIconNames();

  constructor(
    app: App,
    private readonly enabled: () => boolean
  ) {
    super(app);
    this.limit = SUGGESTION_LIMIT;
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null
  ): EditorSuggestTriggerInfo | null {
    if (!this.enabled()) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const trigger = shortcodeTrigger(before);
    if (!trigger) return null;
    return {
      start: { line: cursor.line, ch: trigger.from },
      end: cursor,
      query: trigger.query
    };
  }

  getSuggestions(context: EditorSuggestContext): string[] {
    return rankIcons(this.names, context.query, SUGGESTION_LIMIT);
  }

  renderSuggestion(name: string, el: HTMLElement): void {
    installIconFont(el.doc);
    el.addClass("schreibstube-icon-suggestion");
    applyIcon(el.createSpan(), name);
    el.createSpan({ text: name });
  }

  selectSuggestion(name: string): void {
    const context = this.context;
    if (!context) return;
    context.editor.replaceRange(completedShortcode(name), context.start, context.end);
    this.close();
  }
}
