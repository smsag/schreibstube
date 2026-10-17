import type { Plugin } from "obsidian";
import { createEditorExtension } from "../processors/editor-extension";
import { createReadingPostProcessor } from "../processors/markdown-processor";
import { createTaskBadgeExtension } from "../processors/task-badges";
import { createTaskFoldExtension } from "../processors/task-fold";
import { createTaskFoldPostProcessor } from "../processors/task-fold-reading";
import { registerTaskRibbon } from "../processors/task-ribbon";
import { registerNoteIndex } from "../processors/note-index";
import { registerSlideshow, type SlideshowPictureActions } from "../processors/slideshow";
import type { EditorViewportUpdate } from "../processors/editor-extension";
import type { SchreibstubeSettings } from "../types";

export interface BootstrapHandlers {
  onViewportFromEditor: (update: EditorViewportUpdate) => void;
  onViewportFromReading: () => void;
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
  registerNoteIndex(plugin);
  registerSlideshow(plugin, handlers.pictureActions);

  const reading = createReadingPostProcessor(() => {
    handlers.onViewportFromReading();
  });
  plugin.registerMarkdownPostProcessor(reading.processor);
  plugin.register(reading.dispose);
  // A closed leaf is removed with an ancestor, which no observer on the view's
  // own parent sees; the layout event is where a detached view is let go.
  plugin.registerEvent(plugin.app.workspace.on("layout-change", reading.sweep));
  // Switching a note between editing and reading is a layout change too, and
  // moves the overlay to the view now on screen.
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
