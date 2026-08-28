import type { HeadingEntry, HeadingLevel } from "../types";

export interface OverlayRenderInput {
  ancestorStack: HeadingEntry[];
  expandedLevel: HeadingLevel | null;
  siblings: HeadingEntry[];
  maxVisibleRows: number;
}

interface RowEvent {
  lineNumber: number;
  level: HeadingLevel;
  kind: "ancestor" | "sibling";
  source: "click" | "hover";
}

export class OverlayController {
  private container: HTMLElement;
  private listEl: HTMLUListElement;
  private parent: HTMLElement;
  private onRowEvent: (event: RowEvent) => void;
  private onMouseLeave: () => void;

  constructor(
    parent: HTMLElement,
    onRowEvent: (event: RowEvent) => void,
    onMouseLeave: () => void
  ) {
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
    this.onMouseLeave = onMouseLeave;

    this.container.addEventListener("pointerdown", this.handlePointerDown);
    this.listEl.addEventListener("click", this.handleClick);
    this.listEl.addEventListener("mouseover", this.handleHover);
    this.container.addEventListener("mouseleave", this.handleMouseLeave);
  }

  render(input: OverlayRenderInput): void {
    this.listEl.empty();

    if (input.ancestorStack.length === 0) {
      this.container.classList.add("is-hidden");
      return;
    }

    this.container.classList.remove("is-hidden");

    const lastIndex = input.ancestorStack.length - 1;

    for (let i = 0; i < input.ancestorStack.length; i++) {
      const entry = input.ancestorStack[i];
      const isLast = i === lastIndex;

      const row = this.listEl.createEl("li", {
        cls: `schreibstube-overlay-row schreibstube-overlay-row-ancestor ${isLast ? "is-current" : "is-ancestor"}`
      });
      row.dataset.lineNumber = String(entry.lineNumber);
      row.dataset.level = String(entry.level);
      row.dataset.kind = "ancestor";
      row.dataset.text = entry.text;

      const connector = i === 0 ? "" : "   ".repeat(i - 1) + "└─ ";
      if (connector) {
        row.createSpan({ cls: "schreibstube-overlay-connector", text: connector });
      }
      row.createSpan({ cls: "schreibstube-overlay-text", text: entry.text });

      if (input.expandedLevel === entry.level && input.siblings.length > 0) {
        row.addClass("is-expanded");

        const siblingsWrap = this.listEl.createEl("li", {
          cls: "schreibstube-overlay-siblings-wrap"
        });
        const siblingsList = siblingsWrap.createEl("ul", {
          cls: "schreibstube-overlay-siblings"
        });

        const maxRows = Math.max(3, input.maxVisibleRows);
        siblingsList.style.maxHeight = `${maxRows * 1.85}em`;

        for (const sibling of input.siblings) {
          const siblingRow = siblingsList.createEl("li", {
            cls: "schreibstube-overlay-row schreibstube-overlay-row-sibling"
          });
          siblingRow.dataset.lineNumber = String(sibling.lineNumber);
          siblingRow.dataset.level = String(sibling.level);
          siblingRow.dataset.kind = "sibling";
          siblingRow.dataset.text = sibling.text;

          siblingRow.createSpan({ cls: "schreibstube-overlay-text", text: sibling.text });

          if (sibling.lineNumber === entry.lineNumber) {
            siblingRow.addClass("is-current");
            siblingRow.scrollIntoView({ block: "nearest" });
          }
        }
      }
    }
  }

  destroy(): void {
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.listEl.removeEventListener("click", this.handleClick);
    this.listEl.removeEventListener("mouseover", this.handleHover);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
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

  private rowEventFrom(target: EventTarget | null, source: "click" | "hover"): RowEvent | null {
    const el = target as HTMLElement | null;
    const row = el?.closest(".schreibstube-overlay-row") as HTMLElement | null;
    if (!row) {
      return null;
    }

    const lineNumber = Number(row.dataset.lineNumber);
    const level = Number(row.dataset.level) as HeadingLevel;
    if (Number.isNaN(lineNumber) || Number.isNaN(level)) {
      return null;
    }

    const kind = row.dataset.kind === "sibling" ? "sibling" : "ancestor";
    return { lineNumber, level, kind, source };
  }

  private handleClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();

    const rowEvent = this.rowEventFrom(event.target, "click");
    if (rowEvent) {
      this.onRowEvent(rowEvent);
    }
  };

  private handleHover = (event: MouseEvent): void => {
    const rowEvent = this.rowEventFrom(event.target, "hover");
    if (rowEvent) {
      this.onRowEvent(rowEvent);
    }
  };

  private handleMouseLeave = (): void => {
    this.onMouseLeave();
  };
}
