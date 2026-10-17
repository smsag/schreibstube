import { Menu, setIcon, setTooltip } from "obsidian";
import { t } from "../i18n";
import { collapsedCrumbs, sectionPosition, siblingsOf } from "../services/heading-tree";
import type { HeadingEntry, HeadingIndex } from "../types";
import { isNodeLike } from "../services/workspace-internals";

export interface OverlayRenderInput {
  ancestorStack: HeadingEntry[];
  /** The note's headings, for the sections beside each crumb and the position. */
  headingIndex: HeadingIndex;
}

/**
 * The heading stack as one line above the note: the path to the section
 * being read, each crumb opening the sections beside it, and where the
 * section stands among its siblings.
 *
 * One line of fixed height, so it covers the same strip of text however deep
 * the section is, and the page under it does not jump as the reader scrolls
 * from one depth to another. A path too long for the width folds its middle
 * into "…", which opens the folded headings.
 */
export class OverlayController {
  private container: HTMLElement;
  private crumbsEl: HTMLElement;
  private positionEl: HTMLElement;
  private parent: HTMLElement;
  private onNavigate: (lineNumber: number) => void;
  private input: OverlayRenderInput = { ancestorStack: [], headingIndex: [] };
  private resizeObserver: ResizeObserver | null = null;

  constructor(parent: HTMLElement, onNavigate: (lineNumber: number) => void) {
    this.parent = parent;
    this.onNavigate = onNavigate;
    this.parent.classList.add("schreibstube-overlay-host");

    const doc = parent.ownerDocument;
    this.container = doc.createElement("div");
    this.container.classList.add("schreibstube-overlay");
    this.crumbsEl = doc.createElement("nav");
    this.crumbsEl.classList.add("schreibstube-overlay-crumbs");
    this.crumbsEl.setAttribute("aria-label", t().overlay.label);
    this.positionEl = doc.createElement("span");
    this.positionEl.classList.add("schreibstube-overlay-position");
    this.container.append(this.crumbsEl, this.positionEl);
    parent.insertBefore(this.container, parent.firstChild);

    // A press on the bar must not take the focus or the cursor from the text.
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    // A pane made narrower or wider has room for fewer or more crumbs.
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer) {
      this.resizeObserver = new Observer(() => this.drawCrumbs());
      this.resizeObserver.observe(this.container);
    }
  }

  render(input: OverlayRenderInput): void {
    this.input = input;
    const stack = input.ancestorStack;
    this.container.classList.toggle("is-hidden", stack.length === 0);
    if (stack.length === 0) {
      this.crumbsEl.replaceChildren();
      this.positionEl.textContent = "";
      return;
    }

    const current = stack[stack.length - 1];
    const position = current ? sectionPosition(input.headingIndex, current) : null;
    this.positionEl.textContent = position ? `§ ${position.position}/${position.count}` : "";
    if (position)
      setTooltip(this.positionEl, t().overlay.position(position.position, position.count));
    this.drawCrumbs();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.remove();
    this.parent.classList.remove("schreibstube-overlay-host");
  }

  contains(target: EventTarget | null): boolean {
    return isNodeLike(target) && this.container.contains(target);
  }

  /** Draw the path, folding one more crumb at a time until it fits. */
  private drawCrumbs(): void {
    const count = this.input.ancestorStack.length;
    for (let collapse = 0; collapse <= Math.max(0, count - 2); collapse += 1) {
      this.drawPath(collapse);
      if (this.crumbsEl.scrollWidth <= this.crumbsEl.clientWidth) return;
    }
  }

  private drawPath(collapse: number): void {
    const stack = this.input.ancestorStack;
    const { shown, hidden } = collapsedCrumbs(stack.length, collapse);
    const doc = this.crumbsEl.ownerDocument;
    const parts: HTMLElement[] = [];

    const separator = (): HTMLElement => {
      const el = doc.createElement("span");
      el.classList.add("schreibstube-overlay-separator");
      el.setAttribute("aria-hidden", "true");
      setIcon(el, "chevron-right");
      return el;
    };

    for (const [position, i] of shown.entries()) {
      const entry = stack[i];
      if (!entry) continue;
      if (position > 0) parts.push(separator());
      parts.push(this.crumb(entry, i === stack.length - 1));
      if (i === 0 && hidden.length > 0) {
        parts.push(separator(), this.moreButton(hidden.flatMap((h) => stack[h] ?? [])));
      }
    }
    this.crumbsEl.replaceChildren(...parts);
  }

  private crumb(entry: HeadingEntry, isCurrent: boolean): HTMLElement {
    const button = this.crumbsEl.ownerDocument.createElement("button");
    button.classList.add("schreibstube-overlay-crumb", isCurrent ? "is-current" : "is-ancestor");
    button.dataset.lineNumber = String(entry.lineNumber);
    if (isCurrent) button.setAttribute("aria-current", "location");
    const text = button.ownerDocument.createElement("span");
    text.classList.add("schreibstube-overlay-crumb-text");
    text.textContent = entry.text;
    const chevron = button.ownerDocument.createElement("span");
    chevron.classList.add("schreibstube-overlay-crumb-chevron");
    chevron.setAttribute("aria-hidden", "true");
    setIcon(chevron, "chevron-down");
    button.append(text, chevron);
    setTooltip(button, t().overlay.siblings);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openMenu(button, siblingsOf(this.input.headingIndex, entry), entry);
    });
    return button;
  }

  private moreButton(folded: HeadingEntry[]): HTMLElement {
    const button = this.crumbsEl.ownerDocument.createElement("button");
    button.classList.add("schreibstube-overlay-crumb", "schreibstube-overlay-more");
    button.textContent = "…";
    setTooltip(button, t().overlay.more);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openMenu(button, folded, null);
    });
    return button;
  }

  private openMenu(
    anchor: HTMLElement,
    headings: HeadingEntry[],
    current: HeadingEntry | null
  ): void {
    const menu = new Menu();
    for (const heading of headings) {
      menu.addItem((item) =>
        item
          .setTitle(heading.text)
          .setChecked(heading.lineNumber === current?.lineNumber)
          .onClick(() => this.onNavigate(heading.lineNumber))
      );
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
}
