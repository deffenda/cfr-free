import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FULL_TITLE_XML_TTL_MS,
  EcfrApi,
  FULL_TITLE_XML_MEMO_CAP,
} from '../src/core/ecfr.js';
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

/** Wait until the predicate holds, so the test does not count microtasks. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
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

  it('serves concurrent readers of the same date from one fetch', async () => {
    // The repeated identical fetches are what made the upstream
    // amplification cheap: a burst of identical requests must not become
    // a burst of identical downloads.
    let fetches = 0;
    let release: (() => void) | undefined;
    const api = makeApi(async () => {
      fetches += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response('<ECFR></ECFR>', {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    });

    const readers = [
      api.getFullTitleXml(DATE),
      api.getFullTitleXml(DATE),
      api.getFullTitleXml(DATE),
    ];
    await waitFor(() => fetches === 1);
    // The one fetch is still in flight: the other readers are waiting on
    // it, not starting their own.
    expect(fetches).toBe(1);
    release?.();

    const documents = await Promise.all(readers);
    expect(fetches).toBe(1);
    expect(documents[0]).toBe(documents[1]);
    expect(documents[1]).toBe(documents[2]);
  });

  it('evicts the least recently used document, not the oldest', async () => {
    const requested: string[] = [];
    const api = new EcfrApi(
      new HttpClient({
        fetchFn: countingFetch(requested),
        sleep: async () => undefined,
        retries: 0,
        retryDelayMs: 0,
      }),
      undefined,
      { fullTitleXmlMemoCap: 2 },
    );

    await api.getFullTitleXml('2026-01-01');
    await api.getFullTitleXml('2026-01-02');
    // The first date is read again: it is now the MOST recently used.
    await api.getFullTitleXml('2026-01-01');
    // The third date evicts the least recently used one — the second date,
    // not the first.
    await api.getFullTitleXml('2026-01-03');
    expect(requested).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);

    // The hot document survived: reading it again costs no fetch.
    await api.getFullTitleXml('2026-01-01');
    expect(requested).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    // The cold one was evicted: reading it again fetches it again.
    await api.getFullTitleXml('2026-01-02');
    expect(requested).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-02']);
  });

  it('keeps four documents for five minutes by default', async () => {
    // The published contract (SPEC §5): the memo holds at most four
    // documents and reuses one for five minutes.
    expect(FULL_TITLE_XML_MEMO_CAP).toBe(4);
    expect(DEFAULT_FULL_TITLE_XML_TTL_MS).toBe(5 * 60_000);

    const requested: string[] = [];
    const api = makeApi(countingFetch(requested));
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'];
    for (const date of dates) await api.getFullTitleXml(date);
    // Four documents fit: none of them is fetched twice.
    for (const date of dates) await api.getFullTitleXml(date);
    expect(requested).toEqual(dates);
    // The fifth evicts the first.
    await api.getFullTitleXml('2026-01-05');
    await api.getFullTitleXml('2026-01-01');
    expect(requested).toEqual([...dates, '2026-01-05', '2026-01-01']);
  });

  it('fetches a document again once its reuse window has passed', async () => {
    const requested: string[] = [];
    const api = new EcfrApi(
      new HttpClient({
        fetchFn: countingFetch(requested),
        sleep: async () => undefined,
        retries: 0,
        retryDelayMs: 0,
      }),
      undefined,
      { fullTitleXmlTtlMs: 0 },
    );

    await api.getFullTitleXml(DATE);
    await api.getFullTitleXml(DATE);

    expect(requested).toEqual([DATE, DATE]);
  });
});
