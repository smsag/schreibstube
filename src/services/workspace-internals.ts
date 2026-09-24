import type { App, Editor, Menu, MenuItem, TFile, Workspace, WorkspaceLeaf } from "obsidian";
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
  updateHeader?: () => void;
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

/**
 * The editor behind a reading view's element.
 *
 * Obsidian hangs the owning `MarkdownView` off the reading view's root
 * element under `view`, which no type declares. Read here and nowhere else,
 * and absent rather than thrown when a build stops doing that.
 */
export function editorOfReadingView(el: HTMLElement): Editor | null {
  const owner = (el as unknown as { view?: { editor?: unknown } }).view;
  const editor = owner?.editor;
  return editor !== null && typeof editor === "object" ? (editor as Editor) : null;
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

interface MenuItemInternals {
  setSubmenu?: () => Menu;
}

/**
 * Turn a menu item into a submenu.
 *
 * Obsidian has had submenus since 1.4 and its own menus use them, but the API
 * has never declared `setSubmenu`, so it is treated like every other internal
 * here: feature-detected, and reported once when it is gone. The caller falls
 * back to a flat block, which is uglier but never missing.
 */
export function openSubmenu(item: MenuItem, logger: Logger): Menu | null {
  const factory = (item as unknown as MenuItemInternals).setSubmenu;

  if (typeof factory !== "function") {
    logger.warn("Menu.setSubmenu is unavailable; showing other plugins' items inline.");
    return null;
  }

  return factory.call(item);
}

/**
 * What another plugin offers printing, if it offers anything.
 *
 * A canvas drawn by a plugin is that plugin's to export: it knows which parts
 * are the drawing and which are the controls around it, which panels of a
 * carousel are hidden, and what its own colours mean. Asking it beats guessing
 * from the outside — so printing asks, and falls back to capturing the drawing
 * itself when there is nobody to ask.
 *
 * Everything here is checked before it is used. A plugin that is not installed,
 * an older version without the functions, an answer in a shape the contract
 * does not describe: each of them is simply "no export offered", which the
 * caller already handles by printing the block as its source.
 */

/**
 * The class that says this rendering is for paper.
 *
 * A canvas plugin may enrich its drawing from the network while it renders —
 * looking up the issues a node names, say. On paper that is wasted work, and on
 * a phone on mobile data it is a surprise, because printing otherwise never
 * leaves the device. The class asks for the drawing without it.
 *
 * The name is pinned here because a class cannot be imported across plugins:
 * one plugin's module exports are not reachable from another's, and this has to
 * be on the host before rendering starts. `noEnrichClass` below prefers the name
 * the plugin gives at run time, when it offers one, so a rename there does not
 * have to wait for a release here.
 */
export const NO_ENRICH_CLASS = "vizardry-no-enrich";

export interface CanvasExportOptions {
  /** The only picture a page needs; named because the contract names it. */
  format?: "png";
  /** Device pixels per CSS pixel. May come back lower than asked. */
  scale?: number;
  /** Neither side of the picture may pass this; the scale drops to fit. */
  maxEdge?: number;
  /** Draw as the light theme would, whatever the vault is set to. */
  light?: boolean;
  /** What shows through where the drawing does not paint. */
  background?: string;
  /** The canvas's own title row. Off: the note already gives the caption. */
  header?: boolean;
}

export interface CanvasExportResult {
  blob: Blob;
  width: number;
  height: number;
  /** What was actually used, which is not always what was asked for. */
  scale: number;
  format: string;
  title: string;
}

export interface CanvasSettleOptions {
  quietMs?: number;
  maxMs?: number;
}

export interface CanvasExportApi {
  version: number;
  /**
   * The name of the class above, as the plugin itself gives it.
   *
   * The contract requires this; it is optional here so that a plugin which has
   * the export but not the field still gets its canvases drawn, under the name
   * pinned above. Losing a diagram over a string that is only ever a name would
   * be a poor trade.
   */
  readonly noEnrichClass?: string;
  /** Every canvas under this element, in document order, hidden ones included. */
  getCanvases(root: HTMLElement): HTMLElement[];
  /** Resolves once the drawing has stopped changing. */
  whenSettled(el: HTMLElement, options?: CanvasSettleOptions): Promise<void>;
  exportCanvas(el: HTMLElement, options?: CanvasExportOptions): Promise<CanvasExportResult>;
}

/**
 * The lowest contract this plugin knows how to talk to.
 *
 * Compared as a floor rather than an equality: a plugin that has moved on to a
 * later version still answers the calls made here, and the calls themselves are
 * checked one by one below. A version that removed one of them is refused by
 * that check rather than by the number.
 */
export const CANVAS_EXPORT_VERSION = 1;

const CANVAS_EXPORT_METHODS = ["getCanvases", "whenSettled", "exportCanvas"] as const;

export function canvasExportApi(app: App, pluginId: string): CanvasExportApi | null {
  const api = (app as unknown as PluginsInternals).plugins?.plugins?.[pluginId]?.api;
  if (!api || typeof api !== "object") return null;

  const candidate = api as Partial<CanvasExportApi> & Record<string, unknown>;
  if (typeof candidate.version !== "number" || candidate.version < CANVAS_EXPORT_VERSION) {
    return null;
  }
  for (const method of CANVAS_EXPORT_METHODS) {
    if (typeof candidate[method] !== "function") return null;
  }
  return candidate as CanvasExportApi;
}

/**
 * Whether this is an element, without asking which window it came from.
 *
 * `instanceof HTMLElement` compares against the constructor of one document,
 * and Obsidian can put a note in a window of its own. An element from there is
 * a perfectly good element that fails that test, so the test is what it can do
 * rather than which realm made it — the same reason the plugin on the other
 * side of this contract stopped using `instanceof` for the argument it takes.
 */
export function isElementLike(value: unknown): value is HTMLElement {
  if (typeof value !== "object" || value === null) return false;
  const node = value as { nodeType?: unknown; classList?: unknown };
  return node.nodeType === 1 && typeof node.classList === "object" && node.classList !== null;
}

/**
 * The class to render under, preferring the plugin's own name for it.
 *
 * Checked before it is used like anything else from outside: the value goes
 * into a class attribute, and a string with a space in it would quietly add a
 * second class, while an empty one would leave the attribute malformed.
 */
export function noEnrichClass(api: CanvasExportApi | null): string {
  const named = api?.noEnrichClass;
  if (typeof named === "string" && /^[A-Za-z][\w-]*$/.test(named)) return named;
  return NO_ENRICH_CLASS;
}

/**
 * The answer to an export, once it has been looked at.
 *
 * Another plugin's return value is outside input like any other: the picture is
 * about to be written into a document, so "it said it succeeded" is not enough.
 * Null means the answer was not one this contract describes, which the caller
 * reports as a diagram it could not draw.
 */
export function checkExportResult(value: unknown): CanvasExportResult | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  if (!(record.blob instanceof Blob) || record.blob.size === 0) return null;

  const width = positive(record.width);
  const height = positive(record.height);
  const scale = positive(record.scale);
  if (width === null || height === null || scale === null) return null;

  // The picture is written under a name ending in .png and handed to a
  // typesetter that decodes by content. Anything else answered here would be
  // saved under the wrong name and fail the whole document rather than one
  // drawing, so it is refused while refusing is still cheap. An answer that
  // names no format is taken at its word: png is what was asked for.
  const format = record.format === undefined ? "png" : record.format;
  if (format !== "png") return null;

  return {
    blob: record.blob,
    width,
    height,
    scale,
    format,
    title: typeof record.title === "string" ? record.title : ""
  };
}

