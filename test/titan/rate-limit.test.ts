import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/titan/rate-limit.js';

/** Test-only view of the private cap and bucket map (`private readonly` erases at runtime). */
interface PruneInternals {
  maxPeers: number;
  readonly buckets: Map<string, { tokens: number; lastMs: number }>;
}
const internals = (limiter: RateLimiter): PruneInternals => limiter as unknown as PruneInternals;

describe('RateLimiter', () => {
  it('allows a burst up to capacity, then denies with a retry hint', () => {
    const nowMs = 1_000_000;
    const limiter = new RateLimiter({
      capacity: 3,
      refillPerSec: 1,
      now: () => nowMs,
    });
    expect(limiter.consume('peer-a').allowed).toBe(true);
    expect(limiter.consume('peer-a').allowed).toBe(true);
    expect(limiter.consume('peer-a').allowed).toBe(true);
    const denied = limiter.consume('peer-a');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeCloseTo(1, 5);
  });

  it('charges an expensive request what it costs, not one token', () => {
    // The cost is what the request will COST: a route that pulls the
    // complete upstream document must not be buyable with one token, or
    // the budget of ten requests a second buys twenty whole documents —
    // a diff or a redline pulls two of them.
    const nowMs = 1_000_000;
    const limiter = new RateLimiter({ capacity: 25, refillPerSec: 1, now: () => nowMs });
    expect(limiter.consume('peer', 10).allowed).toBe(true);
    expect(limiter.consume('peer', 10).allowed).toBe(true);
    // 25 tokens, 20 spent: five left, and the request costs ten.
    const denied = limiter.consume('peer', 10);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeCloseTo(5, 5);
    // A cheap request still fits in what is left: five tokens, five
    // requests.
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(false);
  });

  it('keeps an expensive request reachable when the capacity is below its cost', () => {
    // A capacity smaller than the cost must not make the expensive route
    // permanently unreachable: with a capacity of 5 and a cost of 10, zero
    // of a thousand calls were admitted, at any clock. A full bucket still
    // admits one such request — and empties itself doing so.
    const limiter = new RateLimiter({ capacity: 5, refillPerSec: 1, now: () => 0 });
    expect(limiter.consume('peer', 10).allowed).toBe(true);
    const denied = limiter.consume('peer', 10);
    expect(denied.allowed).toBe(false);
    // The wait is until the bucket is full again: 5 tokens at 1/s.
    expect(denied.retryAfterSec).toBeCloseTo(5, 5);
    // The cheap burst is untouched: the bucket still holds its own size.
    const cheap = new RateLimiter({ capacity: 5, refillPerSec: 1, now: () => 0 });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(cheap.consume('peer').allowed).toBe(true);
    }
    expect(cheap.consume('peer').allowed).toBe(false);
  });

  it('refills over time, capped at capacity', () => {
    let nowMs = 0;
    const limiter = new RateLimiter({ capacity: 2, refillPerSec: 2, now: () => nowMs });
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(false);
    nowMs += 500; // 0.5 s × 2/s = 1 token
    expect(limiter.consume('peer').allowed).toBe(true);
    nowMs += 10_000; // long quiet period: capped at capacity, not banked
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(true);
    expect(limiter.consume('peer').allowed).toBe(false);
  });

  it('isolates peers from each other', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1, now: () => 0 });
    expect(limiter.consume('peer-a').allowed).toBe(true);
    expect(limiter.consume('peer-a').allowed).toBe(false);
    expect(limiter.consume('peer-b').allowed).toBe(true);
  });

  it('bounds memory by evicting the least-recently-seen peers', () => {
    let nowMs = 0;
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSec: 1,
      maxPeers: 10,
      now: () => nowMs,
    });
    for (let i = 0; i < 100; i += 1) {
      nowMs += 10;
      limiter.consume(`peer-${i}`);
    }
    // Eviction keeps working: the newest peer is always served from a fresh bucket.
    expect(limiter.consume('peer-newest').allowed).toBe(true);
  });
});

describe('RateLimiter.prune', () => {
  it('early-returns while the bucket map is at or under the cap', () => {
    let nowMs = 0;
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSec: 1,
      maxPeers: 3,
      now: () => nowMs,
    });
    limiter.consume('peer-a');
    nowMs += 10;
    limiter.consume('peer-b');
    limiter.prune();
    expect([...internals(limiter).buckets.keys()]).toEqual(['peer-a', 'peer-b']);
  });

  it('evicts the least-recently-seen buckets when over the cap', () => {
    let nowMs = 0;
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSec: 1,
      maxPeers: 5,
      now: () => nowMs,
    });
    limiter.consume('oldest');
    nowMs += 10;
    limiter.consume('middle');
    nowMs += 10;
    limiter.consume('newest'); // lastMs: 0 < 10 < 20
    internals(limiter).maxPeers = 1;
    limiter.prune();
    expect([...internals(limiter).buckets.keys()]).toEqual(['newest']);
  });
});
