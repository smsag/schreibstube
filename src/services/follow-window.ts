/**
 * Whether the file pane follows a note that just became active.
 *
 * The pane follows the open note so that it answers "where am I": open a
 * note by any route and its row is on screen. A note in a popped-out window
 * is not where the person is looking, though. The pane sits in the main
 * window, and a reveal there for a note in another one scrolls a list the
 * person cannot see, and each time that window is focused it scrolls it
 * again, over whatever they had arranged. So the pane follows a note only
 * in its own window.
 *
 * The windows are compared by identity, whatever they are. A caller that
 * cannot tell which window the note is in passes null, and the pane follows
 * as it always has: not knowing is not a reason to stop.
 */
export function followsNoteInWindow(noteWindow: object | null, paneWindow: object): boolean {
  return noteWindow === null || noteWindow === paneWindow;
}
