import { describe, expect, it } from 'vitest';
import { diffIssues } from '../src/core/diff.js';
import { EcfrApi } from '../src/core/ecfr.js';
import { HttpClient, HttpError } from '../src/core/http-client.js';
import { ServiceError } from '../src/core/service.js';
import { SyncError } from '../src/core/sync.js';
import { createTestLogger, type TestLogger } from './helpers.js';
import type { FetchLike } from '../src/core/http-client.js';

/**
 * Offline stub of eCFR's versioner full-title endpoint: the fetch router
 * records every requested date and serves XML per date, so the tests can
 * assert both the diff RESULT and that each date was fetched correctly.
 */

const FROM_DATE = '2026-01-01';
const TO_DATE = '2026-06-01';

function fullXml(sections: string): string {
  return `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>${sections}</DIV5></DIV3></ECFR>`;
}

function section(citation: string, body: string): string {
  return `<DIV8 N="${citation}" TYPE="SECTION"><HEAD>§ ${citation} Test.</HEAD><P>${body}</P></DIV8>`;
}

const APPENDIX = `<DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix text.</P></DIV9>`;

// from: 4.125 (old text) + 4.130 + Appendix A
const FROM_XML = fullXml(
  section('4.125', 'Original body.') + section('4.130', 'RFC text.') + APPENDIX,
);
// to: 4.125 amended + 4.140 added; 4.130 unchanged; Appendix A removed.
const TO_XML = fullXml(
  section('4.125', 'Amended body.') +
    section('4.130', 'RFC text.') +
    section('4.140', 'Newly added.'),
);

const ZERO_SECTION_XML = '<ECFR></ECFR>';

function makeDiffFetch(
  requested: string[],
  xmlByDate: Readonly<Record<string, string>> = { [FROM_DATE]: FROM_XML, [TO_DATE]: TO_XML },
): FetchLike {
  return async (input) => {
    const url = new URL(String(input));
    const match = /\/full\/(\d{4}-\d{2}-\d{2})\/title-38\.xml$/.exec(url.pathname);
    if (!match) return new Response('not found', { status: 404 });
    const date = match[1] as string;
    requested.push(date);
    const xml = xmlByDate[date];
    if (xml === undefined) return new Response('no such date', { status: 404 });
    return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } });
  };
}

function makeDeps(fetchFn: FetchLike): { ecfr: EcfrApi; logger: TestLogger } {
  const http = new HttpClient({
    fetchFn,
    sleep: async () => undefined,
    retryDelayMs: 0,
    retries: 0,
  });
  return { ecfr: new EcfrApi(http), logger: createTestLogger() };
}