/**
 * The code a rejected export carries, for the line that records it.
 *
 * The contract rejects with a code and an English message. The code is what is
 * kept: a person reading this plugin reads German or English as they set it,
 * and the sentence they see is written here, not there.
 */
export function exportErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  return "capture-failed";
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

interface CommandsInternals {
  commands?: { commands?: Record<string, unknown> };
}

/**
 * Every command registered right now, with the icon it named.
 *
 * `app.commands` is undocumented. What comes back is only an id and an icon
 * name, each checked here, and an empty list whenever the shape is not the
 * one expected.
 */
export function registeredCommands(app: App): { id: string; icon?: unknown }[] {
  try {
    const registry = (app as unknown as CommandsInternals).commands?.commands;
    if (!registry || typeof registry !== "object") return [];

    const commands: { id: string; icon?: unknown }[] = [];
    for (const command of Object.values(registry)) {
      if (!command || typeof command !== "object") continue;
      const { id, icon } = command as { id?: unknown; icon?: unknown };
      if (typeof id === "string") commands.push({ id, icon });
    }
    return commands;
  } catch {
    return [];
  }
}

interface PluginsInternals {
  plugins?: { plugins?: Record<string, { api?: unknown } | undefined> };
}

/**
 * The Properties widget.
 *
 * Obsidian draws a note's frontmatter as rows of `.metadata-property`, each
 * carrying its key in `data-property-key`, and gives a row a menu (type, cut,
 * remove) from its icon and its name. None of that is API: the class names,
 * the attribute and the menu are read here and nowhere else, and a build that
 * renames them makes these return nothing rather than throw.
 */
const PROPERTY_ROW = ".metadata-property";
const PROPERTY_NAME_AREA = ".metadata-property-key";
const PROPERTY_VALUE_AREA = ".metadata-property-value";

