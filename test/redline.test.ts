import { describe, expect, it } from 'vitest';
import { EcfrApi } from '../src/core/ecfr.js';
import { HttpClient } from '../src/core/http-client.js';
import { MAX_REDLINE_LINES, redlineSection, splitRedlineLines } from '../src/core/redline.js';
import { CFRService } from '../src/core/service.js';
import { ServiceError } from '../src/core/errors.js';
import { SyncError } from '../src/core/sync.js';
import { createTestLogger, openTempStore, type TempStore, type TestLogger } from './helpers.js';
import type { FetchLike } from '../src/core/http-client.js';

/**
 * Offline stub of eCFR's versioner full-title endpoint (the same router
 * shape diff.test.ts uses): serves per-date XML and records every requested
 * date so zero-fetch rejections can be asserted. The corpus is small and
 * KNOWN — every changed-provision test pins the EXACT hunk list, which is
 * the LCS contract this file exists to protect.
 */

const FROM_DATE = '2026-01-01';
const TO_DATE = '2026-06-01';

function fullXml(sections: string): string {
  return `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>${sections}</DIV5></DIV3></ECFR>`;
}

function section(citation: string, ...paragraphs: string[]): string {
  const body = paragraphs.map((paragraph) => `<P>${paragraph}</P>`).join('');
  return `<DIV8 N="${citation}" TYPE="SECTION"><HEAD>§ ${citation} Test.</HEAD>${body}</DIV8>`;
}

/** Same raw N on both dates, caller-controlled body — the exact-case fixture. */
function appendix(body: string): string {
  return `<DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>${body}</P></DIV9>`;
}

// from: 4.125 (4 lines ×…), 4.130 (unchanged), 4.145 (to be trimmed),
// 4.160 (only here → removed), Appendix A (both dates).
const FROM_XML = fullXml(
  section('4.125', 'Alpha.', 'Beta.', 'Gamma.', 'Delta.') +
    section('4.130', 'RFC text.') +
    section('4.145', 'First line.', 'Dropped tail.') +
    section('4.160', 'Only in from one.', 'Only in from two.') +
    appendix('Appendix text.'),
);
// to: 4.125 amended, 4.130 identical, 4.145 trimmed, 4.140 new, Appendix A amended.
const TO_XML = fullXml(
  section('4.125', 'Alpha.', 'Beta revised.', 'Gamma.', 'Epsilon.') +
    section('4.130', 'RFC text.') +
    section('4.145', 'First line.') +
    section('4.140', 'Added one.', 'Added two.') +
    appendix('Appendix text updated.'),
);

const ZERO_SECTION_XML = '<ECFR></ECFR>';

/** 1001 paragraphs → 2001 lines (n paragraphs join to 2n−1 lines). */
function bigParagraphs(): string[] {
  return Array.from(
    { length: Math.floor(MAX_REDLINE_LINES / 2) + 1 },
    (_, index) => `Paragraph ${index}.`,
  );
}

