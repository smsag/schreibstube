/**
 * Text onto the clipboard, and a word either way.
 *
 * Every copy in the plugin says the same two things — that it worked, or that
 * the clipboard was not to be had, which on a phone or in a hardened setup is
 * ordinary rather than a bug — so the saying lives here once. The failure goes
 * to the log with what was being copied, which is the plugin's own text and
 * never a secret; a caller copying something long names it with `logAs`
 * instead, so a whole table does not land in the log.
 */
import { Notice } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";

export async function copyText(
  text: string,
  said: { copied: string; failed: string },
  logger: Logger,
  logAs: string = text
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(t().common.notice(said.copied));
  } catch (error) {
    logger.warn(`Could not copy ${logAs} to the clipboard:`, error);
    new Notice(t().common.notice(said.failed));
  }
}
