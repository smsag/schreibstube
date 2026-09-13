/**
 * Where a drag may land.
 *
 * Two drags share the file pane: a row of the tree carried onto a folder, and
 * a row of the pinned block carried to a new place in it. Both need the same
 * question answered — what is under the pointer — and this module answers it
 * from the rows on screen, with no view state of its own. The marks it paints
 * are classes the stylesheet draws.
 */
import { parentOf } from "../services/tree-move";

const MOVE_TARGETS =
  ".schreibstube-explorer-row.is-folder[data-path], .schreibstube-explorer-section-header.is-divider";
const FILE_ROWS =
  ".schreibstube-explorer-tree .schreibstube-explorer-row[data-path]:not(.is-folder)";
const PINNED_ROWS = ".schreibstube-explorer-row.is-pinned-entry";
const SECTION_HEADER = "schreibstube-explorer-section-header";

/** Whether a point on screen is inside an element's box. */
export function containsPoint(element: HTMLElement, clientX: number, clientY: number): boolean {
  const box = element.getBoundingClientRect();
  return clientY >= box.top && clientY <= box.bottom && clientX >= box.left && clientX <= box.right;
}

// --- the tree: dropping onto a folder -------------------------------------

/** Rows and headers a tree drag may land on. */
function moveTargets(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(MOVE_TARGETS));
}

/**
 * File rows in the tree, each of which stands for the folder holding it.
 *
 * A file is not somewhere to put anything, but pointing at one is how a
 * person says "in there": the folder is what they are aiming at and the rows
 * inside it are what the folder looks like. Only the tree counts — the
 * curated lists above it are not a place in the vault.
 */
function fileRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FILE_ROWS));
}

/**
 * The folder under the pointer, or null when there is none.
 *
 * A folder row answers with itself and the section header with the vault
 * root, which is the only way to drag something out of every folder it is in.
 * A file row answers with the folder it sits in, so the target a person aims
 * at is the whole block a folder occupies rather than the one row naming it.
 */
export function moveTargetAt(root: HTMLElement, clientX: number, clientY: number): string | null {
  for (const element of moveTargets(root)) {
    if (!containsPoint(element, clientX, clientY)) continue;

    if (element.hasClass(SECTION_HEADER)) return "";
    return element.getAttribute("data-path");
  }

  for (const element of fileRows(root)) {
    if (!containsPoint(element, clientX, clientY)) continue;

    const path = element.getAttribute("data-path");
    // A file at the root answers with the root, as every other file answers
    // with the folder holding it.
    if (path !== null) return parentOf(path);
  }

  return null;
}

/**
 * Mark the folder under the pointer, if the row being carried may go there.
 * A folder that cannot take this row should not look as if it could.
 */
export function markMoveTarget(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  canDrop: (targetFolder: string) => boolean
): void {
  clearMoveMarks(root);
  const target = moveTargetAt(root, clientX, clientY);
  if (target === null) return;

  for (const element of moveTargets(root)) {
    const isRoot = element.hasClass(SECTION_HEADER);
    const path = isRoot ? "" : element.getAttribute("data-path");
    if (path !== target) continue;
    if (canDrop(target)) element.addClass("is-drop-into");
  }
}

export function clearMoveMarks(root: HTMLElement): void {
  for (const element of moveTargets(root)) element.removeClass("is-drop-into");
}

// --- the pinned block: reordering ------------------------------------------

/**
 * Every row of the Pinned section on screen, shelf and scroller alike, in
 * drawn order. Deliberately not `.is-pinned`, which the tree also puts on a
 * pinned row: dropping onto one of those would reorder against a row that is
 * not part of this list.
 */
function pinnedRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(PINNED_ROWS));
}

export interface DropSlot {
  path: string;
  /** Whether the pointer is above that row's middle. */
  before: boolean;
}

/** Which pinned row the pointer is over, and which half of it. */
export function dropAt(root: HTMLElement, clientY: number): DropSlot | null {
  for (const row of pinnedRows(root)) {
    const box = row.getBoundingClientRect();
    if (clientY < box.top || clientY > box.bottom) continue;

    const path = row.getAttribute("data-path");
    if (!path) continue;
    return { path, before: clientY < box.top + box.height / 2 };
  }
  return null;
}

export function markDropTarget(root: HTMLElement, clientY: number, dragging: string | null): void {
  clearDropMarks(root);
  const target = dropAt(root, clientY);
  if (!target || target.path === dragging) return;

  for (const row of pinnedRows(root)) {
    if (row.getAttribute("data-path") !== target.path) continue;
    row.addClass(target.before ? "is-drop-before" : "is-drop-after");
  }
}

export function clearDropMarks(root: HTMLElement): void {
  for (const row of pinnedRows(root)) {
    row.removeClass("is-drop-before");
    row.removeClass("is-drop-after");
  }
}

/**
 * The order the block should take once `path` lands at `slot`, or null when
 * the drag changed nothing: no slot, its own slot, or the same order again.
 */
export function orderAfterDrop(
  order: readonly string[],
  path: string,
  slot: DropSlot | null
): string[] | null {
  if (!slot || slot.path === path) return null;

  const without = order.filter((entry) => entry !== path);
  const at = without.indexOf(slot.path);
  if (at === -1) return null;

  const next = [...without];
  next.splice(slot.before ? at : at + 1, 0, path);

  return next.join("\u0000") === order.join("\u0000") ? null : next;
}
