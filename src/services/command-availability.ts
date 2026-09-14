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
  | "rename-note"
  | "rename-image"
  | "summarize"
  | "check-source"
  | "send-mail"
  | "fetch-replies"
  | "print"
  | "collapse-explorer"
  | "send-reminder";

/** What the screen says, reduced to what the answers depend on. */
export interface CommandContext {
  /** A Markdown note is open in an editor. */
  markdown: boolean;
  /** The open file is a picture a vision model can be shown. */
  image: boolean;
  /** Something is selected in the editor. */
  selection: boolean;
  /** The open note names a source in its frontmatter. */
  bound: boolean;
  /** The pane is open somewhere in the workspace. */
  explorerOpen: boolean;
  /** The cursor is on a task line. */
  task: boolean;
  /** Running where Apple's Reminders exists: macOS or iOS. */
  apple: boolean;
}

export function commandAvailable(command: GatedCommand, context: CommandContext): boolean {
  switch (command) {
    // Both renames read the file that is open, and only one kind of file each.
    case "rename-note":
      return context.markdown;
    case "rename-image":
      return context.image;
    // There is nothing to summarize without a selection, and the command's own
    // refusal for that was a notice telling people to do what they had come to
    // the palette to do.
    case "summarize":
      return context.markdown && context.selection;
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
    case "collapse-explorer":
      return context.explorerOpen;
    // A reminder is made from the task under the cursor, and only where there
    // is a Reminders app to receive it. Whether the feature is switched on is
    // a setting, which is not visible here, so that refusal belongs to the
    // command.
    case "send-reminder":
      return context.markdown && context.task && context.apple;
  }
}
