import net from 'node:net';

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

/** Expand an IPv6 address and extract its canonical /64 prefix (first 4 hextets). */
function ipv6Subnet64(ip: string): string {
  const parts = ip.split('::');
  let left: string[];
  let right: string[];
  if (parts.length === 1) {
    left = parts[0] ? parts[0].split(':') : [];
    right = [];
  } else if (parts.length === 2) {
    left = parts[0] ? parts[0].split(':') : [];
    right = parts[1] ? parts[1].split(':') : [];
  } else {
    return ip;
  }
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return ip;
  const full = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (full.length !== 8) return ip;
  const canonical = full.map((h) => {
    const num = Number.parseInt(h || '0', 16);
    return Number.isNaN(num) ? '0' : num.toString(16);
  });
  return `${canonical.slice(0, 4).join(':')}::/64`;
}

/**
 * Normalize a peer identifier:
 * - Unmaps IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1` -> `192.0.2.1`).
 * - Collapses IPv6 addresses to their `/64` subnet prefix so rotating interface
 *   identifiers within the same network allocation share a single rate-limit bucket.
 * - Leaves standard IPv4 and non-IP hostnames unchanged.
 */
export function normalizePeerAddress(address: string): string {
  const trimmed = address.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const v4Candidate = trimmed.slice(7);
    if (net.isIPv4(v4Candidate)) return v4Candidate;
  }
  if (net.isIPv4(trimmed)) return trimmed;
  if (!net.isIPv6(trimmed)) return trimmed;
  return ipv6Subnet64(lower);
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

  /**
   * Take `cost` tokens for `peer`; allowed while the bucket can pay.
   *
   * The cost is what the request will COST, not how many requests it is:
   * a route that pulls the complete upstream document charges more than
   * one that reads the local index. Charging one token per request let a
   * peer buy the whole upstream document with every token — the
   * published budget of ten requests a second bought TWENTY whole
   * documents a second, because a diff or a redline pulls two of them.
   */
  consume(peer: string, cost = 1): RateVerdict {
    const normalized = normalizePeerAddress(peer);
    const nowMs = this.now();
    const bucket = this.buckets.get(normalized) ?? { tokens: this.capacity, lastMs: nowMs };
    // Refill proportionally to elapsed time, capped at capacity.
    const elapsedSec = Math.max(0, (nowMs - bucket.lastMs) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastMs = nowMs;
    this.buckets.set(normalized, bucket);
    if (this.buckets.size > this.maxPeers) this.prune();

    const wanted = Math.max(1, cost);
    if (bucket.tokens >= wanted) {
      bucket.tokens -= wanted;
      return { allowed: true, retryAfterSec: 0 };
    }
    // A cost the bucket cannot hold must not make the route unreachable:
    // with a capacity of 5 and a cost of 10, zero of a thousand calls
    // were admitted, at any clock. A FULL bucket still admits one such
    // request and is emptied by it — the shortfall is not carried over.
    //
    // The escape has a price worth naming: a bucket SMALLER than the
    // cost buys one expensive request per refill interval, so a smaller
    // bucket buys MORE expensive requests than a larger one. The
    // published default (capacity 60, cost 10) never reaches this
    // branch — it is reachable only by configuring the bucket below the
    // route's own cost.
    if (wanted > this.capacity && bucket.tokens >= this.capacity) {
      bucket.tokens = 0;
      return { allowed: true, retryAfterSec: 0 };
    }
    // The wait is until the request becomes admissible: until the bucket
    // is full again when the cost exceeds the capacity, until it holds
    // the cost otherwise.
    const shortfall =
      wanted > this.capacity ? this.capacity - bucket.tokens : wanted - bucket.tokens;
    return { allowed: false, retryAfterSec: shortfall / this.refillPerSec };
  }

  /**
   * Drop the least-recently-seen peers once the map exceeds `maxPeers` —
   * bounding memory against peer-address floods (IPv6 spaces are huge).
   *
   * To prevent an $O(N \log N)$ sort on every single request under an address
   * flood, pruning evicts down to a batch threshold (up to 10% below maxPeers)
   * while always respecting `maxPeers` as the upper bound.
   */
  prune(): void {
    if (this.buckets.size <= this.maxPeers) return;
    const target = Math.max(1, Math.min(this.maxPeers, Math.floor(this.maxPeers * 0.9)));
    const entries = [...this.buckets.entries()].sort((a, b) => a[1].lastMs - b[1].lastMs);
    const toRemove = this.buckets.size - target;
    for (const [key] of entries.slice(0, toRemove)) {
      this.buckets.delete(key);
    }
  }
}
