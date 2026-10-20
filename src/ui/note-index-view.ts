/**
 * The ```schreibstube-index``` block as it stands in the note: a heading line
 * in the task ribbon's type, and under it the note's headings, each one a way
 * to its section.
 *
 * The heading line folds the whole list. What the block says and which
 * headings it lists are decided in `services/note-index.ts`; this file only
 * draws the answer and reports the presses.
 */
import { t } from "../i18n";
import type { NoteIndexOptions, NoteIndexPlan } from "../services/note-index";
import { applyObsidianIcon } from "./icon-font";
import { appendWithStrongFigures } from "./strong-figures";

export const NOTE_INDEX_CLASS = "schreibstube-note-index";

export interface NoteIndexActions {
  /** The heading line was pressed: the list should now be folded, or not. */
  toggle(collapsed: boolean): void;
  /** An entry was pressed: the reader wants the section at this line. */
  jump(line: number): void;
  /**
   * Puts a heading's words into its entry. The heading's `:folder:` should be
   * the glyph here as it is in the heading, and drawing it is the icon
   * processor's; plain text when this is not given.
   */
  drawText?(el: HTMLElement, text: string): void;
}

export function drawNoteIndex(
  container: HTMLElement,
  plan: NoteIndexPlan,
  options: NoteIndexOptions,
  actions: NoteIndexActions
): void {
  container.empty();
  container.addClass(NOTE_INDEX_CLASS);
  const words = t().noteIndex;

  if (plan.kind !== "entries") {
    container.createDiv({ cls: `${NOTE_INDEX_CLASS}-line`, text: message(plan, options.depth) });
  } else {
    drawList(container, plan.entries, options.collapsed, actions);
  }

  if (options.unreadableLine !== null) {
    container.createDiv({
      cls: `${NOTE_INDEX_CLASS}-hint`,
      text: words.unreadable(options.unreadableLine)
    });
  }
}

function message(plan: Exclude<NoteIndexPlan, { kind: "entries" }>, depth: number): string {
  const words = t().noteIndex;
  switch (plan.kind) {
    case "empty":
      return words.empty(depth);
    case "too-long":
      return words.tooLong(plan.count, depth, plan.fits);
    case "too-slow":
      return words.tooSlow;
  }
}

function drawList(
  container: HTMLElement,
  entries: Extract<NoteIndexPlan, { kind: "entries" }>["entries"],
  collapsed: boolean,
  actions: NoteIndexActions
): void {
  const words = t().noteIndex;
  const head = container.createDiv({
    cls: `${NOTE_INDEX_CLASS}-line`,
    attr: {
      role: "button",
      tabindex: "0",
      "aria-expanded": String(!collapsed),
      "aria-label": collapsed ? words.expand : words.collapse
    }
  });
  container.toggleClass("is-collapsed", collapsed);
  // Obsidian's own fold arrow, with its own class, so it is the one beside a
  // folded list or heading in whatever theme is on. One glyph for both states:
  // the stylesheet turns it, as Obsidian turns its own.
  applyObsidianIcon(
    head.createSpan({ cls: `${NOTE_INDEX_CLASS}-chevron collapse-icon` }),
    ["right-triangle"],
    "chevron-down"
  );
  appendWithStrongFigures(head.createSpan(), words.summary(entries.length));

  const list = container.createEl("ul", { cls: `${NOTE_INDEX_CLASS}-list` });
  list.toggle(!collapsed);
  for (const entry of entries) {
    const item = list.createEl("li", { cls: `${NOTE_INDEX_CLASS}-entry` });
    item.style.setProperty("--schreibstube-index-indent", String(entry.indent));
    const link = item.createEl("a", {
      cls: `${NOTE_INDEX_CLASS}-link`,
      attr: { href: "#", "data-line": String(entry.line) }
    });
    if (actions.drawText) actions.drawText(link, entry.text);
    else link.setText(entry.text);
    pressable(link, () => actions.jump(entry.line));
  }

  pressable(head, () => {
    const next = !container.hasClass("is-collapsed");
    // Folded on screen at once; the block's own text follows, and the
    // re-render it causes draws the same thing.
    container.toggleClass("is-collapsed", next);
    list.toggle(!next);
    head.setAttribute("aria-expanded", String(!next));
    head.setAttribute("aria-label", next ? words.expand : words.collapse);
    actions.toggle(next);
  });
}

/**
 * A press of the mouse, Enter or Space. The event goes no further: in Live
 * Preview a click that reaches the block's widget opens its source, and a
 * mousedown that reaches the editor hands it the focus, which on a phone
 * opens the keyboard.
 */
function pressable(el: HTMLElement, press: () => void): void {
  el.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    press();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    press();
  });
}
