/**
 * "Open bookmark", from the command palette.
 *
 * The pane is the place to browse; this is the place to go straight there. With
 * nothing typed it offers what was opened most recently on this device, then
 * everything else in the order the file has it — a list of links is remembered
 * by position, so re-sorting it alphabetically would make it harder to use, not
 * easier.
 */
import { SuggestModal, type App } from "obsidian";
import { t } from "../i18n";
import type { PaneSectionsController } from "../controllers/pane-sections";
import { bookmarkIcon, type BookmarkEntry } from "../services/bookmark-file";
import { applyIcon, installIconFont } from "./icon-font";

interface Suggestion {
  entry: BookmarkEntry;
  /** Shown as the aux line: where the bookmark sits, or that it is recent. */
  recent: boolean;
}

export class BookmarkQuickOpenModal extends SuggestModal<Suggestion> {
  constructor(
    app: App,
    private readonly sections: PaneSectionsController
  ) {
    super(app);
    this.setPlaceholder(t().explorer.bookmarks.quickOpen);
    installIconFont(this.containerEl.doc);
  }

  getSuggestions(query: string): Suggestion[] {
    const needle = query.trim().toLowerCase();
    const all = this.sections.bookmarkEntries();

    if (needle.length === 0) {
      const recent = this.sections.recentBookmarks();
      const seen = new Set(recent.map((entry) => entry.bookmark.url));

      return [
        ...recent.map((entry) => ({ entry, recent: true })),
        ...all
          .filter((entry) => !seen.has(entry.bookmark.url))
          .map((entry) => ({ entry, recent: false }))
      ];
    }

    return all.filter((entry) => matches(entry, needle)).map((entry) => ({ entry, recent: false }));
  }

  renderSuggestion({ entry, recent }: Suggestion, el: HTMLElement): void {
    el.addClass("schreibstube-bookmark-suggestion");

    applyIcon(
      el.createSpan({ cls: "schreibstube-explorer-glyph" }),
      bookmarkIcon(entry.bookmark.kind)
    );

    const text = el.createDiv({ cls: "schreibstube-bookmark-suggestion-text" });
    text.createDiv({ text: entry.bookmark.name });

    const aside = recent
      ? t().explorer.bookmarks.recent
      : entry.folderPath || t().explorer.bookmarks.all;
    text.createDiv({ cls: "schreibstube-bookmark-suggestion-path", text: aside });
  }

  onChooseSuggestion({ entry }: Suggestion): void {
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
