/**
 * Per-peer token bucket for the HTTP API when it is deliberately exposed
 * (`CFR_ALLOW_REMOTE=1`). The API ships unauthenticated by design; a coarse
 * per-peer request budget is the only DoS guard that needs no auth story.
 * Loopback-only deployments (the default) never construct a limiter, so
 * local tooling can never throttle itself.
 */

export interface RateLimitOptions {
  /** Burst size: tokens available after a quiet period. */
  readonly capacity: number;
  /** Steady-state tokens per second of continued traffic. */
  readonly refillPerSec: number;
  /** Injectable clock (ms) for deterministic tests. */
  readonly now?: () => number;
  /** Cap on tracked peers; oldest entries are evicted first. */
  readonly maxPeers?: number;
}

export interface RateVerdict {
  readonly allowed: boolean;
  /** Seconds until a token would be available (0 when allowed). */
  readonly retryAfterSec: number;
}

const DEFAULT_MAX_PEERS = 1000;

interface Bucket {
  tokens: number;
  lastMs: number;
}

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;
  private readonly maxPeers: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimitOptions) {
    this.capacity = Math.max(1, options.capacity);
    this.refillPerSec = Math.max(0.1, options.refillPerSec);
    this.now = options.now ?? Date.now;
    this.maxPeers = Math.max(1, options.maxPeers ?? DEFAULT_MAX_PEERS);
  }

  /** Take one token for `peer`; allowed while the bucket has capacity. */
  consume(peer: string): RateVerdict {
    const nowMs = this.now();
    const bucket = this.buckets.get(peer) ?? { tokens: this.capacity, lastMs: nowMs };
    // Refill proportionally to elapsed time, capped at capacity.
    const elapsedSec = Math.max(0, (nowMs - bucket.lastMs) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastMs = nowMs;
    this.buckets.set(peer, bucket);
    if (this.buckets.size > this.maxPeers) this.prune();

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSec: 0 };
    }
    const deficit = 1 - bucket.tokens;
    return { allowed: false, retryAfterSec: deficit / this.refillPerSec };
  }

  /**
   * Drop the least-recently-seen peers once the map exceeds `maxPeers` —
   * bounding memory against peer-address floods (IPv6 spaces are huge).
   *
   * Known trade-offs, deliberate: a client rotating source addresses (a
   * single IPv6 /64 is enough) mints fresh full-capacity buckets, and
   * eviction drops a legitimate peer's accumulated spend — inherent to any
   * per-address limiter and accepted over a global bucket (which one
   * abusive peer could exhaust for everyone). Eviction sorts at most
   * `maxPeers` entries and only runs when a *new* peer pushes the map over
   * the cap; established peers never trigger it.
   */
  prune(): void {
    if (this.buckets.size <= this.maxPeers) return;
    const entries = [...this.buckets.entries()].sort((a, b) => a[1].lastMs - b[1].lastMs);
    for (const [key] of entries.slice(0, this.buckets.size - this.maxPeers)) {
      this.buckets.delete(key);
    }
  }
}
