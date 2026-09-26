/**
 * Which icon a bookmark wears.
 *
 * Three kinds of icon, and nothing else: a web link wears the globe, a link
 * calling a plugin wears that plugin's icon, and everything else wears the
 * vault's. The icon says where a bookmark leads, not whose it is — which is
 * also why the pane draws all of them in grey.
 */
import { classifyBookmarkUrl, type Bookmark, type BookmarkKind } from "./bookmark-file";

/** The icon each kind gets from the bundled set: the globe a web link wears,
 *  and what the others fall back to when Obsidian cannot draw theirs. */
const KIND_ICONS: Record<BookmarkKind, string> = {
  web: "world",
  obsidian: "external-link",
  folder: "folder",
  note: "file-text"
};

/**
 * Obsidian's icon for everything the vault answers: Lucide's shelf of books,
 * the one Pythia's vault-context toggle wears. One icon for notes, folders and
 * Obsidian's own links, because to the person tapping them they are all the
 * same thing — somewhere in the vault, not somewhere on the web.
 */
export const VAULT_ICON = "library";

/** How a bookmark's icon is drawn. */
export type BookmarkGlyph =
  /** From the bundled set, which the pane's own font draws. */
  | { from: "bundled"; name: string }
  /** By Obsidian, the first name it knows; `fallback` from the bundled set if it knows none. */
  | { from: "obsidian"; names: string[]; fallback: string };

/**
 * A plugin whose icon Obsidian turns out not to know falls back to the vault's
 * icon, because its link is still one Obsidian answers.
 */
export function bookmarkGlyph(bookmark: Bookmark, plugin: string | null): BookmarkGlyph {
  if (bookmark.kind === "web") return { from: "bundled", name: KIND_ICONS.web };

  return {
    from: "obsidian",
    names: plugin !== null ? [plugin, VAULT_ICON] : [VAULT_ICON],
    fallback: KIND_ICONS[bookmark.kind]
  };
}

/**
 * The actions Obsidian answers itself. Any other `obsidian://` action was
 * registered by a plugin, which is what lets its row wear that plugin's icon.
 */
const BUILT_IN_ACTIONS: ReadonlySet<string> = new Set([
  "open",
  "new",
  "search",
  "daily",
  "unique",
  "choose-vault",
  "hook-get-address",
  "vault"
]);

/**
 * A ribbon button or a command, as the icon lookup needs it: its id, which
 * Obsidian prefixes with the plugin's own (`pythia:…`), and whatever it named
 * as icon.
 */
export interface RegisteredIcon {
  id: string;
  icon?: unknown;
}

/** Where a plugin's icon can be read off, best first. */
export interface PluginIconSources {
  ribbon?: readonly RegisteredIcon[];
  commands?: readonly RegisteredIcon[];
}

/**
 * The plugin action an `obsidian://` bookmark calls: `pythia` for
 * `obsidian://pythia?vault=…`. Null for anything else, and for an action
 * Obsidian answers itself.
 */
export function obsidianUriAction(url: string): string | null {
  if (classifyBookmarkUrl(url) !== "obsidian") return null;

  const action = (url.slice("obsidian://".length).split(/[?#/]/)[0] ?? "").toLowerCase();
  return action.length > 0 && !BUILT_IN_ACTIONS.has(action) ? action : null;
}

/**
 * The icon a plugin draws itself with.
 *
 * Obsidian keeps no icon per plugin, so it is read off what the plugin put on
 * screen. Its ribbon button first: that is where a plugin shows itself, and a
 * plugin that puts no icon on its commands usually still has one. Its commands
 * after that. Within either, the icon named most stands for the plugin — a
 * command's own "star" or "refresh" loses to the logo on the others — and a
 * tie goes to the one registered first. Null when the plugin shows no icon,
 * or is not there, and the row keeps the generic one.
 */
export function pluginIcon(sources: PluginIconSources, pluginId: string): string | null {
  const prefix = `${pluginId}:`;
  return (
    mostNamedIcon(sources.ribbon ?? [], prefix) ?? mostNamedIcon(sources.commands ?? [], prefix)
  );
}

function mostNamedIcon(items: readonly RegisteredIcon[], prefix: string): string | null {
  const counts = new Map<string, number>();

  for (const item of items) {
    if (!item.id.startsWith(prefix)) continue;
    if (typeof item.icon !== "string" || item.icon.trim().length === 0) continue;
    counts.set(item.icon, (counts.get(item.icon) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [icon, count] of counts) {
    if (count > bestCount) {
      best = icon;
      bestCount = count;
    }
  }
  return best;
}
