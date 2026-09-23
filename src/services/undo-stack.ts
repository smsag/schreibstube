/**
 * The one thing the pane can take back.
 *
 * A move and a delete are the two actions in the file pane that a wrong tap
 * turns into a search. Both are reversible for a while — a moved file can be
 * moved back, and a file in the vault's own trash can be taken out of it —
 * so the pane remembers the last one and offers to undo it.
 *
 * One action, not a history. The pane is a list beside a note, not an
 * editor; what is wanted is "no, not that" a moment after, and a stack of
 * old moves to walk back through would be a feature nobody asked for, with
 * ways to go wrong nobody would forgive. And it expires: an undo offered ten
 * minutes later, after other things have changed, is a surprise rather than
 * a rescue.
 */

export interface MoveStep {
  from: string;
  to: string;
}

export interface DeleteStep {
  /** The vault path the item had. */
  from: string;
  /** Where the trash put it, as the adapter names it. */
  trashedTo: string;
}

export type UndoableAction =
  { kind: "move"; steps: MoveStep[] } | { kind: "delete"; steps: DeleteStep[] };

/**
 * How long an undo is offered.
 *
 * Long enough to read the notice, think "no", and reach for it. Short
 * enough that by the time it is gone, the person has moved on and so has
 * the vault.
 */
export const UNDO_WINDOW_MS = 30_000;

export class UndoStack {
  private last: { action: UndoableAction; at: number } | null = null;

  constructor(private readonly windowMs: number = UNDO_WINDOW_MS) {}

  /** Remember an action. Whatever was remembered before is forgotten. */
  push(action: UndoableAction, now: number): void {
    // An action with nothing in it is not one anyone would want back.
    if (action.steps.length === 0) return;
    this.last = { action, at: now };
  }

  /** The action that could be undone right now, without taking it. */
  peek(now: number): UndoableAction | null {
    if (this.last === null) return null;
    if (now - this.last.at > this.windowMs) {
      this.last = null;
      return null;
    }
    return this.last.action;
  }

  /** Take the action to undo it. It cannot be taken twice. */
  take(now: number): UndoableAction | null {
    const action = this.peek(now);
    this.last = null;
    return action;
  }

  /**
   * Take `action`, but only while it is still the one on offer.
   *
   * A notice offers to undo the action it announced. If another action has
   * happened since, that notice's Undo must not undo the newer one — a
   * "put back the file I deleted" that instead reverses a move nobody asked
   * about is worse than doing nothing. Null then, and the caller says so.
   */
  takeIf(action: UndoableAction, now: number): UndoableAction | null {
    if (this.peek(now) !== action) return null;
    this.last = null;
    return action;
  }

  clear(): void {
    this.last = null;
  }
}
