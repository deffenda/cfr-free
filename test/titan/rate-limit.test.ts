import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/titan/rate-limit.js';

/** Test-only view of the private cap and bucket map (`private readonly` erases at runtime). */
interface PruneInternals {
  maxPeers: number;
  readonly buckets: Map<string, { tokens: number; lastMs: number }>;
}
const internals = (limiter: RateLimiter): PruneInternals => limiter as unknown as PruneInternals;

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
