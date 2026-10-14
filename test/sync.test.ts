import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/core/http-client.js';
import { EcfrApi } from '../src/core/ecfr.js';
import { syncIndex, SyncError, PARSER_VERSION } from '../src/core/sync.js';
import { StoreError } from '../src/core/store.js';
import { createTestLogger, FIXTURE_STRUCTURE, openTempStore } from './helpers.js';
import type { FetchLike } from '../src/core/http-client.js';

const ISSUE_DATE = '2026-10-09';

const FULL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
<DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD>
<DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>
<DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Body text.</P></DIV8>
</DIV5>
<DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix text.</P></DIV9>
</DIV3>
</ECFR>`;

interface FetchRouteOptions {
  issueDate?: string | null;
  xml?: string;
  structure?: unknown;
  failFull?: boolean;
}

function makeFetch(options: FetchRouteOptions = {}): FetchLike {
  const issueDate = options.issueDate === undefined ? ISSUE_DATE : options.issueDate;
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/titles.json')) {
      return json({
        titles: [
          // Reserved title with null dates — must not break validation.
          {
            number: 35,
            name: 'Reserved',
            latest_issue_date: null,
            up_to_date_as_of: null,
            latest_amended_on: null,
          },
          {
            number: 38,
            name: 'Pensions, Bonuses, and Veterans\u2019 Relief',
            latest_issue_date: '2026-08-27',
            up_to_date_as_of: issueDate,
            latest_amended_on: '2026-08-27',
          },
        ],
      });
    }
    if (url.pathname.includes('/structure/')) {
      return json(options.structure ?? FIXTURE_STRUCTURE);
    }
    if (url.pathname.includes('/full/')) {
      if (options.failFull) return new Response('upstream exploded', { status: 500 });
      return new Response(options.xml ?? FULL_XML, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    }
    return new Response('not found', { status: 404 });
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeDeps(fetchFn: FetchLike) {
  const temp = openTempStore({ seed: false });
  const logger = createTestLogger();
  const http = new HttpClient({
    fetchFn,
    sleep: async () => undefined,
    retryDelayMs: 0,
    retries: 0,
  });
  return { temp, store: temp.store, logger, ecfr: new EcfrApi(http) };
}

describe('syncIndex', () => {
  it('rebuilds the index and records metadata', async () => {
    const deps = makeDeps(makeFetch());
    try {
      const report = await syncIndex(deps);
      expect(report.issueDate).toBe(ISSUE_DATE);
      expect(report.sections).toBe(1);
      expect(report.appendices).toBe(1);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(deps.store.countSections()).toBe(2);
      expect(deps.store.getMeta('issue_date')).toBe(ISSUE_DATE);
      expect(deps.store.getMeta('parser_version')).toBe(PARSER_VERSION);
      expect(deps.store.getMeta('sections_count')).toBe('1');
      expect(JSON.parse(deps.store.getMeta('structure_json') ?? '{}')).toMatchObject({
        type: 'title',
      });
      expect(deps.logger.records.some((record) => record.message === 'index rebuilt')).toBe(true);
    } finally {
      deps.temp.cleanup();
    }
  });

  it('falls back to latest_issue_date when up_to_date_as_of is null', async () => {
    const deps = makeDeps(makeFetch({ issueDate: null }));
    try {
      const report = await syncIndex(deps);
      expect(report.issueDate).toBe('2026-08-27');
    } finally {
      deps.temp.cleanup();
    }
  });

  it('fails hard when the XML contains no sections', async () => {
    const deps = makeDeps(makeFetch({ xml: '<ECFR></ECFR>' }));
    try {
      await expect(syncIndex(deps)).rejects.toThrow(SyncError);
      await expect(syncIndex(deps)).rejects.toThrow(/parsed zero sections/);
      expect(deps.store.countSections()).toBe(0);
    } finally {
      deps.temp.cleanup();
    }
  });

  it('warns when parsed counts drift from the structure tree', async () => {
    const driftingStructure = {
      ...(FIXTURE_STRUCTURE as Record<string, unknown>),
      children: [],
    };
    const deps = makeDeps(makeFetch({ structure: driftingStructure }));
    try {
      await syncIndex(deps);
      expect(
        deps.logger.records.some(
          (record) => record.level === 'warn' && record.message.includes('differ'),
        ),
      ).toBe(true);
    } finally {
      deps.temp.cleanup();
    }
  });

  it('propagates upstream failures without touching the index', async () => {
    const deps = makeDeps(makeFetch({ failFull: true }));
    try {
      await expect(syncIndex(deps)).rejects.toThrow(/HTTP 500/);
      expect(deps.store.countSections()).toBe(0);
    } finally {
      deps.temp.cleanup();
    }
  });

  it('rejects invalid issue dates from upstream', async () => {
    const deps = makeDeps(async () =>
      json({
        titles: [
          {
            number: 38,
            name: 'x',
            latest_issue_date: 'not-a-date',
            up_to_date_as_of: 'also-bad',
            latest_amended_on: null,
          },
        ],
      }),
    );
    try {
      await expect(syncIndex(deps)).rejects.toThrow(/invalid date/);
    } finally {
      deps.temp.cleanup();
    }
  });

  it('fails when title 38 is missing upstream', async () => {
    const deps = makeDeps(async () =>
      json({
        titles: [
          {
            number: 1,
            name: 'general',
            latest_issue_date: ISSUE_DATE,
            up_to_date_as_of: ISSUE_DATE,
            latest_amended_on: null,
          },
        ],
      }),
    );
    try {
      await expect(syncIndex(deps)).rejects.toThrow(/does not include title 38/);
    } finally {
      deps.temp.cleanup();
    }
  });

  it('fails when title 38 has no usable dates upstream', async () => {
    const deps = makeDeps(async () =>
      json({
        titles: [
          {
            number: 38,
            name: 'x',
            latest_issue_date: null,
            up_to_date_as_of: null,
            latest_amended_on: null,
          },
        ],
      }),
    );
    try {
      await expect(syncIndex(deps)).rejects.toThrow(/no issue date for title 38/);
    } finally {
      deps.temp.cleanup();
    }
  });
});

describe('Store.open failures', () => {
  it('is re-exported for consumers', () => {
    expect(StoreError).toBeDefined();
  });
});
