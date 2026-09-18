/**
 * Reject a promise that takes too long.
 *
 * Both network clients need this — neither `requestUrl` nor the platform gives
 * a request timeout — so the timer bookkeeping lives here rather than being
 * repeated per client. The message is supplied by the caller so each client can
 * name what it was waiting for.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: (seconds: number) => string
): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message(Math.round(ms / 1000)))), ms);
  });
  return Promise.race([promise.finally(() => window.clearTimeout(timer)), timeout]);
}
