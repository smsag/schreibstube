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

export type ExplorerAction =
  | "open"
  | "open-new-tab"
  | "set-icon"
  | "clear-icon"
  | "keep-top"
  | "release-top"
  | "pin"
  | "unpin"
  | "pin-tag"
  | "related"
  | "bind-source"
  | "check-source"
  | "open-source"
  | "unbind-source"
  | "sync-folder"
  | "new-note"
  | "new-folder"
  | "copy-path"
  | "move"
  | "rename"
  | "rename-ai"
  | "delete"
  | "more";

export interface ExplorerTarget {
  kind: "file" | "folder";
  path: string;
  /** Only a Markdown note can be bound to a source. */
  markdown: boolean;
  /** A picture, which is named by being looked at rather than by being read. */
  image?: boolean;
  /**
   * Whether the note names a source in its frontmatter.
   *
   * Read from the note, not from the sync badge: the badge is hidden while
   * document sync is switched off, and a note that is bound is still bound.
   */
  bound: boolean;
  hasIcon: boolean;
  /** Held at the top of the folder it sits in. */
  kept: boolean;
  /** Drawn in the pinned block above the tree. */
  pinned: boolean;
  /** A note that carries at least one tag, which can be pinned from it. */
  tagged?: boolean;
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

/**
 * How long after the pane answers a long press the browser's own context menu
 * still counts as the same press.
 *
 * The two arrive within a few hundred milliseconds of each other, so a second
 * covers the gap. Nothing else is suppressed for that second: a right click and
 * the row's own button are never the echo of anything.
 */
export const LONG_PRESS_ECHO_MS = 1000;

/**
 * Whether a context menu event is the browser's echo of a long press the pane
 * has already answered.
 *
 * `answeredAt` is null until the pane's own timer has opened a menu for the
 * press in progress, which is why a mouse never reaches this at all.
 */
export function isLongPressEcho(now: number, answeredAt: number | null): boolean {
  return answeredAt !== null && now - answeredAt < LONG_PRESS_ECHO_MS;
}

export function buildExplorerMenu(
  target: ExplorerTarget,
  foreignItems: ForeignItemMode
): ExplorerMenuSection[] {
  const menu = t().explorer.menu;
  const sections: ExplorerMenuSection[] = [];

  if (target.kind === "file") {
    const open: ExplorerMenuItem[] = [
      { id: "open", label: menu.open, icon: "file-text" },
      { id: "open-new-tab", label: menu.openNewTab, icon: "layout-panel-left" }
    ];
    // Listing what a note sits among is a way of opening it, not a way of
    // changing it, so it belongs in this block rather than below with the
    // actions that write. Only a note has it: an attachment carries no links
    // and no tags, and there is nothing to relate it by.
    if (target.markdown) {
      open.push({ id: "related", label: menu.related, icon: "git-fork" });
    }
    sections.push({ id: "open", items: open });
  }

  const appearance: ExplorerMenuItem[] = [
    { id: "set-icon", label: target.hasIcon ? menu.changeIcon : menu.setIcon, icon: "image-plus" }
  ];
  if (target.hasIcon) {
    appearance.push({ id: "clear-icon", label: menu.clearIcon, icon: "image-off" });
  }
  // The two marks, in the order they are reached for. Keeping a file at the top
  // of its folder is the everyday one — this note first, in this folder —
  // while pinning is the rarer "wherever I am, I want this row".
  appearance.push(
    target.kept
      ? { id: "release-top", label: menu.releaseTop, icon: "arrow-down-to-line" }
      : { id: "keep-top", label: menu.keepTop, icon: "arrow-up-to-line" }
  );
  appearance.push(
    target.pinned
      ? { id: "unpin", label: menu.unpin, icon: "pin-off" }
      : { id: "pin", label: menu.pin, icon: "pin" }
  );
  // The tag is reached through a note that carries it: Obsidian's own tag list
  // offers a plugin no menu to add to, and on a phone the note's long press is
  // the one gesture there is.
  if (target.kind === "file" && target.markdown && target.tagged) {
    appearance.push({ id: "pin-tag", label: menu.pinTag, icon: "tag" });
  }
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
      // Moving is on the menu rather than only on a drag, because a drag needs
      // a mouse: on a phone the long press belongs to this menu, so without an
      // entry here nothing in the vault could be moved at all.
      { id: "move", label: menu.move, icon: "folder-input" },
      { id: "rename", label: menu.rename, icon: "pencil" },
      ...aiRenameItem(target),
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
 * Naming a file from what is inside it, next to naming it by hand.
 *
 * One entry and not two, because a person picking a row has already said which
 * file they mean and the file says which of the two things it is: a note is
 * read, a picture is looked at. The wording follows it — "from the text" and
 * "from the picture" are what actually happens, and a single label covering
 * both would name neither.
 *
 * Anything else offers nothing. A PDF, a canvas or a drawing cannot be read by
 * either path, and a menu entry that answers a tap with a refusal is worse than
 * one that was never there.
 */
function aiRenameItem(target: ExplorerTarget): ExplorerMenuItem[] {
  const menu = t().explorer.menu;

  if (target.kind !== "file") return [];
  if (target.image) return [{ id: "rename-ai", label: menu.renameImageAi, icon: "wand-2" }];
  if (target.markdown) return [{ id: "rename-ai", label: menu.renameNoteAi, icon: "wand-2" }];

  return [];
}

/**
 * The sync block, which is the reason the pane has its own menu at all.
 *
 * A note that is not bound offers to bind; a bound one offers the three things
 * worth doing to a mirror: refreshing it, looking at where it comes from, and
 * letting it go. An attachment offers nothing, because only Markdown can mirror
 * a source.
 *
 * What decides is the binding itself, never the sync mark. The mark is hidden
 * while document sync is switched off, and a menu that followed it offered a
 * bound note nothing but "Bind source" — no way to check it by hand and no way
 * to unbind it — which is the state a person is in the moment they bind their
 * first note and find the switch is still off.
 */
function syncItems(target: ExplorerTarget): ExplorerMenuItem[] {
  const menu = t().explorer.menu;

  if (target.kind === "folder") {
    return target.hasBoundNotes
      ? [{ id: "sync-folder", label: menu.syncFolder, icon: "refresh-cw" }]
      : [];
  }

  if (!target.markdown) return [];

  if (!target.bound) {
    return [{ id: "bind-source", label: menu.bindSource, icon: "link" }];
  }

  return [
    { id: "check-source", label: menu.checkSource, icon: "refresh-cw" },
    { id: "open-source", label: menu.openSource, icon: "globe" },
    { id: "unbind-source", label: menu.unbindSource, icon: "unlink" }
  ];
}

/** What a pinned tag's row offers. */
export type TagPinAction = "show-tag" | "unpin-tag";

export interface TagPinMenuItem {
  id: TagPinAction;
  label: string;
  icon: string;
}

/**
 * The menu on a pinned tag.
 *
 * Short, because a tag is not a file: there is nothing to rename, move or bind.
 * Listing its notes is what a press already does and is here for the long press
 * that asked for the menu instead.
 */
export function buildTagPinMenu(): TagPinMenuItem[] {
  const menu = t().explorer.menu;
  return [
    { id: "show-tag", label: menu.showTag, icon: "list-checks" },
    { id: "unpin-tag", label: menu.unpin, icon: "pin-off" }
  ];
}
