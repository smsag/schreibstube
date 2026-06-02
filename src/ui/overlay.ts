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
  private onRowEvent: (event: RowEvent) => void;
  private onMouseLeave: () => void;

  constructor(
    parent: HTMLElement,
    onRowEvent: (event: RowEvent) => void,
    onMouseLeave: () => void
  ) {
    this.container = parent.createDiv({ cls: "schreibstube-overlay" });
    this.listEl = this.container.createEl("ul", { cls: "schreibstube-overlay-list" });
    this.onRowEvent = onRowEvent;
    this.onMouseLeave = onMouseLeave;

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

    for (const entry of input.ancestorStack) {
      const row = this.listEl.createEl("li", {
        cls: "schreibstube-overlay-row schreibstube-overlay-row-ancestor"
      });
      row.dataset.lineNumber = String(entry.lineNumber);
      row.dataset.level = String(entry.level);
      row.dataset.kind = "ancestor";
      row.dataset.text = entry.text;

      const prefix = "#".repeat(entry.level);
      row.setText(`${prefix} ${entry.text}`);

      if (input.expandedLevel === entry.level && input.siblings.length > 0) {
        row.addClass("is-expanded");

        const siblingsContainer = this.listEl.createEl("li", {
          cls: "schreibstube-overlay-siblings-wrap"
        });

        const siblingsList = siblingsContainer.createEl("ul", {
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

          const siblingPrefix = "#".repeat(sibling.level);
          siblingRow.setText(`${siblingPrefix} ${sibling.text}`);

          if (sibling.lineNumber === entry.lineNumber) {
            siblingRow.addClass("is-current");
            siblingRow.scrollIntoView({ block: "nearest" });
          }
        }
      }
    }
  }

  destroy(): void {
    this.listEl.removeEventListener("click", this.handleClick);
    this.listEl.removeEventListener("mouseover", this.handleHover);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    this.container.remove();
  }

  contains(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) {
      return false;
    }

    return this.container.contains(target);
  }

  private handleClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest(".schreibstube-overlay-row") as HTMLElement | null;

    if (!row) {
      return;
    }

    const lineNumber = Number(row.dataset.lineNumber);
    const level = Number(row.dataset.level) as HeadingLevel;
    const kind = (row.dataset.kind ?? "ancestor") as "ancestor" | "sibling";

    if (Number.isNaN(lineNumber) || Number.isNaN(level)) {
      return;
    }

    this.onRowEvent({
      lineNumber,
      level,
      kind,
      source: "click"
    });
  };

  private handleHover = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest(
      ".schreibstube-overlay-row-ancestor"
    ) as HTMLElement | null;

    if (!row) {
      return;
    }

    const lineNumber = Number(row.dataset.lineNumber);
    const level = Number(row.dataset.level) as HeadingLevel;

    if (Number.isNaN(lineNumber) || Number.isNaN(level)) {
      return;
    }

    this.onRowEvent({
      lineNumber,
      level,
      kind: "ancestor",
      source: "hover"
    });
  };

  private handleMouseLeave = (): void => {
    this.onMouseLeave();
  };
}
