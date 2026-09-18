import { MarkdownView, Menu, Notice, type App, type TFile } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { activeLocale, t } from "../i18n";
import { propertyIconCss, propertyIconKey, withPropertyIcon } from "../services/property-icons";
import {
  propertyKindOf,
  todayForInput,
  todayStrings,
  todayValue,
  type TodayStrings
} from "../services/today-value";
import {
  fileShownAround,
  installMenuShowHook,
  isElementLike,
  propertyFieldOf,
  propertyKeyOf,
  propertyRowAt,
  propertyTypeOf
} from "../services/workspace-internals";
import { ICON_FONT_FAMILY, iconGlyph, installIconFont } from "../ui/icon-font";
import { IconPickerModal } from "../ui/icon-picker";

const STYLE_ID = "schreibstube-property-icons";

/**
 * How long after pressing a property's name its menu may open and still be
 * taken for that property's menu. Obsidian opens it on the same click; the
 * margin is for a slow phone, and short enough that an unrelated menu opened
 * afterwards is never mistaken for it.
 */
const MENU_AFTER_PRESS_MS = 1000;

/**
 * Icons for frontmatter keys and today's date in properties.
 *
 * Both hang off Obsidian's Properties widget, which has no API: the icons are a
 * stylesheet keyed on the key, and the menu entries are added to the property's
 * own menu as it opens. What the widget looks like is read in
 * `workspace-internals`; this only wires it to the settings and the vault.
 */
export class PropertyController {
  private readonly documents = new Set<Document>();
  private pressed: { row: HTMLElement; at: number } | null = null;
  /** The property field last typed in, for a command run from the palette, which takes focus. */
  private lastField: HTMLElement | null = null;
  private unhookMenu: () => void = () => {};

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly update: (patch: Partial<SchreibstubeSettings>) => Promise<void>,
    private readonly logger: Logger
  ) {}

  /** Install on a window: the main one at load, each popped-out one as it opens. */
  attach(
    win: Window,
    register: (el: Document, type: string, handler: (e: Event) => void) => void
  ): void {
    const doc = win.document;
    this.documents.add(doc);
    installIconFont(doc);
    this.writeStyles(doc);

    const remember = (event: Event) => {
      const row = propertyRowAt(event.target);
      if (row) this.pressed = { row, at: Date.now() };
    };
    register(doc, "pointerdown", remember);
    register(doc, "contextmenu", remember);
    register(doc, "focusin", (event) => {
      const field = propertyFieldOf(event.target);
      if (field) {
        this.lastField = field;
      } else if (isElementLike(event.target) && event.target.closest(".cm-editor")) {
        // Back in the note's text: the next date goes there.
        this.lastField = null;
      }
    });
  }

  /** Forget a popped-out window that closed. */
  detach(win: Window): void {
    this.documents.delete(win.document);
  }

  start(): void {
    this.unhookMenu = installMenuShowHook(
      Menu.prototype,
      (menu) => this.addPropertyItems(menu),
      this.logger
    );
  }

  stop(): void {
    this.unhookMenu();
    for (const doc of this.documents) doc.getElementById(STYLE_ID)?.remove();
    this.documents.clear();
  }

  /** Redraw the icons after the map changed, in every window. */
  refreshStyles(): void {
    for (const doc of this.documents) this.writeStyles(doc);
  }

  /** Today's date where the person is typing: a property field, or the note. */
  insertToday(): void {
    const today = this.today();
    const active = propertyFieldOf(activeDocument.activeElement);
    const field = active ?? (this.lastField?.isConnected ? this.lastField : null);
    if (field) {
      insertIntoField(field, today);
      return;
    }

    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    editor?.replaceSelection(today.text);
  }

  private addPropertyItems(menu: Menu): void {
    const pressed = this.pressed;
    this.pressed = null;
    if (!pressed || Date.now() - pressed.at > MENU_AFTER_PRESS_MS || !pressed.row.isConnected) {
      return;
    }

    const key = propertyKeyOf(pressed.row);
    if (!key) return;

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t().properties.chooseIcon)
        .setIcon("image")
        .onClick(() => this.chooseIcon(key))
    );

    const file = fileShownAround(this.app, pressed.row) ?? this.app.workspace.getActiveFile();
    const kind = propertyKindOf(propertyTypeOf(this.app, pressed.row, key));
    const current = file
      ? this.app.metadataCache.getFileCache(file)?.frontmatter?.[key]
      : undefined;
    if (todayValue(kind, current, this.today()) === undefined) return;

    menu.addItem((item) =>
      item
        .setTitle(t().properties.enterToday)
        .setIcon("calendar")
        .onClick(() => {
          void this.enterToday(file, key, kind);
        })
    );
  }

  private chooseIcon(key: string): void {
    const stored = propertyIconKey(key);
    const current = stored ? this.getSettings().propertyIcons[stored] : undefined;
    new IconPickerModal(this.app, current, (icon) => {
      // Read again: the picker may have stayed open while another key changed.
      const icons = withPropertyIcon(this.getSettings().propertyIcons, key, icon);
      void this.update({ propertyIcons: icons }).then(() => this.refreshStyles());
    }).open();
  }

  private async enterToday(
    file: TFile | null,
    key: string,
    kind: ReturnType<typeof propertyKindOf>
  ): Promise<void> {
    if (!file) {
      new Notice(t().common.notice(t().properties.noNote));
      return;
    }
    const today = this.today();
    try {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          const value = todayValue(kind, frontmatter[key], today);
          if (value !== undefined) frontmatter[key] = value;
        }
      );
    } catch (err) {
      this.logger.error("Entering today's date failed:", err);
      new Notice(
        t().common.notice(err instanceof Error ? err.message : t().proofread.unknownError)
      );
    }
  }

  private today(): TodayStrings {
    return todayStrings(new Date(), this.getSettings().dateFormat, activeLocale());
  }

  private writeStyles(doc: Document): void {
    const css = propertyIconCss(this.getSettings().propertyIcons, iconGlyph, ICON_FONT_FAMILY);
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }
    style.textContent = css;
  }
}

/**
 * Put the date where the caret is, the way typing would.
 *
 * The widget saves on its own input events, so the change has to arrive as one:
 * written behind its back, the field would show the date and the note would not
 * have it. Editable text goes through the browser's own insert, which also keeps
 * the date on the field's undo stack. A date input takes only ISO and is
 * replaced whole.
 */
function insertIntoField(field: HTMLElement, today: TodayStrings): void {
  field.focus();

  if (field.tagName === "INPUT") {
    const input = field as HTMLInputElement;
    if (input.type === "date" || input.type === "datetime-local") {
      input.value = todayForInput(input.type, today);
    } else {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.setRangeText(today.text, start, end, "end");
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  // Deprecated as a standard, yet the only insert that Chromium and WebKit
  // both treat as typing: native input event, undo step and caret included.
  field.ownerDocument.execCommand("insertText", false, today.text);
}
