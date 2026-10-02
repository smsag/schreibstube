/**
 * Which commands are worth offering, given what is on screen.
 *
 * A palette that lists everything lists most things uselessly: "check this
 * note's source" on a note bound to nothing, "rename image" with no image open.
 * Obsidian will hide a command whose check says no, and this decides the noes.
 *
 * Only conditions a person can see are allowed to hide anything. A command
 * missing because the note in front of you is not a picture explains itself;
 * one missing because a setting three tabs away is empty does not, and looks
 * like a plugin that broke. Those stay visible and say what they need when they
 * are run, which is the one moment somebody is listening.
 */

/** The commands whose usefulness depends on what is open. */
export type GatedCommand =
  | "rename"
  | "summarize"
  | "table"
  | "table-ai"
  | "proofread"
  | "insert-today"
  | "property-set"
  | "check-source"
  | "send-mail"
  | "fetch-replies"
  | "print"
  | "print-selection"
  | "base-reading"
  | "collapse-explorer"
  | "related";

/** What the screen says, reduced to what the answers depend on. */
export interface CommandContext {
  /** A Markdown note is open in an editor. */
  markdown: boolean;
  /** The open file is a base. */
  base: boolean;
  /** The open file is a picture a vision model can be shown. */
  image: boolean;
  /** Something is selected in the editor. */
  selection: boolean;
  /** An AI key is chosen and present, so the AI can be asked. */
  ai: boolean;
  /** The open note names a source in its frontmatter. */
  bound: boolean;
  /** The pane is open somewhere in the workspace. */
  explorerOpen: boolean;
}

export function commandAvailable(command: GatedCommand, context: CommandContext): boolean {
  switch (command) {
    // The rename reads the file that is open, a note or a picture.
    // Naming from the content is the AI's; without a key it cannot happen.
    case "rename":
      return context.ai && (context.markdown || context.image);
    // There is nothing to summarize without a selection, and the command's own
    // refusal for that was a notice telling people to do what they had come to
    // the palette to do.
    case "summarize":
      return context.ai && context.markdown && context.selection;
    // A table is made from selected lines. Whether they have columns a plain
    // split can find is for the command to say when run, not a reason to hide
    // it: the selection looks the same either way.
    case "table":
      return context.markdown && context.selection;
    // The same table read by the AI, offered only where the AI can be asked.
    case "table-ai":
      return context.ai && context.markdown && context.selection;
    // Proofreading sends the note to the AI. The glossary check does not, and
    // stays in the review panel either way.
    case "proofread":
      return context.ai && context.markdown;
    // A date goes into the note or one of its properties.
    case "insert-today":
      return context.markdown;
    // A set's keys go into a note's frontmatter; there is nowhere else to put them.
    case "property-set":
      return context.markdown;
    // A picture carries no links and no tags, so there is nothing to relate it
    // by. Whether the note has any neighbours is the panel's answer to give,
    // not a reason to hide the way of asking.
    case "related":
      return context.markdown;
    // A note that mirrors nothing has no source to check. Which notes are bound
    // is the note's own frontmatter, in front of the person reading it.
    case "check-source":
      return context.markdown && context.bound;
    // Mail acts on the note it is run from. Whether a mailbox is configured is
    // not visible here, so it is not asked: that refusal belongs to the command.
    case "send-mail":
    case "fetch-replies":
      return context.markdown;
    // Printing sets the note that is open. Whether a template exists is not
    // visible from the palette, so that refusal belongs to the command.
    case "print":
      return context.markdown;
    // Printing a passage needs the passage marked; what is marked is the print.
    case "print-selection":
      return context.markdown && context.selection;
    // Whether a base opens its notes for reading is said in the base's file.
    case "base-reading":
      return context.base;
    case "collapse-explorer":
      return context.explorerOpen;
  }
}

/** What the rename reads: the picture that is open, or the note. */
export function renameTarget(context: CommandContext): "image" | "note" | null {
  if (context.image) return "image";
  return context.markdown ? "note" : null;
}