/** The row whose name or icon was pressed, which is where its menu opens from. */
export function propertyRowAt(target: EventTarget | null): HTMLElement | null {
  if (!isElementLike(target)) return null;
  if (!target.closest(PROPERTY_NAME_AREA)) return null;
  const row = target.closest(PROPERTY_ROW);
  return isElementLike(row) ? row : null;
}

/** The key a row stands for, from its attribute or, failing that, its name field. */
export function propertyKeyOf(row: HTMLElement): string | null {
  const attribute = row.getAttribute("data-property-key");
  if (attribute) return attribute;
  const input = row.querySelector(`${PROPERTY_NAME_AREA} input`);
  const value = (input as { value?: unknown } | null)?.value;
  return typeof value === "string" && value !== "" ? value : null;
}

interface MetadataTypeManagerInternals {
  metadataTypeManager?: { getAssignedType?: (key: string) => unknown };
}

/**
 * The type Obsidian has assigned a key, as its own name for it.
 *
 * The row may say it; the vault-wide type registry always knows. Unknown
 * answers are left to `propertyKindOf`, which treats them as untyped.
 */
export function propertyTypeOf(app: App, row: HTMLElement, key: string): unknown {
  const fromRow = row.getAttribute("data-property-type");
  if (fromRow) return fromRow;
  const manager = (app as unknown as MetadataTypeManagerInternals).metadataTypeManager;
  return typeof manager?.getAssignedType === "function"
    ? manager.getAssignedType.call(manager, key)
    : undefined;
}

/** The editable part of a property value the element belongs to, if any. */
export function propertyFieldOf(target: EventTarget | null): HTMLElement | null {
  if (!isElementLike(target) || !target.closest(PROPERTY_VALUE_AREA)) return null;
  const editable = target.tagName === "INPUT" || target.isContentEditable;
  return editable ? target : null;
}

interface FileViewLike {
  file?: { path?: unknown } | null;
}

/**
 * The note a Properties widget belongs to.
 *
 * The widget sits in a Markdown view or in the properties sidebar, and both
 * hang the note they show off their view as `file`; for a Markdown view that
 * is API, for the sidebar it is not, so the lookup accepts either shape.
 */
export function fileShownAround(app: App, node: Node): TFile | null {
  let found: TFile | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (found || !leafContainerContains(leaf, node)) return;
    const file = (leaf.view as unknown as FileViewLike).file;
    if (file && typeof file.path === "string") found = file as TFile;
  });
  return found;
}

type MenuShow = (this: Menu, ...args: unknown[]) => unknown;

/**
 * Let the plugin add to a menu just before Obsidian shows it.
 *
 * The only way into a menu Obsidian builds for itself, such as the one on a
 * property. Both ways of showing one are wrapped, and a menu is offered to
 * `beforeShow` once even when one calls the other. What `beforeShow` decides
 * is its own business; the wrapper only guarantees that a mistake in it never
 * stops the menu from opening.
 */
export function installMenuShowHook(
  menuPrototype: object,
  beforeShow: (menu: Menu) => void,
  logger: Logger
): () => void {
  const target = menuPrototype as Record<string, unknown>;
  const names = ["showAtMouseEvent", "showAtPosition"].filter(
    (name) => typeof target[name] === "function"
  );
  if (names.length === 0) {
    logger.warn("Menu.showAtMouseEvent is unavailable; property menu entries are disabled.");
    return () => {};
  }

  const offered = new WeakSet<Menu>();
  const installed = names.map((name) => {
    const original = target[name] as MenuShow;
    const wrapped: MenuShow = function (this: Menu, ...args: unknown[]) {
      if (!offered.has(this)) {
        offered.add(this);
        try {
          beforeShow(this);
        } catch (err) {
          logger.warn("Adding to a menu failed:", err);
        }
      }
      return original.apply(this, args);
    };
    target[name] = wrapped;
    return { name, original, wrapped };
  });

  return () => {
    for (const { name, original, wrapped } of installed) {
      // Another plugin may have wrapped it again since; taking the method back
      // from under it would silently undo that plugin's change as well.
      if (target[name] === wrapped) target[name] = original;
    }
  };
}

/**
 * Redraw a leaf's tab header, so a view whose title changed shows it.
 *
 * Obsidian reads `getDisplayText()` when it sets a view's state and not
 * again; a view that moves to another subject on its own keeps the old name
 * on its tab. The redraw is a method the API has never declared, so it is
 * feature-detected like every other internal here — but not reported when
 * missing: it runs on every folder press, and a tab with last folder's name
 * is a blemish, not a failure worth a warning per press.
 */
export function refreshLeafHeader(leaf: WorkspaceLeaf): void {
  const update = (leaf as unknown as LeafInternals).updateHeader;
  if (typeof update === "function") update.call(leaf);
}
