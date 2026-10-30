/**
 * A counting semaphore: at most `permits` holders at a time.
 *
 * The upstream fetches this bounds are the expensive ones — the complete
 * Title 38 document, ~2 MB on the wire and ~16 MB parsed. A request
 * budget bounds how fast those fetches START; nothing bounded how many
 * could be in flight at once. With the published image's budget (10
 * requests a second) and a fetch that can take ~45 s (a 15 s timeout and
 * two retries), steady-state concurrency reaches hundreds of fetches, and
 * each one holds a parsed document in memory.
 *
 * Waiters are served in the order they arrived, so a burst of expensive
 * requests cannot starve the one that has waited longest.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  /** Run `task` once a permit is free, releasing the permit when it ends. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      // Hand the permit straight over: the waiter is already waiting, so
      // the permit is never idle between them.
      next();
      return;
    }
    this.available += 1;
  }
}
