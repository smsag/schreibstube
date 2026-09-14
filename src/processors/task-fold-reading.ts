import type { MarkdownPostProcessor } from "obsidian";
import { bodyStartIndex } from "../services/task-fold";

export const TASK_BODY_CLASS = "schreibstube-task-body";

/**
 * Hides a ticked task's body in Reading view.
 *
 * There is no folding in rendered Markdown, so the body is wrapped in an
 * element the stylesheet hides. A tick in Reading view writes to the file and
 * Obsidian renders the section again, which runs this again, so the state on
 * screen is always the state in the file.
 */
export function createTaskFoldPostProcessor(): MarkdownPostProcessor {
  return (el) => {
    for (const item of Array.from(
      el.querySelectorAll<HTMLElement>("li.task-list-item.is-checked")
    )) {
      collapseTaskBody(item);
    }
  };
}

/**
 * A node reduced to what the decision needs: the tag of an element, `null`
 * for text, `""` for the whitespace the renderer leaves between elements.
 */
function tagsOf(nodes: NodeListOf<ChildNode>): (string | null)[] {
  return Array.from(nodes, (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).tagName;
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim() === "" ? "" : null;
    return "";
  });
}

function wrapFrom(parent: HTMLElement, start: number, wrapperTag: "div" | "span"): void {
  const nodes = Array.from(parent.childNodes);
  const wrapper = parent.ownerDocument.createElement(wrapperTag);
  wrapper.className = TASK_BODY_CLASS;
  parent.insertBefore(wrapper, nodes[start] ?? null);
  for (const node of nodes.slice(start)) wrapper.appendChild(node);
}

function collapseTaskBody(item: HTMLElement): void {
  if (item.querySelector(`:scope > .${TASK_BODY_CLASS}`)) return;

  const start = bodyStartIndex(tagsOf(item.childNodes));
  if (start >= 0) wrapFrom(item, start, "div");

  // A soft break typed with Shift+Enter in a loose list lands inside the
  // first paragraph rather than beside it, so that paragraph is split too.
  const head = Array.from(item.children).find((child) => child.tagName === "P");
  if (head instanceof HTMLElement && !head.querySelector(`:scope > .${TASK_BODY_CLASS}`)) {
    const inner = bodyStartIndex(tagsOf(head.childNodes));
    if (inner >= 0) wrapFrom(head, inner, "span");
  }
}
