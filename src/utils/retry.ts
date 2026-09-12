/**
 * Retrying work that is safe to repeat.
 *
 * A publish is dozens of requests over a domestic connection, and one dropped
 * one used to fail the whole command even though the next run would have
 * resumed for free. Uploads are addressed by the hash of their content, so
 * repeating one is either a no-op or the same write again — the one shape of
 * request where a retry cannot make things worse.
 *
 * Backoff is exponential with jitter, because a bridge that just refused three
 * uploads does not need all three back at the same moment.
 */

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  /** Injected so tests do not wait, and so the jitter is reproducible. */
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(
  work: () => Promise<T>,
  {
    attempts = 3,
    baseMs = 500,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    onRetry
  }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isWorthRetrying(error)) throw error;

      onRetry?.(attempt, error);
      await wait(backoffMs(attempt, baseMs, random));
    }
  }

  throw lastError;
}

export function backoffMs(attempt: number, baseMs: number, random: () => number): number {
  const window = baseMs * 2 ** (attempt - 1);
  return Math.round(window / 2 + window * random() * 0.5);
}

/**
 * Which failures are worth a second attempt.
 *
 * A refused token or a rejected path will be refused again; repeating it only
 * delays the message. What is worth repeating is the connection that did not
 * complete, and the bridge that was briefly busy or restarting.
 */
export function isWorthRetrying(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(401|403|400|404|409|413)\b/.test(message)) return false;
  if (/token|unauthorized|not allowed|refused the/i.test(message)) return false;

  return /timed out|timeout|did not respond|did not accept|network|socket|ECONN|EPIPE|ETIMEDOUT|fetch failed|502|503|504|restarting|busy/i.test(
    message
  );
}
