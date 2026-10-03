/**
 * Which way a note goes when the reader switches between reading it and
 * editing it.
 *
 * Obsidian's own toggle goes from Reading view back to whichever editor was
 * last in use, which is Source mode as often as not; a writer who wanted the
 * page as it will read, with the text editable in place, had to switch twice.
 * This switch knows two ends only: Reading view and Live Preview. Source mode
 * is not one of them, so from there it goes to Live Preview too.
 */

/** A Markdown view's mode as Obsidian keeps it: `preview` is Reading view. */
export interface NoteViewMode {
  mode: "preview" | "source";
  /** In the editor, whether it shows the raw source rather than Live Preview. */
  source: boolean;
}

export const READING_VIEW: NoteViewMode = { mode: "preview", source: false };
export const LIVE_PREVIEW: NoteViewMode = { mode: "source", source: false };

/**
 * The mode the switch goes to from the view's state as Obsidian reports it.
 *
 * The state is read as untrusted: it is a plain object any version of
 * Obsidian may shape differently. Anything that is not plainly an editor in
 * Live Preview is taken as "not yet where the writer wants to edit", and goes
 * to Live Preview; so a state the switch cannot read never lands anyone in
 * Reading view by surprise, where nothing can be typed.
 */
export function switchedViewMode(state: unknown): NoteViewMode {
  const fields =
    typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
  const inLivePreview = fields.mode === "source" && fields.source === false;
  return inLivePreview ? READING_VIEW : LIVE_PREVIEW;
}
