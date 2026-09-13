/**
 * What the explorer knows about a file beyond what the vault says: an icon,
 * whether it is held at the top of its folder, and whether it sits in the
 * pinned block above the tree.
 *
 * The last two are separate on purpose. A note that matters inside one project
 * folder is not a note that belongs at the top of the whole pane, and holding
 * both meanings in one flag meant marking the first always did the second.
 *
 * The state is keyed by vault path, which is the only handle Obsidian offers —
 * there is no stable file id. Paths move, so three rules keep the map honest.
 *
 * **A move is followed, not guessed.** Obsidian reports renames, including the
 * implicit rename of every file under a renamed folder, and the map follows.
 *
 * **A disappearance is remembered, not deleted.** A file moved outside Obsidian
 * arrives as a delete followed by a create, and deleting the entry on the spot
 * would lose the icon. The entry becomes a tombstone instead, and a file that
 * turns up later under the same name reclaims it.
 *
 * **Every entry carries its own timestamp.** The file behind this map is
 * synced between devices by iCloud, Obsidian Sync or Git, and two devices will
 * write it independently. Merging per entry, newest wins, turns what would be a
 * lost update into a lost keystroke at worst.
 */

export const EXPLORER_DATA_VERSION = 2;

/** How long a tombstone waits for its file to reappear somewhere else. Long
 *  enough to survive a holiday, short enough that the file cannot grow without
 *  bound in a vault where files come and go. */
export const ORPHAN_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One file or folder. An entry with no icon and neither mark is not empty: it
 * records that they were removed at a known time, so a device that still has
 * the old values cannot merge them back in.
 */
export interface ExplorerEntry {
  /** Icon name from the catalogue, absent when none is set. */
  icon?: string;
  /** When the item was pinned to the block above the tree, which is also its
   *  order within that block. */
  pinnedAt?: number;
  /** When the item was set to keep the top of its folder, which is also its
   *  order among the kept items of that folder. */
  keptAt?: number;
  /** Epoch ms of the last change here. Decides the winner in a merge. */
  updatedAt: number;
  /** Basename kept while the entry is a tombstone, to match a reappearance. */
  name?: string;
  /** Epoch ms the path went missing. Present only on tombstones. */
  orphanedAt?: number;
}

export interface ExplorerData {
  version: number;
  entries: Record<string, ExplorerEntry>;
}

/** A vault item as the explorer sorts it. */
export interface ExplorerNode {
  path: string;
  name: string;
  kind: "file" | "folder";
}

export function emptyExplorerData(): ExplorerData {
  return { version: EXPLORER_DATA_VERSION, entries: {} };
}

/**
 * Read the file back.
 *
 * It sits in the plugin folder, which means a person can open it, a sync client
 * can half-write it, and a future version can widen it. Nothing here is
 * trusted: a malformed entry is dropped rather than allowed to reach the view.
 */
export function parseExplorerData(raw: unknown): ExplorerData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyExplorerData();

  const source = (raw as { entries?: unknown }).entries;
  if (!source || typeof source !== "object" || Array.isArray(source)) return emptyExplorerData();

  const written = (raw as { version?: unknown }).version;
  const version = Number.isFinite(written) ? Number(written) : 0;

  const entries: Record<string, ExplorerEntry> = {};
  for (const [path, value] of Object.entries(source as Record<string, unknown>)) {
    const entry = parseEntry(value);
    if (!entry || path.length === 0) continue;

    // Before version 2 one flag meant both things, so a pin read from an older
    // file also holds its folder's top — which is what it did when it was set.
    entries[path] =
      version < 2 && entry.pinnedAt !== undefined && entry.keptAt === undefined
        ? { ...entry, keptAt: entry.pinnedAt }
        : entry;
  }

  return { version: EXPLORER_DATA_VERSION, entries };
}

