/**
 * A notice with one action in it: the explorer's undo, a property set offered
 * when a note lacks the keys a feature needs.
 *
 * A word at the end of the line rather than a button: the notice is already a
 * box, and Obsidian's own notices put their actions the same way. It stays as
 * long as it is given, and goes the moment the action is taken.
 */
import { Notice } from "obsidian";

export function showActionNotice(
  message: string,
  label: string,
  onAction: () => void,
  durationMs: number
): void {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(document.createTextNode(message));
  const action = fragment.appendChild(document.createElement("span"));
  action.className = "schreibstube-notice-action";
  action.setAttribute("role", "button");
  action.setAttribute("tabindex", "0");
  action.textContent = label;

  const notice = new Notice(fragment, durationMs);
  const take = (): void => {
    notice.hide();
    onAction();
  };
  action.addEventListener("click", take);
  action.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      take();
    }
  });
}
