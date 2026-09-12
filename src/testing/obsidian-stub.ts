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

  constructor(path: string, ctime = Date.UTC(2026, 8, 12)) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.includes(".") ? (this.name.split(".").pop() ?? "") : "";
    this.stat = { ctime, mtime: ctime, size: 0 };
  }
}

export class TFolder {
  constructor(public path: string) {}
}

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
export class Plugin {}

export const requestUrl = async (): Promise<never> => {
  throw new Error("requestUrl is not available in tests; mock the client module instead.");
};
