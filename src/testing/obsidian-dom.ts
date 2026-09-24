/**
 * The helpers Obsidian adds to every element — `createDiv`, `addClass`,
 * `setText` and the rest — for a test running in happy-dom, which has none of
 * them. Only what the pane's drawing code calls, with Obsidian's meaning.
 */

interface ElementOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean>;
}

/** Obsidian's own declarations of these are overloaded; the stand-ins are
 *  assigned through this looser shape and called through Obsidian's. */
type Helpers = Record<string, (this: HTMLElement, ...args: never[]) => unknown>;

function createEl(this: HTMLElement, tag: string, options: ElementOptions = {}): HTMLElement {
  const el = this.ownerDocument.createElement(tag);
  const classes = Array.isArray(options.cls) ? options.cls : (options.cls ?? "").split(" ");
  for (const cls of classes) if (cls.length > 0) el.classList.add(cls);
  if (options.text !== undefined) el.textContent = options.text;
  for (const [key, value] of Object.entries(options.attr ?? {})) {
    el.setAttribute(key, String(value));
  }
  this.appendChild(el);
  return el;
}

export function installObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Helpers;
  if (typeof proto.createDiv === "function") return;

  const helpers: Helpers = {
    createEl,
    createDiv(this: HTMLElement, options?: ElementOptions) {
      return createEl.call(this, "div", options);
    },
    createSpan(this: HTMLElement, options?: ElementOptions) {
      return createEl.call(this, "span", options);
    },
    addClass(this: HTMLElement, ...classes: string[]) {
      this.classList.add(...classes);
    },
    removeClass(this: HTMLElement, ...classes: string[]) {
      this.classList.remove(...classes);
    },
    toggleClass(this: HTMLElement, cls: string, on: boolean) {
      this.classList.toggle(cls, on);
    },
    setText(this: HTMLElement, text: string) {
      this.textContent = text;
    },
    empty(this: HTMLElement) {
      this.textContent = "";
    }
  } as unknown as Helpers;

  Object.assign(proto, helpers);
}
