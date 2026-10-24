/**
 * The Explorer filter's three waits, and which of them each event ends.
 *
 * Typing starts all three: the words' filter after a short pause, the search
 * by meaning and the sources' items after a longer one. Taking the field's
 * query now — the short pause run out, Enter, the arrow into the list — ends
 * only the words' wait. It ended all three once, and since the short pause
 * always ran out first, nothing typed was ever asked by meaning.
 */

export type FilterTimer = "filter" | "meaning" | "items";

const ALL: readonly FilterTimer[] = ["filter", "meaning", "items"];

/**
 * The waits an event ends. `type`: a keystroke, which starts them all again.
 * `apply`: the query taken now, for the words alone. `close`: the pane gone.
 */
export function timersEndedBy(event: "type" | "apply" | "close"): readonly FilterTimer[] {
  return event === "apply" ? ["filter"] : ALL;
}

export interface FilterClock {
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** One pending call per wait; starting one again replaces it. */
export class FilterTimers {
  private readonly pending = new Map<FilterTimer, number>();

  constructor(private readonly clock: FilterClock) {}

  start(name: FilterTimer, ms: number, run: () => void): void {
    this.stop(name);
    const id = this.clock.setTimeout(() => {
      this.pending.delete(name);
      run();
    }, ms);
    this.pending.set(name, id);
  }

  /** End the waits an event ends, by `timersEndedBy`. */
  end(event: "type" | "apply" | "close"): void {
    for (const name of timersEndedBy(event)) this.stop(name);
  }

  isPending(name: FilterTimer): boolean {
    return this.pending.has(name);
  }

  private stop(name: FilterTimer): void {
    const id = this.pending.get(name);
    if (id === undefined) return;
    this.clock.clearTimeout(id);
    this.pending.delete(name);
  }
}