function parseEntry(value: unknown): ExplorerEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<ExplorerEntry>;

  const entry: ExplorerEntry = {
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : 0
  };

  if (typeof record.icon === "string" && record.icon.length > 0) entry.icon = record.icon;
  if (Number.isFinite(record.pinnedAt)) entry.pinnedAt = Number(record.pinnedAt);
  if (Number.isFinite(record.keptAt)) entry.keptAt = Number(record.keptAt);
  if (typeof record.name === "string" && record.name.length > 0) entry.name = record.name;
  if (Number.isFinite(record.orphanedAt)) entry.orphanedAt = Number(record.orphanedAt);

  return entry;
}

/**
 * Write it out with sorted keys.
 *
 * Two devices that make the same change should produce the same bytes, so a
 * file syncer has nothing to reconcile. Key order is the cheapest way to get
 * that, and it also makes the file readable when someone opens it.
 */
export function serializeExplorerData(data: ExplorerData): string {
  const entries: Record<string, ExplorerEntry> = {};
  for (const path of Object.keys(data.entries).sort()) {
    entries[path] = data.entries[path];
  }
  return `${JSON.stringify({ version: EXPLORER_DATA_VERSION, entries }, null, 2)}\n`;
}

/** The live entry for a path. A tombstone is not live: its file is gone. */
export function entryFor(data: ExplorerData, path: string): ExplorerEntry | undefined {
  const entry = data.entries[path];
  return entry && entry.orphanedAt === undefined ? entry : undefined;
}

export function iconFor(data: ExplorerData, path: string): string | undefined {
  return entryFor(data, path)?.icon;
}

export function isPinned(data: ExplorerData, path: string): boolean {
  return entryFor(data, path)?.pinnedAt !== undefined;
}

/** Whether the item is held at the top of the folder it sits in. */
export function isKept(data: ExplorerData, path: string): boolean {
  return entryFor(data, path)?.keptAt !== undefined;
}

/** Apply a change to one path, stamping it so a merge can order it. */
function withEntry(
  data: ExplorerData,
  path: string,
  now: number,
  change: (entry: ExplorerEntry) => ExplorerEntry
): ExplorerData {
  const current = data.entries[path] ?? { updatedAt: now };
  // A change to a tombstoned path revives it: the user is looking at the file.
  const { orphanedAt: _gone, name: _name, ...live } = current;
  const next = { ...change(live), updatedAt: now };

  return { version: EXPLORER_DATA_VERSION, entries: { ...data.entries, [path]: next } };
}

export function setIcon(
  data: ExplorerData,
  path: string,
  icon: string | null,
  now: number
): ExplorerData {
  return withEntry(data, path, now, (entry) => {
    if (icon === null) {
      const { icon: _removed, ...rest } = entry;
      return rest;
    }
    return { ...entry, icon };
  });
}

export function setPinned(
  data: ExplorerData,
  path: string,
  pinned: boolean,
  now: number
): ExplorerData {
  return withEntry(data, path, now, (entry) => {
    if (!pinned) {
      const { pinnedAt: _removed, ...rest } = entry;
      return rest;
    }
    // Re-pinning an already pinned item keeps its place rather than sending it
    // to the end of the pinned block, which would look like a bug.
    return { ...entry, pinnedAt: entry.pinnedAt ?? now };
  });
}

/**
 * Hold an item at the top of its folder, or let it fall back into the order.
 *
 * Separate from the pin above: this is the mark that explains why a row sits
 * where it does in the tree, and it says nothing about the block above it.
 */
export function setKept(
  data: ExplorerData,
  path: string,
  kept: boolean,
  now: number
): ExplorerData {
  return withEntry(data, path, now, (entry) => {
    if (!kept) {
      const { keptAt: _removed, ...rest } = entry;
      return rest;
    }
    // Setting it again keeps the place it already has among its siblings.
    return { ...entry, keptAt: entry.keptAt ?? now };
  });
}

/**
 * Follow a move.
 *
 * A renamed folder moves every entry beneath it, because Obsidian reports the
 * folder once and leaves the descendants implied. An entry already at the
 * destination is overwritten: the file that was there is the one being replaced.
 */
