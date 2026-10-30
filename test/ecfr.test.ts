import { describe, expect, it } from 'vitest';
import { EcfrApi } from '../src/core/ecfr.js';
import { HttpClient } from '../src/core/http-client.js';
import type { FetchLike } from '../src/core/http-client.js';

const DATE = '2026-01-01';
const OTHER_DATE = '2026-06-01';

function makeApi(fetchFn: FetchLike): EcfrApi {
  return new EcfrApi(
    new HttpClient({
      fetchFn,
      sleep: async () => undefined,
      retries: 0,
      retryDelayMs: 0,
    }),
  );
}

/** A stub that records the dates it was asked for. */
function countingFetch(requested: string[]): FetchLike {
  return async (input) => {
    const url = new URL(String(input));
    const match = /\/full\/(\d{4}-\d{2}-\d{2})\/title-38\.xml$/.exec(url.pathname);
    requested.push(match?.[1] ?? url.pathname);
    return new Response('<ECFR></ECFR>', {
      status: 200,
      headers: { 'content-type': 'application/xml' },
    });
  };
}

describe('EcfrApi.getFullTitleXml', () => {
  it('fetches the same date once', async () => {
    // A point-in-time document does not change: the second read of the
    // same date is the same bytes, and the repeated identical fetches are
    // what made the upstream amplification cheap.
    const requested: string[] = [];
    const api = makeApi(countingFetch(requested));

    const first = await api.getFullTitleXml(DATE);
    const second = await api.getFullTitleXml(DATE);

    expect(second).toBe(first);
    expect(requested).toEqual([DATE]);
  });

  it('fetches a different date', async () => {
    const requested: string[] = [];
    const api = makeApi(countingFetch(requested));

    await api.getFullTitleXml(DATE);
    await api.getFullTitleXml(OTHER_DATE);

    expect(requested).toEqual([DATE, OTHER_DATE]);
  });

  it('bounds the document fetches in flight at once', async () => {
    // The request budget bounds how fast these start; nothing else bounded
    // how many could run at once, and each one holds a parsed document.
    let running = 0;
    let peak = 0;
    const api = makeApi(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return new Response('<ECFR></ECFR>', {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    });

    const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'];
    await Promise.all(dates.map((date) => api.getFullTitleXml(date)));

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
