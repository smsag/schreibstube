/**
 * Deadlines for outbound work.
 *
 * Nothing the bridge talks to is under its control, and a connection that
 * neither answers nor closes would otherwise hold a request open until the
 * client gives up — leaving the socket, and any lock it holds, behind.
 */

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = "TimeoutError";
  }
}

export function withDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    // The bridge should not stay alive merely because a deadline is pending.
    timer.unref?.();
  });

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
