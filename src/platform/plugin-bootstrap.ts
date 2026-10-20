import type { Plugin } from "obsidian";
import { createEditorExtension } from "../processors/editor-extension";
import { createTaskBadgeExtension } from "../processors/task-badges";
import { createTaskFoldExtension } from "../processors/task-fold";
import { createTaskFoldPostProcessor } from "../processors/task-fold-reading";
import { registerTaskRibbon } from "../processors/task-ribbon";
import { registerNoteIndex } from "../processors/note-index";
import { setTextWithIcons } from "../processors/icon-shortcode";
import { registerSlideshow, type SlideshowPictureActions } from "../processors/slideshow";
import type { EditorViewportUpdate } from "../processors/editor-extension";
import type { SchreibstubeSettings } from "../types";

export interface BootstrapHandlers {
  onViewportFromEditor: (update: EditorViewportUpdate) => void;
  getSettings: () => SchreibstubeSettings;
  onActiveLeafChange: () => void;
  /** The picture's own buttons for a slideshow, once the plugin has made them. */
  pictureActions: () => SlideshowPictureActions | null;
}

export function bootstrapSchreibstubeRuntime(plugin: Plugin, handlers: BootstrapHandlers): void {
  plugin.registerEditorExtension(
    createEditorExtension({
      onViewportUpdate: (update) => {
        handlers.onViewportFromEditor(update);
      },
      getSettings: handlers.getSettings
    })
  );

  plugin.registerEditorExtension(createTaskBadgeExtension());
  plugin.registerEditorExtension(createTaskFoldExtension());
  plugin.registerMarkdownPostProcessor(createTaskFoldPostProcessor());
  registerTaskRibbon(plugin);
  registerNoteIndex(plugin, (el, text) =>
    setTextWithIcons(el, text, handlers.getSettings().iconShortcodes)
  );
  registerSlideshow(plugin, handlers.pictureActions);

  // Switching a note to reading view is a layout change, and takes the
  // overlay down; switching back puts it up again.
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => {
      handlers.onActiveLeafChange();
    })
  );

  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", () => {
      handlers.onActiveLeafChange();
    })
  );
}