export function renamePath(
  data: ExplorerData,
  oldPath: string,
  newPath: string,
  now: number
): ExplorerData {
  if (oldPath === newPath) return data;

  const prefix = `${oldPath}/`;
  const entries: Record<string, ExplorerEntry> = {};
  const moved: Record<string, ExplorerEntry> = {};

  for (const [path, entry] of Object.entries(data.entries)) {
    if (path === oldPath) {
      moved[newPath] = { ...entry, updatedAt: now };
    } else if (path.startsWith(prefix)) {
      moved[`${newPath}/${path.slice(prefix.length)}`] = { ...entry, updatedAt: now };
    } else {
      entries[path] = entry;
    }
  }

  return { version: EXPLORER_DATA_VERSION, entries: { ...entries, ...moved } };
}

/**
 * Remember an item that is no longer there.
 *
 * Called for a delete, which is also what an external move looks like from
 * inside Obsidian. The entry keeps its icon and its pin and gains a tombstone
 * marker, so `reattachOrphans` can hand it back if the file reappears.
 */
export function markMissing(data: ExplorerData, path: string, now: number): ExplorerData {
  const prefix = `${path}/`;
  const entries: Record<string, ExplorerEntry> = {};
  let touched = false;

  for (const [current, entry] of Object.entries(data.entries)) {
    if (current !== path && !current.startsWith(prefix)) {
      entries[current] = entry;
      continue;
    }

    touched = true;
    entries[current] =
      entry.orphanedAt === undefined
        ? { ...entry, orphanedAt: now, name: basename(current) }
        : entry;
  }

  return touched ? { version: EXPLORER_DATA_VERSION, entries } : data;
}

/**
 * Hand a tombstone's icon to a file that turned up elsewhere under the same
 * name.
 *
 * Only an unambiguous match counts: one tombstone, one new path. Two files
 * called `Notes.md` would otherwise trade icons at random, which is worse than
 * losing one.
 */
export function reattachOrphans(
  data: ExplorerData,
  knownPaths: readonly string[],
  now: number
): ExplorerData {
  const orphans = Object.entries(data.entries).filter(
    ([, entry]) => entry.orphanedAt !== undefined
  );
  if (orphans.length === 0) return data;

  const present = new Set(knownPaths);
  const revived: Record<string, ExplorerEntry> = {};

  // A file deleted and written again at the same path — which is what a sync
  // client does when it replaces one — keeps what it had.
  for (const [path, entry] of orphans) {
    if (!present.has(path)) continue;
    const { orphanedAt: _gone, name: _remembered, ...live } = entry;
    revived[path] = { ...live, updatedAt: now };
  }

  const stillMissing = orphans.filter(([path]) => revived[path] === undefined);
  const unclaimed = knownPaths.filter((path) => data.entries[path] === undefined);

  if (unclaimed.length === 0 || stillMissing.length === 0) {
    return Object.keys(revived).length > 0
      ? { version: EXPLORER_DATA_VERSION, entries: { ...data.entries, ...revived } }
      : data;
  }

  const byName = new Map<string, string[]>();
  for (const path of unclaimed) {
    const name = basename(path);
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }

  const entries = { ...data.entries, ...revived };
  let touched = Object.keys(revived).length > 0;

  for (const [orphanPath, entry] of stillMissing) {
    const name = entry.name ?? basename(orphanPath);
    const candidates = byName.get(name);
    if (!candidates || candidates.length !== 1) continue;

    const sameName = stillMissing.filter(
      ([path, other]) => (other.name ?? basename(path)) === name
    );
    if (sameName.length !== 1) continue;

    const { orphanedAt: _gone, name: _remembered, ...live } = entry;
    entries[candidates[0]] = { ...live, updatedAt: now };
    delete entries[orphanPath];
    touched = true;
  }

  return touched ? { version: EXPLORER_DATA_VERSION, entries } : data;
}

/**
 * Drop what no longer earns its place: tombstones past the grace period, and
 * entries that carry neither an icon nor a pin and are old enough that no other
 * device can still be holding the values they cleared.
 */
