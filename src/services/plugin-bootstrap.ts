import type { Plugin } from "obsidian";
import { createEditorExtension } from "../processors/editor-extension";
import { createReadingPostProcessor } from "../processors/markdown-processor";
import type { SchreibstubeSettings } from "../types";

export interface BootstrapHandlers {
  onViewportFromEditor: (viewportTopLine: number) => void;
  onViewportFromReading: (payload: {
    viewportTopLine: number;
    scrollTop: number;
  }) => void;
  getSettings: () => SchreibstubeSettings;
  onActiveLeafChange: () => void;
}

export function bootstrapSchreibstubeRuntime(
  plugin: Plugin,
  handlers: BootstrapHandlers
): void {
  plugin.registerEditorExtension(
    createEditorExtension({
      onViewportUpdate: ({ viewportTopLine }) => {
        handlers.onViewportFromEditor(viewportTopLine);
      },
      getSettings: handlers.getSettings
    })
  );

  plugin.registerMarkdownPostProcessor(
    createReadingPostProcessor(({ viewportTopLine, scrollTop }) => {
      handlers.onViewportFromReading({ viewportTopLine, scrollTop });
    })
  );

  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", () => {
      handlers.onActiveLeafChange();
    })
  );
}
