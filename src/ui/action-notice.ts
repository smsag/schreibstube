/**
 * A notice with an action in it: the explorer's undo, a property set offered
 * when a note lacks the keys a feature needs, a plugin asking to be read.
 *
 * A word at the end of the line rather than a button: the notice is already a
 * box, and Obsidian's own notices put their actions the same way. It stays as
 * long as it is given, and goes the moment the action is taken.
 */
import { Notice } from "obsidian";
import { pressable } from "./pressable";

export function showActionNotice(
  message: string,
  label: string,
  onAction: () => void,
  durationMs: number
): void {
  showChoiceNotice(message, [{ label, run: onAction }], durationMs);
}

/**
 * A notice with several actions, for a question that has more than one
 * answer. A duration of 0 keeps it until one is taken or the notice itself is
 * pressed away, which is the answer "not now".
 */
export function showChoiceNotice(
  message: string,
  actions: readonly { label: string; run: () => void }[],
  durationMs: number
): void {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(document.createTextNode(message));
  const buttons = actions.map(({ label }) => {
    const action = fragment.appendChild(document.createElement("span"));
    action.className = "schreibstube-notice-action";
    action.setAttribute("role", "button");
    action.setAttribute("tabindex", "0");
    action.textContent = label;
    return action;
  });
  const notice = new Notice(fragment, durationMs);
  buttons.forEach((button, i) => {
    pressable(button, () => {
      notice.hide();
      actions[i]?.run();
    });
  });
}
