/**
 * `work` over every item, at most `limit` at a time, results in item order.
 *
 * The first failure rejects once the work already running has settled, so
 * nothing is still uploading when the caller reports the failure, and no new
 * item starts after one has failed. The bridge keeps the same helper for its
 * SFTP requests; the two sides share no code, so each has its own.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;

  const worker = async (): Promise<void> => {
    while (failure === null && next < items.length) {
      const at = next;
      next += 1;
      try {
        results[at] = await work(items[at] as T, at);
      } catch (error) {
        failure ??= { error };
      }
    }
  };

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}
