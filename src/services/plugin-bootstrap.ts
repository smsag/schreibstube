import type { Plugin } from "obsidian";
import { createEditorExtension } from "../processors/editor-extension";
import { createReadingPostProcessor } from "../processors/markdown-processor";

export interface BootstrapHandlers {
  onViewportFromEditor: (viewportTopLine: number) => void;
  onViewportFromReading: (payload: {
    viewportTopLine: number;
    scrollTop: number;
  }) => void;
  onActiveLeafChange: () => void;
  onGlobalPointerDown: (event: PointerEvent) => void;
}

export function bootstrapSchreibstubeRuntime(
  plugin: Plugin,
  handlers: BootstrapHandlers
): void {
  plugin.registerEditorExtension(
    createEditorExtension(({ viewportTopLine }) => {
      handlers.onViewportFromEditor(viewportTopLine);
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

  plugin.registerDomEvent(document, "pointerdown", (event) => {
    handlers.onGlobalPointerDown(event);
  });
}
