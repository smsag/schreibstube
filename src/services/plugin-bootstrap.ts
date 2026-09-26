import type { Plugin } from "obsidian";
import { createEditorExtension } from "../processors/editor-extension";
import { createReadingPostProcessor } from "../processors/markdown-processor";
import { createTaskBadgeExtension } from "../processors/task-badges";
import { createTaskFoldExtension } from "../processors/task-fold";
import { createTaskFoldPostProcessor } from "../processors/task-fold-reading";
import { registerTaskRibbon } from "../processors/task-ribbon";
import { registerSlideshow } from "../processors/slideshow";
import type { SchreibstubeSettings } from "../types";

export interface BootstrapHandlers {
  onViewportFromEditor: (viewportTopLine: number) => void;
  onViewportFromReading: (payload: { viewportTopLine: number; scrollTop: number }) => void;
  getSettings: () => SchreibstubeSettings;
  onActiveLeafChange: () => void;
}

export function bootstrapSchreibstubeRuntime(plugin: Plugin, handlers: BootstrapHandlers): void {
  plugin.registerEditorExtension(
    createEditorExtension({
      onViewportUpdate: ({ viewportTopLine }) => {
        handlers.onViewportFromEditor(viewportTopLine);
      },
      getSettings: handlers.getSettings
    })
  );

  plugin.registerEditorExtension(createTaskBadgeExtension());
  plugin.registerEditorExtension(createTaskFoldExtension());
  plugin.registerMarkdownPostProcessor(createTaskFoldPostProcessor());
  registerTaskRibbon(plugin);
  registerSlideshow(plugin);

  const reading = createReadingPostProcessor(({ viewportTopLine, scrollTop }) => {
    handlers.onViewportFromReading({ viewportTopLine, scrollTop });
  });
  plugin.registerMarkdownPostProcessor(reading.processor);
  plugin.register(reading.dispose);

  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", () => {
      handlers.onActiveLeafChange();
    })
  );
}
