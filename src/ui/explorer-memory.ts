/**
 * What the file pane remembers between sessions, per device.
 *
 * Which sections and folders a person closed is a fact about a person at a
 * screen, not about the vault, so it lives in Obsidian's local storage rather
 * than in the plugin's data file: a laptop's arrangement is not a phone's.
 */
import type { App } from "obsidian";

const MEMORY_KEY = "schreibstube:explorer:view";

/**
 * Bumped when a default changes.
 *
 * Without it, "closed unless you opened it" and "never recorded either way"
 * are the same absence, and a default that changes could not be applied once
 * without undoing the person's own choice every time the pane opens.
 */
export const PANE_MEMORY_VERSION = 1;

export interface PaneMemory {
  /** Which defaults this device has already been given. */
  version?: number;
  /** Sections the person closed. Absent means open, which is the default. */
  collapsedSections?: string[];
  /** Bookmark folders the person closed. */
  collapsedBookmarks?: string[];
  /** Tree folders the person opened. */
  expandedFolders?: string[];
}

/** What the pane holds in memory; the file's shape is the interface above. */
export interface PaneState {
  collapsedSections: Set<string>;
  collapsedBookmarks: Set<string>;
  expandedFolders: Set<string>;
}

/** The subset of `App` this module touches, so a test needs no app at all. */
export type PaneStorage = Pick<App, "loadLocalStorage" | "saveLocalStorage">;

/**
 * What was stored, or null when nothing was or storage refused.
 *
 * A hardened setup can refuse storage entirely; the pane opens on its defaults
 * rather than failing to open.
 */
export function readPaneMemory(storage: PaneStorage): PaneMemory | null {
  if (typeof storage.loadLocalStorage !== "function") return null;
  try {
    const raw: unknown = storage.loadLocalStorage(MEMORY_KEY);
    return raw && typeof raw === "object" ? (raw as PaneMemory) : null;
  } catch {
    return null;
  }
}

/** Nothing here is worth failing a click over, so a refusal is swallowed. */
export function writePaneMemory(storage: PaneStorage, state: PaneState): void {
  if (typeof storage.saveLocalStorage !== "function") return;
  try {
    storage.saveLocalStorage(MEMORY_KEY, {
      version: PANE_MEMORY_VERSION,
      collapsedSections: [...state.collapsedSections],
      collapsedBookmarks: [...state.collapsedBookmarks],
      expandedFolders: [...state.expandedFolders]
    } satisfies PaneMemory);
  } catch {
    // See above.
  }
}

/**
 * The state a stored memory describes.
 *
 * Every list is read defensively — the file is whatever local storage handed
 * back — and a memory written before the current defaults gets them applied
 * once: the pinned block keeps its first rows while closed, so closed is what
 * it opens on. After that the chevron is the person's.
 */
export function stateFromMemory(memory: PaneMemory | null): {
  state: PaneState;
  defaultsApplied: boolean;
} {
  const state: PaneState = {
    collapsedSections: toSet(memory?.collapsedSections),
    collapsedBookmarks: toSet(memory?.collapsedBookmarks),
    expandedFolders: toSet(memory?.expandedFolders)
  };

  if (memory?.version === PANE_MEMORY_VERSION) return { state, defaultsApplied: false };

  state.collapsedSections.add("pinned");
  return { state, defaultsApplied: true };
}

export function toSet(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
  );
}
