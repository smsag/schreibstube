/**
 * Which open notes go without the Recommended footer, and for how long.
 *
 * A note made to start writing in is empty, and recommendations for an empty
 * note are noise under the cursor. So the note the new-note command opens is
 * shown without the footer — once. The hold belongs to the view the note
 * first appears in, and lasts while that view shows that note: through a
 * rename, which keeps the file, and through a switch to Reading view. It ends
 * when the view moves to another note or closes; opening the note again,
 * anywhere, brings the footer as usual.
 *
 * Generic over the view and the file so it can be tested without Obsidian;
 * both are compared by identity, which is what makes a rename harmless.
 */
export class FooterHold<View, File> {
  /** Notes about to be opened without a footer, not yet seen in a view. */
  private readonly pending = new Set<File>();
  /** The view each held note appeared in, and the note it holds. */
  private readonly held = new Map<View, File>();

  /** Open this note without the footer, in the next view that shows it. */
  hold(file: File): void {
    this.pending.add(file);
  }

  /**
   * Give up a hold that no view has claimed.
   *
   * The note may never have reached a view with a footer — the footer is in
   * the sidebar, or the open failed — and a hold left waiting would take the
   * footer from the note whenever it was next opened, which is the one time
   * it must be there.
   */
  release(file: File): void {
    this.pending.delete(file);
  }

  /** Whether this view, showing this file, goes without the footer. */
  isHeld(view: View, file: File | null): boolean {
    const claimed = this.held.get(view);
    if (claimed !== undefined) {
      if (claimed === file) return true;
      // The view moved on to another note: the hold was for the first one.
      this.held.delete(view);
    }
    if (file === null || !this.pending.delete(file)) return false;
    this.held.set(view, file);
    return true;
  }

  /** End the holds of every view not among these, the ones still open. */
  keepOnly(views: ReadonlySet<View>): void {
    for (const view of [...this.held.keys()]) {
      if (!views.has(view)) this.held.delete(view);
    }
  }
}
