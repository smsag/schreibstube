import type { EditorState } from "@codemirror/state";
import {
  type App,
  editorInfoField,
  editorLivePreviewField,
  MarkdownView,
  type Plugin
} from "obsidian";
import { createDoneTaskVisibilityExtension } from "../processors/done-task-visibility";
import { createDoneTaskReadingPostProcessor } from "../processors/done-task-visibility-reading";
import {
  type DoneTaskVisibility,
  effectiveVisibility,
  normalizeHideDoneTasks
} from "../services/done-task-visibility";

/**
 * The one thing another app may rely on. A companion app can install a CSS
 * snippet of its own that hides finished tasks, and makes it step aside while
 * `<body data-done-tasks="managed">` is set, so the two never dim or hide the
 * same line twice. The attribute is set whenever the setting is dim or hide,
 * and taken down when it is off and when the plugin unloads. Nothing else is
 * shared, and nothing here looks for the other app.
 */
export const DONE_TASKS_ATTRIBUTE = "data-done-tasks";
export const DONE_TASKS_MANAGED = "managed";

/** The dim strength, on the body so Reading view and every editor read the one value. */
export const DONE_TASK_OPACITY_VAR = "--schreibstube-done-task-dim-opacity";

const FOCUS_SETTINGS_CHANGED = "schreibstube-focus-settings-changed";

/**
 * Finished tasks dimmed or hidden, in Live Preview and Reading view.
 *
 * What a note shows is the setting unless its frontmatter says
 * `schreibstubeHideDoneTasks: false`. The editors ask on every transaction
 * and Reading view once per render, so a change is made visible by asking
 * them again: a reconfiguration for the editors, a render for the views.
 */
export class DoneTaskVisibilityController {
  /** The override each note was last drawn with, so a save that left it alone redraws nothing. */
  private readonly drawn = new Map<string, boolean | null>();

  constructor(
    private readonly app: App,
    private readonly setting: () => DoneTaskVisibility,
    private readonly dimOpacity: () => number
  ) {}

  start(plugin: Plugin): void {
    plugin.registerEditorExtension(
      createDoneTaskVisibilityExtension((state) => this.editorMode(state))
    );
    plugin.registerMarkdownPostProcessor(
      createDoneTaskReadingPostProcessor((path, frontmatter) => this.modeFor(path, frontmatter))
    );
    plugin.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        this.noteChanged(file.path, cache.frontmatter);
      })
    );
    window.addEventListener(FOCUS_SETTINGS_CHANGED, this.dress);
    plugin.register(() => this.stop());
    this.dress();
  }

  /** The setting changed: every open note may now show something else. */
  settingChanged(): void {
    this.dress();
    this.redraw(null);
  }

  stop(): void {
    window.removeEventListener(FOCUS_SETTINGS_CHANGED, this.dress);
    document.body.removeAttribute(DONE_TASKS_ATTRIBUTE);
    document.body.style.removeProperty(DONE_TASK_OPACITY_VAR);
  }

  private readonly dress = (): void => {
    const body = document.body;
    if (this.setting() === "off") {
      body.removeAttribute(DONE_TASKS_ATTRIBUTE);
      body.style.removeProperty(DONE_TASK_OPACITY_VAR);
      return;
    }
    body.setAttribute(DONE_TASKS_ATTRIBUTE, DONE_TASKS_MANAGED);
    body.style.setProperty(DONE_TASK_OPACITY_VAR, String(this.dimOpacity()));
  };

  /** Source mode shows the text as it is; so does an editor that holds no note. */
  private editorMode(state: EditorState): DoneTaskVisibility {
    if (this.setting() === "off") return "off";
    if (state.field(editorLivePreviewField, false) !== true) return "off";
    const path = state.field(editorInfoField, false)?.file?.path;
    return path === undefined ? this.setting() : this.modeFor(path, undefined);
  }

  private modeFor(path: string, frontmatter: unknown): DoneTaskVisibility {
    const setting = this.setting();
    if (setting === "off") return "off";
    const override = normalizeHideDoneTasks(
      frontmatter ?? this.app.metadataCache.getCache(path)?.frontmatter
    );
    this.drawn.set(path, override);
    return effectiveVisibility(setting, override);
  }

  /**
   * Obsidian reports every save of every note here, and the frontmatter
   * arrives parsed. Only a note that was drawn with another override is
   * drawn again; one never drawn is drawn right when it is opened.
   */
  private noteChanged(path: string, frontmatter: unknown): void {
    const before = this.drawn.get(path);
    if (before === undefined) return;
    const now = normalizeHideDoneTasks(frontmatter);
    if (now === before) return;
    this.drawn.set(path, now);
    this.redraw(path);
  }

  private redraw(path: string | null): void {
    this.app.workspace.updateOptions();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (path !== null && view.file?.path !== path) continue;
      // Also a view in Live Preview: its rendered copy is what it shows when
      // switched to reading, and rendering it now is cheaper than finding out
      // whether that switch would.
      view.previewMode.rerender(true);
    }
  }
}
