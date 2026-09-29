import type { HeadingEntry, HeadingLevel } from "../types";

export interface OverlayRenderInput {
  ancestorStack: HeadingEntry[];
}

interface RowEvent {
  lineNumber: number;
  level: HeadingLevel;
  kind: "ancestor";
  source: "click";
}

export class OverlayController {
  private container: HTMLElement;
  private listEl: HTMLUListElement;
  private parent: HTMLElement;
  private onRowEvent: (event: RowEvent) => void;

  constructor(parent: HTMLElement, onRowEvent: (event: RowEvent) => void) {
    this.parent = parent;
    this.parent.classList.add("schreibstube-overlay-host");

    this.container = document.createElement("div");
    this.container.classList.add("schreibstube-overlay");

    if (parent.firstChild) {
      parent.insertBefore(this.container, parent.firstChild);
    } else {
      parent.appendChild(this.container);
    }

    this.listEl = this.container.createEl("ul", { cls: "schreibstube-overlay-list" });
    this.onRowEvent = onRowEvent;

    this.container.addEventListener("pointerdown", this.handlePointerDown);
    this.listEl.addEventListener("click", this.handleClick);
    this.listEl.addEventListener("keydown", this.handleKey);
  }

  render(input: OverlayRenderInput): void {
    this.listEl.empty();

    if (input.ancestorStack.length === 0) {
      this.container.classList.add("is-hidden");
      return;
    }

    this.container.classList.remove("is-hidden");

    const lastIndex = input.ancestorStack.length - 1;

    for (const [i, entry] of input.ancestorStack.entries()) {
      const isLast = i === lastIndex;

      // A row is a control — pressing it goes to the heading — and says so, so
      // a keyboard reaches it as the pointer does.
      const row = this.listEl.createEl("li", {
        cls: `schreibstube-overlay-row schreibstube-overlay-row-ancestor ${isLast ? "is-current" : "is-ancestor"}`,
        attr: { role: "button", tabindex: "0" }
      });
      row.dataset.lineNumber = String(entry.lineNumber);
      row.dataset.level = String(entry.level);

      const connector = i === 0 ? "" : "   ".repeat(i - 1) + "└─ ";
      if (connector) {
        row.createSpan({ cls: "schreibstube-overlay-connector", text: connector });
      }
      row.createSpan({ cls: "schreibstube-overlay-text", text: entry.text });
    }
  }

  destroy(): void {
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.listEl.removeEventListener("click", this.handleClick);
    this.listEl.removeEventListener("keydown", this.handleKey);
    this.container.remove();
    this.parent.classList.remove("schreibstube-overlay-host");
  }

  contains(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) {
      return false;
    }

    return this.container.contains(target);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  private handleClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.pressRow(event.target);
  };

  private handleKey = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    this.pressRow(event.target);
  };

  private pressRow(target: EventTarget | null): void {
    const row =
      target instanceof HTMLElement
        ? (target.closest(".schreibstube-overlay-row") as HTMLElement | null)
        : null;
    if (!row) {
      return;
    }

    const lineNumber = Number(row.dataset.lineNumber);
    const level = Number(row.dataset.level) as HeadingLevel;
    if (Number.isNaN(lineNumber) || Number.isNaN(level)) {
      return;
    }

    this.onRowEvent({ lineNumber, level, kind: "ancestor", source: "click" });
  }
}
