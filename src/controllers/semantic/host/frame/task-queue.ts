// The order in which the model runs what it is asked.
//
// Lives apart from `model.ts` so it can be tested: `model.ts` imports
// @huggingface/transformers at module scope, which no test environment loads.

/**
 * Runs one task at a time, the waiting ones first come first served — except
 * that a task marked `priority` goes ahead of every ordinary one still waiting.
 *
 * A search is one short passage and someone is waiting for it; a build's batch
 * is sixteen passages nobody is watching. The model cannot be interrupted, so a
 * search still waits for the batch already running — but no longer behind the
 * ones queued after it, which is where it waited while a vault build and a
 * conversation sync both had batches in line.
 */
export class TaskQueue {
  private readonly urgent: (() => Promise<void>)[] = [];
  private readonly ordinary: (() => Promise<void>)[] = [];
  private running = false;

  run<T>(task: () => Promise<T>, priority = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job = async (): Promise<void> => {
        try {
          resolve(await task());
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      (priority ? this.urgent : this.ordinary).push(job);
      void this.drain();
    });
  }

  /** How many tasks are waiting, not counting the one running. */
  get waiting(): number {
    return this.urgent.length + this.ordinary.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.urgent.shift() ?? this.ordinary.shift();
        if (!next) break;
        await next();
      }
    } finally {
      this.running = false;
    }
  }
}
