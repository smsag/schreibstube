/**
 * The files opened last, above Recommended under a note: switching back to
 * what was open a minute ago is one press, without the quick switcher.
 *
 * Drawn as Recommended draws its entries — the Explorer's icon in the marker
 * column, the title as a link, the folder under it — so the two sections read
 * as one footer. No meter: the order is when, not how relevant. Three entries
 * until "show more" is pressed, so the recommendations below stay near the
 * note's end. Folding and showing more are not kept: the next note opens
 * with three, as Recommended opens unfolded.
 *
 * What to list is decided in `recent-notes`; this only draws it.
 */
import { Keymap } from "obsidian";
import { t } from "../i18n";
import { applyIcon } from "./icon-font";
import { TASK_PILL_CLASS } from "./task-count-label";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import { recentRows, selectRecent } from "../services/recent-notes";
import { isElementLike } from "../services/workspace-internals";

export interface RecentHost {
  /** Obsidian's list of the files opened last, newest first, unchecked. */
  lastOpened(): unknown;
  /** The title to show, or null for a path that names no file in the vault now. */
  titleOf(path: string): string | null;
  /** The folder holding the file; empty at the vault root. */
  folderOf(path: string): string;
  /** The icon a file wears in the Explorer. */
  glyphOf(path: string): string;
  open(path: string, where: PaneTarget): Promise<void>;
  showMenu(path: string, event: MouseEvent): void;
}

interface RecentEntry {
  path: string;
  title: string;
  folder: string;
  glyph: string;
}

export class RecentPanel {
  private source: string | null = null;
  private collapsed = false;
  private expanded = false;
  /** What the last draw showed, so a workspace event that changed nothing redraws nothing. */
  private drawn: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: RecentHost
  ) {
    root.addClass("schreibstube-recent");
  }

  /** The footer moved to another note: list from its point of view, folded to three. */
  show(path: string | null): void {
    if (path !== this.source) {
      this.collapsed = false;
      this.expanded = false;
    }
    this.source = path;
    this.draw();
  }

  /** A file was opened, renamed or deleted somewhere: read the list again. */
  refresh(): void {
    this.draw();
  }

  private entries(): RecentEntry[] {
    const titles = new Map<string, string>();
    const paths = selectRecent(this.host.lastOpened(), this.source, (path) => {
      const title = this.host.titleOf(path);
      if (title === null) return false;
      titles.set(path, title);
      return true;
    });
    return paths.map((path) => ({
      path,
      title: titles.get(path) ?? path,
      folder: this.host.folderOf(path),
      glyph: this.host.glyphOf(path)
    }));
  }

  private draw(): void {
    const entries = this.entries();
    const signature = JSON.stringify([this.collapsed, this.expanded, entries]);
    if (signature === this.drawn) return;
    this.drawn = signature;

    const root = this.root;
    const focused = root.ownerDocument.activeElement;
    const focusedKey =
      isElementLike(focused) && root.contains(focused)
        ? (focused.closest("[data-key]")?.getAttribute("data-key") ?? null)
        : null;

    root.empty();
    // Nothing opened before this note: a heading over nothing says nothing.
    root.toggleClass("is-empty", entries.length === 0);
    if (entries.length > 0) this.drawInto(root, entries);

    if (focusedKey !== null) {
      root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
    }
  }

  private drawInto(root: HTMLElement, entries: RecentEntry[]): void {
    const labels = t().explorer.recent;
    const total = entries.length;

    const section = root.createDiv({
      cls: "schreibstube-related-section",
      attr: {
        "data-key": "section",
        role: "button",
        tabindex: "0",
        "aria-expanded": String(!this.collapsed),
        "aria-label": this.collapsed ? labels.expand : labels.collapse
      }
    });
    section.toggleClass("is-collapsed", this.collapsed);
    applyIcon(
      section.createSpan({ cls: "schreibstube-related-section-chevron" }),
      this.collapsed ? "chevron-right" : "chevron-down"
    );
    section.createSpan({ cls: "schreibstube-related-section-label", text: labels.viewTitle });
    section.createSpan({ cls: "schreibstube-related-section-rule" });
    section.createSpan({
      cls: `schreibstube-related-section-count ${TASK_PILL_CLASS}`,
      text: String(total),
      attr: { "aria-label": labels.summary(total) }
    });
    pressable(section, () => {
      this.collapsed = !this.collapsed;
      this.draw();
    });
    if (this.collapsed) return;

    const { shown, hidden } = recentRows(total, this.expanded);
    // A list, not an <ol>: the order is time, which the heading already says.
    const list = root.createEl("ul", { cls: "schreibstube-related-list" });
    for (const entry of entries.slice(0, shown)) this.renderEntry(list, entry);

    if (hidden > 0 || this.expanded) {
      const toggle = root.createDiv({
        cls: "schreibstube-recent-more",
        text: hidden > 0 ? labels.more(hidden) : labels.fewer,
        attr: {
          "data-key": "more",
          role: "button",
          tabindex: "0",
          "aria-expanded": String(this.expanded)
        }
      });
      pressable(toggle, () => {
        this.expanded = !this.expanded;
        this.draw();
      });
    }
  }

  private renderEntry(list: HTMLElement, entry: RecentEntry): void {
    const el = list.createEl("li").createDiv({
      cls: "schreibstube-related-card",
      attr: { role: "link", tabindex: "0", "data-key": `file:${entry.path}`, title: entry.path }
    });
    applyIcon(el.createSpan({ cls: "schreibstube-related-glyph" }), entry.glyph);
    const text = el.createDiv({ cls: "schreibstube-related-card-text" });
    text.createDiv({ cls: "schreibstube-related-card-title", text: entry.title });
    text.createDiv({ cls: "schreibstube-related-card-meta" }).createSpan({
      cls: "schreibstube-related-card-folder",
      text: entry.folder.length > 0 ? entry.folder : t().explorer.rootFolder
    });
    pressable(el, (event) => {
      void this.host.open(entry.path, openTargetOf(Keymap.isModEvent(event)));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.host.showMenu(entry.path, event);
    });
  }
}

/**
 * Press, Enter or Space; a middle click too, which the browser reports as
 * `auxclick` and Obsidian reads as a new tab.
 */
function pressable(el: HTMLElement, run: (event: MouseEvent | KeyboardEvent) => void): void {
  el.addEventListener("click", (event) => run(event));
  el.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    run(event);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    run(event);
  });
}
