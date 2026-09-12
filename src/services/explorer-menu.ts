/**
 * What the explorer's context menu offers, in what order.
 *
 * Obsidian's own file menu is whatever the installed plugins happened to add,
 * in load order, each in its own block. That is why this pane builds its menu
 * itself: the actions a person came for are first, grouped, and always in the
 * same place, and everything contributed by other plugins goes behind a single
 * entry at the end instead of between the actions.
 *
 * The builder is a pure function so the order is a test rather than something
 * to check by tapping through a phone. Turning a descriptor into an Obsidian
 * menu item is the view's job.
 */
import { t } from "../i18n";
import type { SyncBadge } from "./explorer-badge";

export type ExplorerAction =
  | "open"
  | "open-new-tab"
  | "set-icon"
  | "clear-icon"
  | "pin"
  | "unpin"
  | "bind-source"
  | "check-source"
  | "open-source"
  | "unbind-source"
  | "sync-folder"
  | "new-note"
  | "new-folder"
  | "copy-path"
  | "rename"
  | "delete"
  | "more";

export interface ExplorerTarget {
  kind: "file" | "folder";
  path: string;
  /** Only a Markdown note can be bound to a source. */
  markdown: boolean;
  hasIcon: boolean;
  pinned: boolean;
  /** "none" when the note carries no binding. */
  sync: SyncBadge;
  /** For a folder: whether anything under it is bound to a source. */
  hasBoundNotes?: boolean;
}

/** Where the items other plugins contribute end up. */
export type ForeignItemMode = "submenu" | "inline" | "off";

export interface ExplorerMenuItem {
  id: ExplorerAction;
  label: string;
  /** Obsidian's own icon name (Lucide), so the menu looks like every other menu. */
  icon: string;
  /** Destructive actions are marked so the view can colour them. */
  warning?: boolean;
}

export interface ExplorerMenuSection {
  id: "open" | "appearance" | "sync" | "create" | "file" | "plugins";
  items: ExplorerMenuItem[];
}

export function buildExplorerMenu(
  target: ExplorerTarget,
  foreignItems: ForeignItemMode
): ExplorerMenuSection[] {
  const menu = t().explorer.menu;
  const sections: ExplorerMenuSection[] = [];

  if (target.kind === "file") {
    sections.push({
      id: "open",
      items: [
        { id: "open", label: menu.open, icon: "file-text" },
        { id: "open-new-tab", label: menu.openNewTab, icon: "layout-panel-left" }
      ]
    });
  }

  const appearance: ExplorerMenuItem[] = [
    { id: "set-icon", label: target.hasIcon ? menu.changeIcon : menu.setIcon, icon: "image-plus" }
  ];
  if (target.hasIcon) {
    appearance.push({ id: "clear-icon", label: menu.clearIcon, icon: "image-off" });
  }
  appearance.push(
    target.pinned
      ? { id: "unpin", label: menu.unpin, icon: "pin-off" }
      : { id: "pin", label: menu.pin, icon: "pin" }
  );
  sections.push({ id: "appearance", items: appearance });

  const sync = syncItems(target);
  if (sync.length > 0) sections.push({ id: "sync", items: sync });

  if (target.kind === "folder") {
    sections.push({
      id: "create",
      items: [
        { id: "new-note", label: menu.newNote, icon: "file-plus" },
        { id: "new-folder", label: menu.newFolder, icon: "folder-plus" },
        // A folder is bookmarked by pasting its URL into the bookmarks file,
        // so the way to obtain that URL belongs on the folder itself.
        { id: "copy-path", label: t().explorer.bookmarks.copyPath, icon: "copy" }
      ]
    });
  }

  sections.push({
    id: "file",
    items: [
      { id: "rename", label: menu.rename, icon: "pencil" },
      { id: "delete", label: menu.delete, icon: "trash-2", warning: true }
    ]
  });

  if (foreignItems !== "off") {
    sections.push({
      id: "plugins",
      items: [{ id: "more", label: menu.more, icon: "more-horizontal" }]
    });
  }

  return sections;
}

/**
 * The sync block, which is the reason the pane has its own menu at all.
 *
 * A note that is not bound offers to bind; a bound one offers the two things
 * worth doing to a mirror, refreshing it and looking at where it comes from.
 * An attachment offers nothing, because only Markdown can mirror a source.
 */
function syncItems(target: ExplorerTarget): ExplorerMenuItem[] {
  const menu = t().explorer.menu;

  if (target.kind === "folder") {
    return target.hasBoundNotes
      ? [{ id: "sync-folder", label: menu.syncFolder, icon: "refresh-cw" }]
      : [];
  }

  if (!target.markdown) return [];

  if (target.sync === "none") {
    return [{ id: "bind-source", label: menu.bindSource, icon: "link" }];
  }

  return [
    { id: "check-source", label: menu.checkSource, icon: "refresh-cw" },
    { id: "open-source", label: menu.openSource, icon: "globe" },
    { id: "unbind-source", label: menu.unbindSource, icon: "unlink" }
  ];
}
