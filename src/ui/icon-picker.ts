/**
 * Choosing an icon.
 *
 * A grid, a search box, and a way out: the picker is opened often and briefly,
 * so it opens on the whole set rather than on an empty search, and the first
 * keystroke filters. The current icon is marked so "change" and "remove" are
 * one dialogue rather than two menu entries.
 */
import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import { applyIcon, installIconFont, searchIcons } from "./icon-font";

/**
 * How long the search waits after a keystroke before the grid is redrawn.
 *
 * The grid is a few hundred buttons, and drawing it for every letter of a
 * word typed quickly is what a person feels as the field lagging behind the
 * keyboard. Short enough to feel immediate on the pause between letters.
 */
const SEARCH_DEBOUNCE_MS = 100;

export class IconPickerModal extends Modal {
  private query = "";
  private grid: HTMLElement | null = null;
  private searchTimer: number | null = null;

  constructor(
    app: App,
    private readonly current: string | undefined,
    private readonly onChoose: (icon: string | null) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("schreibstube-icon-picker");
    installIconFont(contentEl.doc);

    contentEl.createEl("h3", { text: t().explorer.icons.title });

    const search = contentEl.createEl("input", {
      type: "search",
      cls: "schreibstube-icon-search",
      attr: { placeholder: t().explorer.icons.search, "aria-label": t().explorer.icons.search }
    });
    search.addEventListener("input", (event) => {
      // Mid-composition the field holds a half-made character; the finished
      // one arrives with `compositionend`.
      if ((event as InputEvent).isComposing) return;
      this.scheduleSearch(search.value);
    });
    search.addEventListener("compositionend", () => this.scheduleSearch(search.value));

    this.grid = contentEl.createDiv({ cls: "schreibstube-icon-groups" });
    this.renderGrid();

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(t().explorer.icons.clear)
          .setDisabled(this.current === undefined)
          .onClick(() => {
            this.close();
            this.onChoose(null);
          })
      )
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()));

    window.setTimeout(() => search.focus(), 0);
  }

  private scheduleSearch(query: string): void {
    const win = this.contentEl.win;
    if (this.searchTimer !== null) win.clearTimeout(this.searchTimer);
    this.searchTimer = win.setTimeout(() => {
      this.searchTimer = null;
      this.query = query;
      this.renderGrid();
    }, SEARCH_DEBOUNCE_MS);
  }

  private renderGrid(): void {
    const host = this.grid;
    if (!host) return;

    host.empty();
    const groups = searchIcons(this.query);

    if (groups.length === 0) {
      host.createEl("p", { text: t().explorer.icons.none });
      return;
    }

    const labels = t().explorer.icons.groups as unknown as Record<string, string>;

    for (const group of groups) {
      host.createEl("h4", { text: labels[group.id] ?? group.id });
      const row = host.createDiv({ cls: "schreibstube-icon-grid" });

      for (const icon of group.icons) {
        const button = row.createEl("button", {
          cls: "sb sb-seg schreibstube-icon-choice",
          attr: { type: "button", "aria-label": icon, title: icon }
        });
        if (icon === this.current) button.addClass("active");

        applyIcon(button.createSpan(), icon);
        button.addEventListener("click", () => {
          this.close();
          this.onChoose(icon);
        });
      }
    }
  }

  override onClose(): void {
    if (this.searchTimer !== null) this.contentEl.win.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.contentEl.empty();
  }
}
