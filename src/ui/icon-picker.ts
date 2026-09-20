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

export class IconPickerModal extends Modal {
  private query = "";
  private grid: HTMLElement | null = null;

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
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderGrid();
    });

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
    this.contentEl.empty();
  }
}
