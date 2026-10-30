/**
 * A counting semaphore: at most `permits` holders at a time.
 *
 * The upstream fetches this bounds are the expensive ones — the complete
 * Title 38 document, ~2 MB on the wire and ~16 MB parsed. A request
 * budget bounds how fast those fetches START; nothing bounded how many
 * could be in flight at once. With the published image's budget (10
 * requests a second) and a fetch that can take ~45 s (a 15 s timeout and
 * two retries), steady-state concurrency reaches hundreds of requests in
 * flight — and twice that many document fetches, because a diff or a
 * redline pulls two documents — and each one holds a parsed document in
 * memory.
 *
 * Waiters are served in the order they arrived, so a burst of expensive
 * requests cannot starve the one that has waited longest.
 *
 * The WAITING side is bounded too. A permit bounds the fetches that RUN,
 * but nothing bounded the requests parked behind them, and that queue is
 * where the unbounded growth lived: the limiter admits about one
 * expensive request a second per peer, the four permits retire a document
 * every ~11 s at worst, so the queue grew without limit. A full queue
 * refuses the request at once (`SemaphoreOverflowError`) instead of
 * parking it for minutes — the request could not be served in any
 * reasonable time anyway, and a fast refusal is the honest answer.
 */

/**
 * How many waiters may park behind the permits before further requests
 * are refused. Four permits at a time, sixteen waiting: the queue holds
 * the equivalent of a handful of peers' bursts and no more.
 */
export const DEFAULT_MAX_WAITERS = 16;

/**
 * Thrown when the semaphore's wait queue is full: the request was
 * refused rather than parked behind the in-flight fetches.
 */
export class SemaphoreOverflowError extends Error {
  override readonly name = 'SemaphoreOverflowError';
  constructor(maxWaiters: number) {
    super(`too many requests in flight — ${maxWaiters} upstream fetches are already waiting`);
  }
}

export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  private readonly maxWaiters: number;

  constructor(permits: number, maxWaiters: number = DEFAULT_MAX_WAITERS) {
    this.available = Math.max(1, permits);
    this.maxWaiters = Math.max(0, maxWaiters);
  }

  /**
   * Run `task` once a permit is free, releasing the permit when it ends.
   *
   * @throws {SemaphoreOverflowError} when the wait queue is full — the
   *   task never runs and no permit is taken.
   */
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
    // The queue is full: refuse now instead of parking the request
    // behind a fetch that may take the best part of a minute.
    if (this.waiters.length >= this.maxWaiters) {
      throw new SemaphoreOverflowError(this.maxWaiters);
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
