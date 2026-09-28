/**
 * Schreibstube's controls at the foot of Obsidian's Properties widget, beside
 * its own "Add property": "Add set", "Suggest tags".
 *
 * The widget has no API for this. It is found by its class names in
 * `workspace-internals`, and Obsidian rebuilds it on edits, sometimes without
 * the controls, so each widget on screen is watched and the controls put back.
 * The watch is on the widget only, never the whole document: a keystroke in
 * the note must not cost a search of the page.
 */
import { setIcon, TFile, type App } from "obsidian";
import {
  addPropertyControls,
  fileShownAround,
  isElementLike,
  propertiesWidgets
} from "../services/workspace-internals";

/** One control, in the order they stand after "Add property". */
export interface WidgetControl {
  className: string;
  icon: string;
  label: () => string;
  ariaLabel: () => string;
  press: (file: TFile | null) => void;
}

type Register = (doc: Document, type: string, handler: (event: Event) => void) => void;

/** The widget draws after the note opens; a second look catches a slow one. */
const LATE_DECORATE_MS = 300;

export class PropertyWidgetControls {
  private readonly documents = new Set<Document>();
  /** One watch per Properties widget on screen; dropped once it is gone. */
  private readonly watches = new Map<HTMLElement, MutationObserver>();
  private lateTimer = 0;

  constructor(
    private readonly app: App,
    private readonly controls: readonly WidgetControl[]
  ) {}

  /** Install on a window: the main one at load, each popped-out one as it opens. */
  attach(win: Window, register: Register): void {
    const doc = win.document;
    this.documents.add(doc);
    register(doc, "click", (event) => this.onControl(event));
    register(doc, "keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") this.onControl(event);
    });
    this.decorate(doc);
  }

  detach(win: Window): void {
    this.documents.delete(win.document);
  }

  stop(): void {
    window.clearTimeout(this.lateTimer);
    for (const observer of this.watches.values()) observer.disconnect();
    this.watches.clear();
    for (const doc of this.documents) {
      for (const control of this.controls) {
        for (const el of Array.from(doc.querySelectorAll(`.${control.className}`))) el.remove();
      }
    }
    this.documents.clear();
  }

  /** Look for Properties widgets again, now and once more when a slow one has drawn. */
  decorateSoon(): void {
    for (const doc of this.documents) this.decorate(doc);
    window.clearTimeout(this.lateTimer);
    this.lateTimer = window.setTimeout(() => {
      for (const doc of this.documents) this.decorate(doc);
    }, LATE_DECORATE_MS);
  }

  private onControl(event: Event): void {
    const target = event.target;
    if (!isElementLike(target)) return;
    for (const control of this.controls) {
      const el = target.closest(`.${control.className}`);
      if (!isElementLike(el)) continue;
      event.preventDefault();
      event.stopPropagation();
      const file = fileShownAround(this.app, el) ?? this.app.workspace.getActiveFile();
      control.press(file instanceof TFile ? file : null);
      return;
    }
  }

  private decorate(doc: Document): void {
    for (const [widget, observer] of this.watches) {
      if (widget.isConnected) continue;
      observer.disconnect();
      this.watches.delete(widget);
    }
    for (const widget of propertiesWidgets(doc)) {
      if (!this.watches.has(widget)) {
        const observer = new MutationObserver(() => this.placeControls(widget));
        observer.observe(widget, { childList: true, subtree: true });
        this.watches.set(widget, observer);
      }
      this.placeControls(widget);
    }
  }

  /**
   * Each control after the one before it, starting from "Add property". A
   * control already in its place is left alone, so the watch that sees this
   * change finds nothing more to do.
   */
  private placeControls(root: ParentNode): void {
    for (const add of addPropertyControls(root)) {
      let anchor: Element = add;
      for (const control of this.controls) {
        const next = anchor.nextElementSibling;
        if (next?.classList.contains(control.className)) {
          anchor = next;
          continue;
        }
        const el = this.createControl(add.ownerDocument, control);
        anchor.after(el);
        anchor = el;
      }
    }
  }

  private createControl(doc: Document, control: WidgetControl): HTMLElement {
    const el = doc.createElement("div");
    // Obsidian's own look for a quiet text-and-icon control, the class its
    // "Add property" wears; the layout beside it is ours, in styles.css.
    el.className = `${control.className} schreibstube-property-control text-icon-button`;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", control.ariaLabel());
    const icon = el.appendChild(doc.createElement("span"));
    icon.className = "text-button-icon";
    setIcon(icon, control.icon);
    const label = el.appendChild(doc.createElement("span"));
    label.className = "text-button-label";
    label.textContent = control.label();
    return el;
  }
}
