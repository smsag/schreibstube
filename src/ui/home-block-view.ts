/**
 * The ```schreibstube-home``` block as it stands on the start page: each
 * section a heading and its rows, the actions a line of buttons.
 *
 * Which sections there are, in what order and how many rows each keeps is
 * decided in `services/home-block`; what the rows hold is gathered by the
 * controller. This file only draws the answer and reports the presses.
 */
import { Keymap, setIcon } from "obsidian";
import { t } from "../i18n";
import type { Bookmark } from "../services/bookmark-file";
import type { DueLabel } from "../services/due-date";
import type { HomeAction, HomeModel, HomeRow, HomeSectionModel } from "../services/home-block";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import { drawBookmarkIcon } from "./bookmark-icon";
import { drawDueDate } from "./due-date-label";
import { pressable, type PressHandler } from "./pressable";

export const HOME_CLASS = "schreibstube-home";

/** The icon each button wears: the one Obsidian's empty tab gives it. */
const ACTION_ICONS: Readonly<Record<HomeAction, string>> = {
  "new-note": "file-plus",
  "go-to-file": "search",
  "new-base": "layout-list",
  "new-canvas": "layout-dashboard"
};

export interface HomeActions {
  run(action: HomeAction): void;
  openBookmark(bookmark: Bookmark): void;
  /** The plugin icon an `obsidian://` bookmark wears, if any. */
  bookmarkPluginIcon(bookmark: Bookmark): string | null;
  open(path: string, where: PaneTarget): void;
}

export function drawHome(container: HTMLElement, model: HomeModel, actions: HomeActions): void {
  container.empty();
  container.addClass(HOME_CLASS);

  for (const section of model.sections) {
    const el = container.createDiv({ cls: `${HOME_CLASS}-section` });
    el.dataset.section = section.kind;
    drawSection(el, section, actions);
  }

  if (model.unreadable.length > 0) {
    container.createDiv({
      cls: `${HOME_CLASS}-hint`,
      text: t().startPage.unreadable(model.unreadable)
    });
  }
}

function drawSection(el: HTMLElement, section: HomeSectionModel, actions: HomeActions): void {
  const words = t();
  switch (section.kind) {
    case "actions":
      heading(el, words.startPage.sections.actions);
      drawActions(el, section.actions, actions);
      return;
    case "bookmarks": {
      heading(el, words.explorer.sections.bookmarks);
      if (section.missingFile !== null) {
        empty(el, words.explorer.bookmarks.missingFile(section.missingFile));
        return;
      }
      if (section.bookmarks.length === 0) {
        empty(el, words.explorer.bookmarks.empty);
        return;
      }
      const list = el.createDiv({ cls: `${HOME_CLASS}-list` });
      for (const bookmark of section.bookmarks) {
        const row = rowEl(list, bookmark.name);
        drawBookmarkIcon(
          row.createSpan({ cls: `${HOME_CLASS}-icon` }),
          bookmark,
          actions.bookmarkPluginIcon(bookmark)
        );
        row.createSpan({ cls: `${HOME_CLASS}-name`, text: bookmark.name });
        press(row, () => actions.openBookmark(bookmark));
      }
      return;
    }
    case "updated":
      heading(el, words.explorer.sections.latest);
      if (section.rows.length === 0) empty(el, words.explorer.latest.empty);
      else drawNotes(el, section.rows, actions);
      return;
    case "due":
      heading(el, words.startPage.sections.due);
      if (section.rows.length === 0) empty(el, words.startPage.noDue);
      else drawNotes(el, section.rows, actions);
      return;
  }
}

function heading(el: HTMLElement, text: string): void {
  el.createDiv({ cls: `${HOME_CLASS}-heading`, text });
}

function empty(el: HTMLElement, text: string): void {
  el.createDiv({ cls: `${HOME_CLASS}-empty`, text });
}

function drawActions(el: HTMLElement, list: HomeAction[], actions: HomeActions): void {
  const bar = el.createDiv({ cls: `${HOME_CLASS}-actions` });
  for (const action of list) {
    const label = t().startPage.actions[action];
    const button = bar.createEl("button", { cls: `${HOME_CLASS}-action` });
    setIcon(button.createSpan({ cls: `${HOME_CLASS}-icon` }), ACTION_ICONS[action]);
    button.createSpan({ text: label });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      actions.run(action);
    });
  }
}

function drawNotes(
  el: HTMLElement,
  rows: ReadonlyArray<HomeRow & { label?: DueLabel }>,
  actions: HomeActions
): void {
  const list = el.createDiv({ cls: `${HOME_CLASS}-list` });
  for (const row of rows) {
    const rowElement = rowEl(list, row.name);
    rowElement.dataset.path = row.path;
    rowElement.createSpan({ cls: `${HOME_CLASS}-name`, text: row.name });
    drawDueDate(rowElement, row.label ?? null);
    press(rowElement, (event) => actions.open(row.path, openTargetOf(Keymap.isModEvent(event))));
  }
}

function rowEl(list: HTMLElement, name: string): HTMLElement {
  return list.createDiv({
    cls: `${HOME_CLASS}-row`,
    attr: { role: "link", tabindex: "0", "aria-label": name }
  });
}

/**
 * A press on a row: a click or the keyboard, as everywhere in the plugin,
 * and a middle click, which opens a tab as it does on a link.
 */
function press(el: HTMLElement, run: PressHandler): void {
  pressable(el, run, { stop: true });
  el.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    run(event);
  });
}