export function pruneExplorerData(
  data: ExplorerData,
  now: number,
  graceMs = ORPHAN_GRACE_MS
): ExplorerData {
  const entries: Record<string, ExplorerEntry> = {};
  let dropped = false;

  for (const [path, entry] of Object.entries(data.entries)) {
    const expired =
      entry.orphanedAt !== undefined
        ? now - entry.orphanedAt > graceMs
        : entry.icon === undefined &&
          entry.pinnedAt === undefined &&
          entry.keptAt === undefined &&
          now - entry.updatedAt > graceMs;

    if (expired) {
      dropped = true;
      continue;
    }
    entries[path] = entry;
  }

  return dropped ? { version: EXPLORER_DATA_VERSION, entries } : data;
}

/**
 * Combine what is in memory with what is on disk.
 *
 * Per entry, newest wins. Whole-file last-writer-wins is what loses an icon set
 * on a phone while a laptop had the file open; per entry, the two changes both
 * survive unless they are to the same item, and then the later one is the one
 * the person made last. A tie goes to `mine`, which is arbitrary but stable.
 */
export function mergeExplorerData(mine: ExplorerData, theirs: ExplorerData): ExplorerData {
  const entries: Record<string, ExplorerEntry> = { ...theirs.entries };

  for (const [path, entry] of Object.entries(mine.entries)) {
    const other = entries[path];
    if (!other || entry.updatedAt >= other.updatedAt) entries[path] = entry;
  }

  return { version: EXPLORER_DATA_VERSION, entries };
}

/**
 * Everything pinned, in the order it was pinned.
 *
 * This is what the pane's pinned block draws. It is the answer to "wherever I
 * am, I want this one row"; keeping a file at the top of its folder is the
 * answer to "inside this folder, this one first", and the two are set apart.
 */
/**
 * Put the pinned block in a given order.
 *
 * `pinnedAt` doubles as the sort key, so a reorder rewrites it: consecutive
 * values from one base, in the order handed in. Every touched entry gets a
 * fresh `updatedAt` too, which is what the per-entry merge compares, so a
 * reorder made on one device wins over an older order held by another without
 * either having to know a list was involved.
 *
 * Paths that are not pinned are ignored rather than pinned by side effect, and
 * anything pinned but missing from the list keeps its place after the ones
 * given, so a stale view cannot silently unpin what it did not know about.
 */
export function reorderPinned(
  data: ExplorerData,
  orderedPaths: readonly string[],
  now: number
): ExplorerData {
  const pinned = new Set(pinnedPaths(data));
  const moved = orderedPaths.filter((path) => pinned.has(path));
  if (moved.length === 0) return data;

  const rest = pinnedPaths(data).filter((path) => !moved.includes(path));
  const entries = { ...data.entries };

  [...moved, ...rest].forEach((path, index) => {
    const current = entries[path];
    if (!current) return;
    entries[path] = { ...current, pinnedAt: now + index, updatedAt: now };
  });

  return { version: EXPLORER_DATA_VERSION, entries };
}

export function pinnedPaths(data: ExplorerData): string[] {
  return Object.entries(data.entries)
    .filter(([, entry]) => entry.orphanedAt === undefined && entry.pinnedAt !== undefined)
    .sort(([, a], [, b]) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0))
    .map(([path]) => path);
}

/**
 * The order a folder's children are shown in.
 *
 * Items kept at the top come first, in the order they were kept, so marking one
 * does not move everything else around. Then Obsidian's own arrangement:
 * folders before files, each alphabetical, numeric-aware so `Objekt 2` precedes
 * `Objekt 10`.
 *
 * A pin is not consulted here. Pinning draws a row in the block above the tree
 * and says nothing about where the file sits inside its folder.
 */
export function sortSiblings<T extends ExplorerNode>(nodes: readonly T[], data: ExplorerData): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  return [...nodes].sort((a, b) => {
    const keptA = entryFor(data, a.path)?.keptAt;
    const keptB = entryFor(data, b.path)?.keptAt;

    if (keptA !== undefined && keptB !== undefined)
      return keptA - keptB || collator.compare(a.name, b.name);
    if (keptA !== undefined) return -1;
    if (keptB !== undefined) return 1;

    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
