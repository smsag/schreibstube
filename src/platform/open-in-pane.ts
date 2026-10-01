/**
 * Open a file where a press asked for it.
 *
 * Which pane a press means is decided in `services/pane-target`; this is the
 * one place that turns the answer into a leaf, so the phone's fallback — no
 * second window there, so the window chord asks for a tab — is not copied
 * into every surface that opens a note. A surface that needs the note in a
 * particular mode, Reading view say, hands over the view state too.
 */
import { Platform, type App, type OpenViewState, type TFile } from "obsidian";
import { availableTarget, type PaneTarget } from "../services/pane-target";

export async function openInPane(
  app: App,
  file: TFile,
  where: PaneTarget,
  state?: OpenViewState
): Promise<void> {
  const leaf = app.workspace.getLeaf(availableTarget(where, Platform.isDesktopApp));
  // Without a state the call is the one Obsidian's own explorer makes, so the
  // note opens in whatever mode the person set as their default.
  if (state) await leaf.openFile(file, state);
  else await leaf.openFile(file);
}
