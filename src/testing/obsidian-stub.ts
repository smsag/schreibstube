/**
 * Enough of Obsidian's module to load a controller in a test.
 *
 * `obsidian` is a types-only dependency: there is no runtime module to import,
 * which is why the controllers had no tests at all. This stub gives them one,
 * with the smallest surface each controller actually touches — a fake that
 * grows only when a test needs it to.
 */

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number };
  parent: TFolder | null = null;

  constructor(path: string, ctime = Date.UTC(2026, 8, 12)) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.includes(".") ? (this.name.split(".").pop() ?? "") : "";
    this.stat = { ctime, mtime: ctime, size: 0 };
  }
}

/** Obsidian's reading of a note's tags, `#` included; the fake keeps them as
 *  a plain list on the cache so a test can say which tags a note carries. */
export function getAllTags(cache: { tags?: unknown } | null): string[] | null {
  return Array.isArray(cache?.tags) ? (cache.tags as string[]) : null;
}

/** Obsidian's reading of a press: a middle click or Cmd/Ctrl asks for a tab,
 *  and nothing else for anything but the current pane. */
export const Keymap = {
  isModEvent(event?: UIEvent | null): false | "tab" {
    const e = event as (MouseEvent & KeyboardEvent) | null | undefined;
    if (!e) return false;
    return e.button === 1 || e.metaKey || e.ctrlKey ? "tab" : false;
  }
};

export class TFolder {
  name: string;
  children: (TFile | TFolder)[] = [];

  constructor(public path: string) {
    this.name = path.split("/").pop() ?? path;
  }
}

/** A lifetime to hang rendered children on; a test has nothing to release. */
export class Component {
  unload(): void {}
}

/** A layout for Bases: a test sets `data` as a query would and calls `onDataUpdated`. */
export class BasesView extends Component {
  data: unknown = null;

  constructor(_controller: unknown) {
    super();
  }
}

export interface StubMenuItem {
  title: string;
  icon: string | null;
  click: ((event: MouseEvent) => void) | null;
}

/** Every menu shown since the test began, the latest last. */
export const shownMenus: Menu[] = [];

/** A menu that remembers its items, so a test can read and press them. */
export class Menu {
  items: StubMenuItem[] = [];

  addItem(build: (item: unknown) => unknown): this {
    const entry: StubMenuItem = { title: "", icon: null, click: null };
    const item = {
      setTitle(title: string) {
        entry.title = title;
        return item;
      },
      setIcon(icon: string) {
        entry.icon = icon;
        return item;
      },
      onClick(click: (event: MouseEvent) => void) {
        entry.click = click;
        return item;
      }
    };
    build(item);
    this.items.push(entry);
    return this;
  }

  addSeparator(): this {
    return this;
  }

  onHide(): void {}

  showAtMouseEvent(): this {
    shownMenus.push(this);
    return this;
  }

  showAtPosition(): this {
    shownMenus.push(this);
    return this;
  }
}

/** Nothing renders in a test; a controller that draws is tested without drawing. */
export const MarkdownRenderer = {
  render: async (): Promise<void> => {}
};

/** Notices are recorded rather than shown, so a test can assert what was said. */
export class Notice {
  static shown: string[] = [];

  constructor(
    public message: string,
    public duration?: number
  ) {
    Notice.shown.push(message);
  }

  setMessage(message: string): void {
    this.message = message;
    Notice.shown.push(message);
  }

  hide(): void {}
}

export class Modal {
  constructor(public app: unknown) {}
  open(): void {}
  close(): void {}
}

export class SuggestModal<T> extends Modal {
  setPlaceholder(_text: string): void {}
  getSuggestions(_query: string): T[] {
    return [];
  }
}

export class PluginSettingTab {
  constructor(
    public app: unknown,
    public plugin: unknown
  ) {}
}

export class Setting {
  constructor(public containerEl: unknown) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addToggle(): this {
    return this;
  }
  addButton(): this {
    return this;
  }
  addDropdown(): this {
    return this;
  }
  addSlider(): this {
    return this;
  }
  addTextArea(): this {
    return this;
  }
  addComponent(): this {
    return this;
  }
}

export class SecretComponent {
  constructor(
    public app: unknown,
    public el: unknown
  ) {}
  setValue(): this {
    return this;
  }
  onChange(): this {
    return this;
  }
}

export class MarkdownView {}
export class ItemView {}

/** Tests run where no Obsidian is; a test that cares sets the flags it needs. */
export const Platform = {
  isDesktopApp: false
};

export class MarkdownRenderChild {
  constructor(public containerEl: unknown) {}
}

export class Plugin {
  constructor(
    public app: unknown,
    public manifest: unknown = { id: "schreibstube", dir: ".obsidian/plugins/schreibstube" }
  ) {}
}

/** Icons the plugin registered, so a test can assert what was handed over. */
export const registeredIcons = new Map<string, string>();

export function addIcon(id: string, svg: string): void {
  registeredIcons.set(id, svg);
}

/** The icon names Obsidian ships. A test that cares sets this. */
export let iconIds: string[] = [];

export function setIconIds(ids: string[]): void {
  iconIds = ids;
}

export function getIconIds(): string[] {
  return iconIds;
}

/**
 * Draws an icon Obsidian knows — one it ships (`iconIds`) or one a plugin
 * registered (`registeredIcons`) — as an `<svg data-icon>`, and leaves the
 * element empty for any other name, which is what Obsidian does.
 */
export function setIcon(el: HTMLElement, name: string): void {
  el.textContent = "";
  if (!iconIds.includes(name) && !registeredIcons.has(name)) return;
  const svg = el.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-icon", name);
  el.appendChild(svg);
}

/** Obsidian's tooltip, kept where a test can read it; Obsidian also labels the element. */
export function setTooltip(el: HTMLElement, tooltip: string): void {
  el.setAttribute("aria-label", tooltip);
}

/** Obsidian's frontmatter split: the YAML between the opening fences, and where the body starts. */
export function getFrontMatterInfo(content: string): {
  exists: boolean;
  frontmatter: string;
  contentStart: number;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { exists: false, frontmatter: "", contentStart: 0 };
  return { exists: true, frontmatter: match[1] ?? "", contentStart: match[0].length };
}

export { parse as parseYaml } from "yaml";

export const requestUrl = async (): Promise<never> => {
  throw new Error("requestUrl is not available in tests; mock the client module instead.");
};

/** Obsidian lends its Mermaid to plugins; a test that draws hands in its own. */
export const loadMermaid = async (): Promise<never> => {
  throw new Error("loadMermaid is not available in tests; hand the renderer a fake.");
};

/** Obsidian lends its pdf.js to plugins; no test has a real one to lend. */
export const loadPdfJs = async (): Promise<never> => {
  throw new Error("loadPdfJs is not available in tests; inject a reader instead.");
};

/** The base of an editor popup. A test never opens one; the class only has
 *  to exist so a suggest that extends it can be imported. */
export class EditorSuggest<T> {
  context: unknown = null;
  limit = 0;
  constructor(public app: unknown) {}
  setInstructions(): void {}
  close(): void {}
  getSuggestions(_context: unknown): T[] {
    return [];
  }
}

/** Obsidian's path clean-up, as far as the tests need it: one kind of slash,
 *  no doubles, none at either end. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}
