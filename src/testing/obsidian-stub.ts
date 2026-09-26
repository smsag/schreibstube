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
  isMacOS: false,
  isIosApp: false,
  isDesktopApp: false,
  isMobile: false
};

export class MenuItem {
  title = "";
  icon = "";
  handler: (() => void) | null = null;
  setTitle(title: string): this {
    this.title = title;
    return this;
  }
  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }
  onClick(handler: () => void): this {
    this.handler = handler;
    return this;
  }
}

export class Menu {
  items: MenuItem[] = [];
  addItem(build: (item: MenuItem) => void): this {
    const item = new MenuItem();
    build(item);
    this.items.push(item);
    return this;
  }
}
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
