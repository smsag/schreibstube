import type { MarkdownPostProcessor } from "obsidian";
import { t } from "../i18n";
import { REMINDER_MARK_CLASS } from "./reminder-mark";
import { reminderIdSpan } from "../services/reminder-tasks";
import type { SchreibstubeSettings } from "../types";
import { renderReminderIcon } from "../ui/reminder-icon";

/**
 * Puts the Reminders mark after a synced task in Reading view.
 *
 * Obsidian hides a block id there, so the rendered item cannot say whether it
 * has one. The section's source can: each list item carries its line within
 * the section, and that line is read as the editor reads it.
 */
export function createReminderMarkPostProcessor(
  getSettings: () => SchreibstubeSettings
): MarkdownPostProcessor {
  return (el, ctx) => {
    const settings = getSettings();
    if (!settings.remindersEnabled) return;
    const section = ctx.getSectionInfo(el);
    if (!section) return;
    const lines = section.text.split(/\r?\n/);

    for (const item of Array.from(el.querySelectorAll<HTMLElement>("li[data-line]"))) {
      if (item.querySelector(`:scope > .${REMINDER_MARK_CLASS}`)) continue;
      const line = lines[section.lineStart + Number(item.dataset.line)];
      if (line === undefined || !reminderIdSpan(line, settings.remindersTrigger)) continue;

      const mark = item.ownerDocument.createElement("span");
      mark.className = REMINDER_MARK_CLASS;
      mark.setAttribute("aria-label", t().tasks.markTooltip);
      renderReminderIcon(mark);
      const nested = item.querySelector(":scope > ul, :scope > ol");
      item.insertBefore(mark, nested);
    }
  };
}
