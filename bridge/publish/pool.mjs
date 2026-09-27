/**
 * Several SFTP requests in flight at once, over the one connection.
 *
 * A publish is hundreds of small requests, and done one after another each
 * one waits a full round trip to the web host: at ten milliseconds, three
 * hundred notes read back were twelve seconds of waiting and almost no work.
 * SFTP answers requests out of order by design, so a few can travel together.
 *
 * The limit stays small: every request the client library runs adds its own
 * listeners to the connection, and Node warns past ten of a kind.
 */
export const SFTP_CONCURRENCY = 6;

/**
 * `work` over every item, at most `limit` at a time, results in item order.
 *
 * The first failure rejects, after the requests already in flight have
 * settled, so nothing is still writing to the host when the caller hears of
 * it. No new item starts once one has failed.
 */
export async function mapLimit(items, limit, work) {
  const list = [...items];
  const results = new Array(list.length);
  let next = 0;
  let failure = null;

  async function worker() {
    while (failure === null && next < list.length) {
      const at = next;
      next += 1;
      try {
        results[at] = await work(list[at], at);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, list.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure) throw failure.error;
  return results;
}
