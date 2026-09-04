import type { Workspace, WorkspaceLeaf } from "obsidian";
import type { Logger } from "./logger";

/**
 * This module is the single place the plugin touches undocumented Obsidian
 * internals. Every access is feature-detected and logged on failure, so an
 * Obsidian update that changes one of these shapes degrades to a no-op with a
 * console warning instead of throwing deep inside a command. Keep all such
 * casts here — nothing else in the codebase should reach past the public API.
 */

export type OpenLinkTextFn = (
  linkText: string,
  sourcePath: string,
  newLeaf?: unknown,
  openViewState?: unknown
) => Promise<void>;

type SplitDirection = "horizontal" | "vertical";

interface WorkspaceInternals {
  openLinkText?: OpenLinkTextFn;
  createLeafBySplit?: (
    leaf: WorkspaceLeaf,
    direction: SplitDirection,
    before: boolean
  ) => WorkspaceLeaf | null;
}

interface LeafInternals {
  containerEl?: HTMLElement;
}

function internals(workspace: Workspace): WorkspaceInternals {
  return workspace as unknown as WorkspaceInternals;
}

/**
 * Replace `workspace.openLinkText` with a patched version built from the
 * original, and return a function that restores the original. If the internal
 * is missing (a future Obsidian change), logs and returns a no-op unpatch so
 * the caller need not special-case it.
 */
export function installOpenLinkTextPatch(
  workspace: Workspace,
  makePatched: (original: OpenLinkTextFn) => OpenLinkTextFn,
  logger: Logger
): () => void {
  const ws = internals(workspace);
  const original = ws.openLinkText;

  if (typeof original !== "function") {
    logger.warn("workspace.openLinkText is unavailable; link-open modes are disabled.");
    return () => {};
  }

  const bound = original.bind(workspace) as OpenLinkTextFn;
  ws.openLinkText = makePatched(bound);
  logger.debug("Patched workspace.openLinkText for link-open modes.");

  return () => {
    ws.openLinkText = original;
    logger.debug("Restored original workspace.openLinkText.");
  };
}

/** Whether a leaf's container element contains the given node. */
export function leafContainerContains(leaf: WorkspaceLeaf, node: Node): boolean {
  const container = (leaf as unknown as LeafInternals).containerEl;
  return container instanceof HTMLElement && container.contains(node);
}

/**
 * Create a new leaf by splitting `sourceLeaf`. Returns null (with a logged
 * warning) if the internal is unavailable, so the caller can fall back.
 */
export function createLeafBySplit(
  workspace: Workspace,
  sourceLeaf: WorkspaceLeaf,
  direction: SplitDirection,
  before: boolean,
  logger: Logger
): WorkspaceLeaf | null {
  const split = internals(workspace).createLeafBySplit;
  if (typeof split !== "function") {
    logger.warn("workspace.createLeafBySplit is unavailable; cannot open link in a side pane.");
    return null;
  }
  return split(sourceLeaf, direction, before);
}
