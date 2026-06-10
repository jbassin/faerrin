/**
 * Bounded worker pool (plan B24). Runs `worker` over `items` with at most
 * `concurrency` in flight, so a big playlist download never blocks playback or
 * the HTTP server and never spawns hundreds of yt-dlp processes at once.
 * Pure + dependency-free → unit-testable.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  let next = 0;
  async function lane(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
}