function makeFetch(
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

describe('redlineSection', () => {
  it('returns the EXACT LCS hunks for a changed provision over a known corpus', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeFetch(requested));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.125');
    expect(report.fromIssueDate).toBe(FROM_DATE);
    expect(report.toIssueDate).toBe(TO_DATE);
    expect(report.citation).toBe('4.125');
    expect(report.status).toBe('changed');
    expect(report.coarse).toBe(false);
    expect(report.fromText).toBe('Alpha.\n\nBeta.\n\nGamma.\n\nDelta.');
    expect(report.toText).toBe('Alpha.\n\nBeta revised.\n\nGamma.\n\nEpsilon.');
    expect(report.hunks).toEqual([
      { fromLine: 1, toLine: 1, type: 'same', text: 'Alpha.' },
      { fromLine: 2, toLine: 2, type: 'same', text: '' },
      { fromLine: 3, toLine: null, type: 'del', text: 'Beta.' },
      { fromLine: null, toLine: 3, type: 'add', text: 'Beta revised.' },
      { fromLine: 4, toLine: 4, type: 'same', text: '' },
      { fromLine: 5, toLine: 5, type: 'same', text: 'Gamma.' },
      { fromLine: 6, toLine: 6, type: 'same', text: '' },
      { fromLine: 7, toLine: null, type: 'del', text: 'Delta.' },
      { fromLine: null, toLine: 7, type: 'add', text: 'Epsilon.' },
    ]);
    // Both dates fetched, exactly once each, plus the diffIssues-style phases.
    expect(requested).toEqual([FROM_DATE, TO_DATE]);
    expect(deps.logger.records.filter((r) => r.message === 'fetching full title XML')).toHaveLength(
      2,
    );
    expect(
      deps.logger.records.some((r) => r.message === 'parsing and diffing provision text'),
    ).toBe(true);
    expect(deps.logger.records.some((r) => r.message === 'section redline computed')).toBe(true);
  });

  it('emits from-side tail deletions when the to-side runs out (exact hunks)', async () => {
    const deps = makeDeps(makeFetch([]));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.145');
    expect(report.status).toBe('changed');
    expect(report.hunks).toEqual([
      { fromLine: 1, toLine: 1, type: 'same', text: 'First line.' },
      { fromLine: 2, toLine: null, type: 'del', text: '' },
      { fromLine: 3, toLine: null, type: 'del', text: 'Dropped tail.' },
    ]);
  });

  it('reports an added provision as add hunks over the to-side lines', async () => {
    const deps = makeDeps(makeFetch([]));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.140');
    expect(report.status).toBe('added');
    expect(report.citation).toBe('4.140');
    expect(report.coarse).toBe(false);
    expect(report.fromText).toBeUndefined();
    expect(report.toText).toBe('Added one.\n\nAdded two.');
    expect(report.hunks).toEqual([
      { fromLine: null, toLine: 1, type: 'add', text: 'Added one.' },
      { fromLine: null, toLine: 2, type: 'add', text: '' },
      { fromLine: null, toLine: 3, type: 'add', text: 'Added two.' },
    ]);
  });

  it('reports a removed provision as del hunks over the from-side lines', async () => {
    const deps = makeDeps(makeFetch([]));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.160');
    expect(report.status).toBe('removed');
    expect(report.citation).toBe('4.160');
    expect(report.coarse).toBe(false);
    expect(report.fromText).toBe('Only in from one.\n\nOnly in from two.');
    expect(report.toText).toBeUndefined();
    expect(report.hunks).toEqual([
      { fromLine: 1, toLine: null, type: 'del', text: 'Only in from one.' },
      { fromLine: 2, toLine: null, type: 'del', text: '' },
      { fromLine: 3, toLine: null, type: 'del', text: 'Only in from two.' },
    ]);
  });

  it('reports identical text as unchanged with empty hunks and both texts', async () => {
    const deps = makeDeps(makeFetch([]));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.130');
    expect(report.status).toBe('unchanged');
    expect(report.fromText).toBe('RFC text.');
    expect(report.toText).toBe('RFC text.');
    expect(report.hunks).toEqual([]);
    expect(report.coarse).toBe(false);
  });

  it('hash-shortcuts identical LARGE texts to unchanged — never coarse, never an LCS', async () => {
    const body = bigParagraphs();
    const xml = fullXml(section('4.125', ...body));
    const deps = makeDeps(makeFetch([], { [FROM_DATE]: xml, [TO_DATE]: xml }));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.125');
    expect(report.status).toBe('unchanged');
    expect(report.hunks).toEqual([]);
    expect(report.coarse).toBe(false);
  });

  it('rejects identical dates as invalid_input BEFORE any fetch', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeFetch(requested));
    const error = await rejection(redlineSection(deps, FROM_DATE, FROM_DATE, '4.125'));
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe('invalid_input');
    expect(requested).toEqual([]);
  });

  it('rejects shape-valid but impossible dates as invalid_input BEFORE any fetch', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeFetch(requested));
    for (const [from, to] of [
      ['2026-13-01', TO_DATE],
      ['2026-02-30', TO_DATE],
      [FROM_DATE, '06/01/2026'],
      [FROM_DATE, 'not-a-date'],
    ] as const) {
      const error = await rejection(redlineSection(deps, from, to, '4.125'));
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('invalid_input');
    }
    expect(requested).toEqual([]);
  });

  it('rejects a non-citation as invalid_input BEFORE any fetch', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeFetch(requested));
    const error = await rejection(redlineSection(deps, FROM_DATE, TO_DATE, 'not a citation'));
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe('invalid_input');
    expect(requested).toEqual([]);
  });

  it('resolves every normalized section form to the same canonical provision', async () => {
    for (const input of ['4.125', '38 CFR 4.125', '§ 4.125']) {
      const deps = makeDeps(makeFetch([]));
      const report = await redlineSection(deps, FROM_DATE, TO_DATE, input);
      expect(report.citation).toBe('4.125');
      expect(report.status).toBe('changed');
    }
  });

  it('resolves an appendix by EXACT-case match present in both texts', async () => {
    const deps = makeDeps(makeFetch([]));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, 'Appendix A to Part 4');
    expect(report.status).toBe('changed');
    expect(report.citation).toBe('Appendix A to Part 4');
    expect(report.fromText).toBe('Appendix text.');
    expect(report.toText).toBe('Appendix text updated.');
    expect(report.hunks).toEqual([
      { fromLine: 1, toLine: null, type: 'del', text: 'Appendix text.' },
      { fromLine: null, toLine: 1, type: 'add', text: 'Appendix text updated.' },
    ]);
  });

  it('resolves an appendix case-insensitively, like the store (COLLATE NOCASE)', async () => {
    const deps = makeDeps(makeFetch([]));
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, 'appendix a to part 4');
    expect(report.status).toBe('changed');
    // The REPORTED citation stays the corpus form (the row's raw XML `N`),
    // even though the request was lowercase.
    expect(report.citation).toBe('Appendix A to Part 4');
    expect(report.toText).toBe('Appendix text updated.');
  });

  it('raises not_found naming the citation and BOTH dates, after fetching', async () => {
    const requested: string[] = [];
    const deps = makeDeps(makeFetch(requested));
    const error = await rejection(redlineSection(deps, FROM_DATE, TO_DATE, 'Appendix B to Part 4'));
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe('not_found');
    const message = (error as Error).message;
    expect(message).toContain('Appendix B to Part 4');
    expect(message).toContain(FROM_DATE);
    expect(message).toContain(TO_DATE);
    // not_found is raised AFTER the fetches — both dates were requested.
    expect(requested).toEqual([FROM_DATE, TO_DATE]);
  });

  it('fails hard with SyncError when either date parses to zero sections', async () => {
    const fromDeps = makeDeps(makeFetch([], { [FROM_DATE]: ZERO_SECTION_XML, [TO_DATE]: TO_XML }));
    const fromError = await rejection(redlineSection(fromDeps, FROM_DATE, TO_DATE, '4.125'));
    expect(fromError).toBeInstanceOf(SyncError);
    expect((fromError as Error).message).toMatch(/parsed zero sections for issue date 2026-01-01/);

    const toDeps = makeDeps(makeFetch([], { [FROM_DATE]: FROM_XML, [TO_DATE]: ZERO_SECTION_XML }));
    const toError = await rejection(redlineSection(toDeps, FROM_DATE, TO_DATE, '4.125'));
    expect(toError).toBeInstanceOf(SyncError);
    expect((toError as Error).message).toMatch(/parsed zero sections for issue date 2026-06-01/);
  });

  it('coarse-falls back to exactly two whole-text blocks when BOTH sides exceed the cap', async () => {
    const fromBody = bigParagraphs();
    const toBody = fromBody.map((paragraph, index) =>
      index === 500 ? 'Paragraph 500 amended.' : paragraph,
    );
    const deps = makeDeps(
      makeFetch([], {
        [FROM_DATE]: fullXml(section('4.125', ...fromBody)),
        [TO_DATE]: fullXml(section('4.125', ...toBody)),
      }),
    );
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.125');
    expect(report.status).toBe('changed');
    expect(report.coarse).toBe(true);
    // Both sides are genuinely over the cap.
    expect((report.fromText ?? '').split('\n').length).toBeGreaterThan(MAX_REDLINE_LINES);
    expect((report.toText ?? '').split('\n').length).toBeGreaterThan(MAX_REDLINE_LINES);
    // Exactly two hunks, each carrying its whole side with true line counts
    // and the block anchors the spec pins (from-line 1 / to-line 1).
    expect(report.hunks).toEqual([
      { fromLine: 1, toLine: null, type: 'del', text: report.fromText },
      { fromLine: null, toLine: 1, type: 'add', text: report.toText },
    ]);
    expect(report.hunks[0]?.text.split('\n')).toHaveLength(2001);
    expect(report.hunks[1]?.text.split('\n')).toHaveLength(2001);
  });

  it('coarse-falls back when ONLY the to-side exceeds the cap', async () => {
    const toBody = bigParagraphs();
    const deps = makeDeps(
      makeFetch([], {
        [FROM_DATE]: fullXml(section('4.125', 'Short.')),
        [TO_DATE]: fullXml(section('4.125', ...toBody)),
      }),
    );
    const report = await redlineSection(deps, FROM_DATE, TO_DATE, '4.125');
    expect(report.status).toBe('changed');
    expect(report.coarse).toBe(true);
    expect((report.toText ?? '').split('\n').length).toBeGreaterThan(MAX_REDLINE_LINES);
    expect(report.hunks).toEqual([
      { fromLine: 1, toLine: null, type: 'del', text: 'Short.' },
      { fromLine: null, toLine: 1, type: 'add', text: report.toText },
    ]);
    expect(report.hunks[1]?.text.split('\n')).toHaveLength(2001);
  });
});

