import type { MarkdownPostProcessor } from "obsidian";
import { t } from "../i18n";
import { REMINDER_MARK_CLASS } from "./reminder-mark";
import { renderReminderIcon } from "../ui/reminder-icon";

const REMINDER_LINK_SELECTOR = 'a[href^="obsidian://schreibstube?task="]';

/**
 * Draws the reminder link of a sent task as the Reminders mark in Reading
 * view. The anchor keeps its href, so following it still works; only what
 * it shows changes.
 */
export function createReminderMarkPostProcessor(): MarkdownPostProcessor {
  return (el) => {
    for (const anchor of Array.from(
      el.querySelectorAll<HTMLAnchorElement>(REMINDER_LINK_SELECTOR)
    )) {
      if (anchor.classList.contains(REMINDER_MARK_CLASS)) continue;
      anchor.classList.add(REMINDER_MARK_CLASS);
      anchor.setAttribute("aria-label", t().tasks.markTooltip);
      anchor.empty();
      renderReminderIcon(anchor);
    }
  };
}
