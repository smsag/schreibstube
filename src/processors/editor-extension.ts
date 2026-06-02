import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

export interface EditorViewportUpdate {
  viewportTopLine: number;
}

export function createEditorExtension(
  onViewportUpdate: (update: EditorViewportUpdate) => void
): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        onViewportUpdate({
          viewportTopLine: view.state.doc.lineAt(view.viewport.from).number - 1
        });
      }

      update(update: { view: EditorView; viewportChanged: boolean; docChanged: boolean }): void {
        if (!update.viewportChanged && !update.docChanged) {
          return;
        }

        onViewportUpdate({
          viewportTopLine: update.view.state.doc.lineAt(update.view.viewport.from).number - 1
        });
      }
    }
  );
}
