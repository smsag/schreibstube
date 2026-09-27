/**
 * "Open bookmark", from the command palette.
 *
 * The pane is the place to browse; this is the place to go straight there. The
 * list keeps the order the file has it — a list of links is remembered by
 * position, so re-sorting it would make it harder to use, not easier.
 */
import { SuggestModal, type App } from "obsidian";
import { t } from "../i18n";
import type { PaneSectionsController } from "../controllers/pane-sections";
import type { BookmarkEntry } from "../services/bookmark-file";
import { drawBookmarkIcon } from "./bookmark-icon";
import { installIconFont } from "./icon-font";

export class BookmarkQuickOpenModal extends SuggestModal<BookmarkEntry> {
  constructor(
    app: App,
    private readonly sections: PaneSectionsController
  ) {
    super(app);
    this.setPlaceholder(t().explorer.bookmarks.quickOpen);
    installIconFont(this.containerEl.doc);
  }

  getSuggestions(query: string): BookmarkEntry[] {
    const needle = query.trim().toLowerCase();
    return this.sections.bookmarkEntries().filter((entry) => matches(entry, needle));
  }

  renderSuggestion(entry: BookmarkEntry, el: HTMLElement): void {
    el.addClass("schreibstube-bookmark-suggestion");

    drawBookmarkIcon(
      el.createSpan({ cls: "schreibstube-explorer-glyph" }),
      entry.bookmark,
      this.sections.pluginIconFor(entry.bookmark)
    );

    const text = el.createDiv({ cls: "schreibstube-bookmark-suggestion-text" });
    text.createDiv({ text: entry.bookmark.name });

    text.createDiv({
      cls: "schreibstube-bookmark-suggestion-path",
      text: entry.folderPath || t().explorer.bookmarks.all
    });
  }

  onChooseSuggestion(entry: BookmarkEntry): void {
    this.sections.openBookmark(entry.bookmark);
  }
}

/** A query matches a bookmark by its name, its folder, or its URL — the last
 *  because a person looking for a site often remembers the domain, not the
 *  label somebody gave it. */
function matches(entry: BookmarkEntry, needle: string): boolean {
  return (
    entry.bookmark.name.toLowerCase().includes(needle) ||
    entry.folderPath.toLowerCase().includes(needle) ||
    entry.bookmark.url.toLowerCase().includes(needle)
  );
}
