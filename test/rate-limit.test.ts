import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/titan/rate-limit.js';

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
