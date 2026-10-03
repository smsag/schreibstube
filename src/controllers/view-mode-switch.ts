import type { MarkdownView } from "obsidian";
import { switchedViewMode } from "../services/view-mode";
import type { Logger } from "../services/logger";

/**
 * Switches a note between Reading view and Live Preview, keeping the place.
 *
 * The place is the view's ephemeral state: the line at the top of the screen,
 * and in the editor the cursor. Obsidian counts the scroll in lines in both
 * modes, so the passage that was on screen is the one that comes back. Set
 * again after the switch, because a mode change scrolls the view itself.
 * No history entry: Back should leave the note, not undo a change of view.
 */
export async function switchReadingEditing(view: MarkdownView, logger: Logger): Promise<void> {
  const place = view.getEphemeralState();
  const target = switchedViewMode(view.getState());
  try {
    await view.setState({ ...view.getState(), ...target }, { history: false });
    view.setEphemeralState(place);
  } catch (error) {
    logger.warn("Could not switch between reading and editing:", error);
  }
}
