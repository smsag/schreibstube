/**
 * Hands every edit of a note to the review queue, with the editor's own
 * mapping of positions through it.
 *
 * Obsidian's `editor-change` says that a note changed but not where, and a
 * card that only knows its old offsets has to guess where its words went —
 * which on a word the note repeats it cannot. The change set can say exactly.
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { PositionMap } from "../services/suggestion";

export type EditListener = (path: string, editorDom: HTMLElement, map: PositionMap) => void;

export function createReviewFollowExtension(onEdit: EditListener): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const path = update.state.field(editorInfoField, false)?.file?.path;
    if (path === undefined) return;
    const changes = update.changes;
    onEdit(path, update.view.dom, (pos, assoc) => changes.mapPos(pos, assoc));
  });
}