/** Await a rejection and return the error for instanceof/code assertions. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (error: unknown) => error,
  );
}

describe('diffIssues', () => {
  it('reports changed, added and removed provisions across two dates', async () => {
    const deps = makeDeps(makeDiffFetch([]));
    const report = await diffIssues(deps, FROM_DATE, TO_DATE);
    expect(report.fromIssueDate).toBe(FROM_DATE);
    expect(report.toIssueDate).toBe(TO_DATE);
    expect(report.changed).toEqual(['4.125']);
    expect(report.added).toEqual(['4.140']);
    expect(report.removed).toEqual(['Appendix A to Part 4']);
    // Phase lines mirror sync's phrasing.
    expect(deps.logger.records.filter((r) => r.message === 'fetching full title XML')).toHaveLength(
      2,
    );
    expect(deps.logger.records.some((r) => r.message === 'issue diff computed')).toBe(true);
  });

  it('reports a heading-only amendment between two dates (M2(b))', async () => {
    // A retitled provision with an unchanged body: the § 3.17 case. A
    // text-only comparison reported "no provision changes".
    const from = fullXml(
      `<DIV8 N="3.17" TYPE="SECTION"><HEAD>§ 3.17 Disability and death pension; Mexican.</HEAD><P>Unchanged body.</P></DIV8>`,
    );
    const to = fullXml(
      `<DIV8 N="3.17" TYPE="SECTION"><HEAD>§ 3.17 Disability and survivors pension; Mexican.</HEAD><P>Unchanged body.</P></DIV8>`,
    );
    const deps = makeDeps(makeDiffFetch([], { [FROM_DATE]: from, [TO_DATE]: to }));
    const report = await diffIssues(deps, FROM_DATE, TO_DATE);
    expect(report.changed).toEqual(['3.17']);
    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
  });

  it('requests the full-title XML for exactly the two given dates, in order', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeDiffFetch(requested));
    await diffIssues(deps, FROM_DATE, TO_DATE);
    expect(requested).toEqual([FROM_DATE, TO_DATE]);
  });

  it('returns all-empty lists when both dates parse to identical content', async () => {
    const deps = makeDeps(makeDiffFetch([], { [FROM_DATE]: FROM_XML, [TO_DATE]: FROM_XML }));
    const report = await diffIssues(deps, FROM_DATE, TO_DATE);
    expect(report.changed).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
  });

  it('rejects identical from/to dates with ServiceError invalid_input, without fetching', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeDiffFetch(requested));
    const error = await rejection(diffIssues(deps, FROM_DATE, FROM_DATE));
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe('invalid_input');
    expect(requested).toEqual([]);
  });

  it('rejects malformed dates with ServiceError invalid_input', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeDiffFetch(requested));
    for (const [from, to] of [
      ['not-a-date', TO_DATE],
      ['2026-1-1', TO_DATE],
      [FROM_DATE, '06/01/2026'],
      // Semantic range check (R3 nit 1): shape-valid but impossible — month
      // past 12, and a day February can never hold. Both must fail BEFORE any
      // network round-trip.
      ['2026-13-01', TO_DATE],
      ['2026-02-30', TO_DATE],
    ] as const) {
      const error = await rejection(diffIssues(deps, from, to));
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('invalid_input');
    }
    expect(requested).toEqual([]);
  });

  it('accepts 2026-02-28 — the maximum day February can hold in a non-leap year', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeDiffFetch(requested, { '2026-02-28': FROM_XML, [TO_DATE]: TO_XML }));
    const report = await diffIssues(deps, '2026-02-28', TO_DATE);
    expect(report.fromIssueDate).toBe('2026-02-28');
    expect(requested).toEqual(['2026-02-28', TO_DATE]);
  });

  it('leaves true calendar edges (2025-02-29) to the upstream authority', async () => {
    // 2025 is not a leap year, so 2025-02-29 is not a real date — but the
    // in-repo check only bounds the day by the month's MAXIMUM possible
    // length (February ≤ 29 in any year), by design: computing the real
    // per-year edge would duplicate eCFR's calendar logic. The value passes
    // validation, the fetch RUNS (both dates requested below), and the
    // upstream document index is what rejects it — see the MAX_DAYS_BY_MONTH
    // comment in diff.ts.
    const requested: string[] = [];
    const deps = makeDeps(makeDiffFetch(requested, { [TO_DATE]: TO_XML }));
    const error = await rejection(diffIssues(deps, '2025-02-29', TO_DATE));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect(requested).toEqual(['2025-02-29', TO_DATE]);
  });

  it('fails hard with SyncError when the from-date parses to zero sections', async () => {
    const deps = makeDeps(makeDiffFetch([], { [FROM_DATE]: ZERO_SECTION_XML, [TO_DATE]: TO_XML }));
    const error = await rejection(diffIssues(deps, FROM_DATE, TO_DATE));
    expect(error).toBeInstanceOf(SyncError);
    expect((error as Error).message).toMatch(/parsed zero sections for issue date 2026-01-01/);
  });

  it('fails hard with SyncError when the to-date parses to zero sections', async () => {
    const deps = makeDeps(
      makeDiffFetch([], { [FROM_DATE]: FROM_XML, [TO_DATE]: ZERO_SECTION_XML }),
    );
    const error = await rejection(diffIssues(deps, FROM_DATE, TO_DATE));
    expect(error).toBeInstanceOf(SyncError);
    expect((error as Error).message).toMatch(/parsed zero sections for issue date 2026-06-01/);
  });

  it('returns FULL sorted lists — the display cap belongs to the caller', async () => {
    // 101 sections on the from-date, all absent on the to-date: every one is
    // "removed", and none may be dropped by the core diff.
    const citations = Array.from({ length: 101 }, (_, i) => `4.${String(i + 1).padStart(3, '0')}`);
    const deps = makeDeps(
      makeDiffFetch([], {
        [FROM_DATE]: fullXml(citations.map((c) => section(c, `Text ${c}.`)).join('')),
        [TO_DATE]: fullXml(section('4.999', 'Only survivor.')),
      }),
    );
    const report = await diffIssues(deps, FROM_DATE, TO_DATE);
    expect(report.removed).toHaveLength(101);
    expect(report.removed[0]).toBe('4.001');
    expect(report.removed[100]).toBe('4.101');
  });
});