describe('splitRedlineLines', () => {
  it('splits on \\n only and keeps CR bytes inside the line text', () => {
    expect(splitRedlineLines('a\nb')).toEqual(['a', 'b']);
    // CRLF discipline: the \r stays with its line, never normalized away.
    expect(splitRedlineLines('a\r\nb\r\n')).toEqual(['a\r', 'b\r', '']);
    expect(splitRedlineLines('')).toEqual(['']);
  });
});

describe('CFRService.redlineBetween (redline facade)', () => {
  it('delegates to the core redline through the injected client and logger', async () => {
    const temp: TempStore = openTempStore();
    try {
      const requested: string[] = [];
      const deps = makeDeps(makeFetch(requested));
      const service = new CFRService(temp.store, 7, deps.ecfr, deps.logger);
      const report = await service.redlineBetween(FROM_DATE, TO_DATE, '4.125');
      expect(report.fromIssueDate).toBe(FROM_DATE);
      expect(report.toIssueDate).toBe(TO_DATE);
      expect(report.citation).toBe('4.125');
      expect(report.status).toBe('changed');
      expect(report.coarse).toBe(false);
      expect(requested).toEqual([FROM_DATE, TO_DATE]);
      expect(deps.logger.records.some((r) => r.message === 'section redline computed')).toBe(true);
    } finally {
      temp.cleanup();
    }
  });

  it('fails closed with a mapped unavailable when no eCFR client was injected', async () => {
    const temp: TempStore = openTempStore();
    try {
      // Plain 2-arg construction (tests, index readers): the facade must not
      // reach into an undefined client — it throws a clean ServiceError the
      // HTTP/MCP layers map instead of crashing the handler. The code is
      // `unavailable`, NOT `invalid_input`: the fault is the deployment's
      // (no eCFR client was wired in), not the reader's.
      const service = new CFRService(temp.store, 7);
      const error = await service.redlineBetween(FROM_DATE, TO_DATE, '4.125').then(
        () => {
          throw new Error('expected the promise to reject');
        },
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('unavailable');
      expect((error as ServiceError).message).toBe('redline unavailable — no eCFR client injected');
    } finally {
      temp.cleanup();
    }
  });
});
