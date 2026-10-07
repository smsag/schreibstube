/**
 * The icon each command shows where Obsidian draws commands as icons: the
 * mobile toolbar, which shows a question mark for a command without one, and
 * a ribbon or a hotkey list that picks one up.
 *
 * Kept here, by command id, and added as each command is registered, so a
 * command cannot be added without its icon being looked for; a test reads the
 * ids out of `main.ts` and fails on any that is missing. A command that brings
 * its own icon, the plugin's mark on the Explorer's, keeps it. The names are
 * Lucide's, as Obsidian ships them.
 */
export const COMMAND_ICONS: Readonly<Record<string, string>> = {
  "create-untitled-note": "file-plus",
  "set-focus-sentence-mode": "text-cursor",
  "set-focus-paragraph-mode": "pilcrow",
  "switch-reading-editing": "book-open",
  "insert-task-summary": "list-checks",
  "tidy-done-tasks": "check-check",
  "insert-slideshow": "gallery-horizontal",
  "insert-pdf-summary": "file-text",
  "explorer-focus-filter": "search",
  "explorer-orphaned-descriptions": "image-off",
  "folder-tiles": "layout-grid",
  "pin-tag": "pin",
  "open-bookmark": "bookmark",
  "open-review-panel": "spell-check",
  "proof-read-note": "spell-check-2",
  "poll-all-sources": "refresh-cw",
  "query-mailbox": "mail-search",
  "publish-folder": "globe",
  "switch-link-side": "arrow-left-right",
  "sum-selection": "sigma",
  "freeze-totals": "snowflake",
  "update-exchange-rates": "badge-euro",
  "rename-from-content": "text-cursor-input",
  "summarize-selection": "sparkles",
  "table-from-selection": "table",
  "ai-table-from-selection": "wand-sparkles",
  "insert-today": "calendar-plus",
  "add-property-set": "list-plus",
  "suggest-tags": "tags",
  "collapse-explorer-folders": "fold-vertical",
  "explorer-undo": "undo-2",
  "related-notes": "network",
  "check-note-source": "file-down",
  "send-note-as-email": "send",
  "fetch-replies": "mails",
  "base-reading-view": "book-open",
  "print-note": "printer",
  "print-note-quick": "printer-check",
  "print-selection": "text-select"
};

/** The icon for a command, or none when the command brings its own or has none listed. */
export function commandIcon(id: string): string | undefined {
  return Object.hasOwn(COMMAND_ICONS, id) ? COMMAND_ICONS[id] : undefined;
}
