import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/core/http-client.js';
import { EcfrApi } from '../src/core/ecfr.js';
import { syncIndex, SyncError, PARSER_VERSION } from '../src/core/sync.js';
import { Store, StoreError } from '../src/core/store.js';
import { createTestLogger, FIXTURE_STRUCTURE, FIXTURE_SECTIONS, openTempStore } from './helpers.js';
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

/**
 * Corrupt payload: a second row with the SAME citation. It parses fine but
 * violates `sections.citation TEXT NOT NULL UNIQUE` at the INSERT step of
 * `Store.replaceAll`, so the rebuild transaction itself throws and rolls
 * back — a data-driven way to fail BENEATH the replacement, with no mocking
 * of store internals.
 */
const DUPLICATE_CITATION_XML = FULL_XML.replace(
  '</DIV5>',
  '<DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Duplicate row.</HEAD><P>Duplicate citation row.</P></DIV8></DIV5>',
);

interface FetchRouteOptions {
  issueDate?: string | null;
  latestIssueDate?: string | null;
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
            latest_issue_date:
              options.latestIssueDate === undefined ? '2026-08-27' : options.latestIssueDate,
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
      expect(deps.store.getMeta('structure_expected_sections')).toBe('2');
      expect(deps.store.getMeta('structure_expected_appendices')).toBe('1');
      expect(JSON.parse(deps.store.getMeta('structure_json') ?? '{}')).toMatchObject({
        type: 'title',
      });
      expect(deps.logger.records.some((record) => record.message === 'index rebuilt')).toBe(true);
    } finally {
      deps.temp.cleanup();
    }
  });

  it('does not write retired meta keys', async () => {
    const deps = makeDeps(makeFetch());
    try {
      await syncIndex(deps);
      // getMeta returns null for a missing key (store.ts:609), not undefined.
      expect(deps.store.getMeta('up_to_date_as_of')).toBeNull();
      expect(deps.store.getMeta('title_name')).toBeNull();
      expect(deps.store.getMeta('sections_count')).toBeNull();
      expect(deps.store.getMeta('source')).toBeNull();
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

  it('falls back to up_to_date_as_of when latest_issue_date is null', async () => {
    const deps = makeDeps(makeFetch({ latestIssueDate: null }));
    try {
      const report = await syncIndex(deps);
      expect(report.issueDate).toBe(ISSUE_DATE);
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
      // Expectations are persisted so drift stays visible after the sync.
      expect(deps.store.getMeta('structure_expected_sections')).toBe('0');
      expect(deps.store.getMeta('structure_expected_appendices')).toBe('0');
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

function makeEcfr(fetchFn: FetchLike): EcfrApi {
  return new EcfrApi(
    new HttpClient({ fetchFn, sleep: async () => undefined, retryDelayMs: 0, retries: 0 }),
  );
}

describe('syncIndex change reporting', () => {
  it('records a baseline on the first sync', async () => {
    const deps = makeDeps(makeFetch());
    try {
      const report = await syncIndex(deps);
      expect(report.changes).toEqual({ changed: 0, added: 0, removed: 0 });
      const changes = JSON.parse(deps.store.getMeta('last_changes') ?? '{}') as {
        baseline: boolean;
        changedCitations: string[];
        fromIssueDate: string | null;
      };
      expect(changes.baseline).toBe(true);
      expect(changes.changedCitations).toEqual([]);
      expect(changes.fromIssueDate).toBeNull();
    } finally {
      deps.temp.cleanup();
    }
  });

  it('diffs amended, added and removed provisions across syncs', async () => {
    const temp = openTempStore({ seed: false });
    const logger = createTestLogger();
    const secondXml = FULL_XML.replace('<P>Body text.</P>', '<P>Body text, amended.</P>')
      .replace(
        '</DIV5>',
        '<DIV8 N="4.126" TYPE="SECTION"><HEAD>§ 4.126 Newly added.</HEAD><P>New.</P></DIV8></DIV5>',
      )
      .replace(/<DIV9[\s\S]*?<\/DIV9>/, '');
    try {
      await syncIndex({ ecfr: makeEcfr(makeFetch()), store: temp.store, logger });
      const report = await syncIndex({
        ecfr: makeEcfr(makeFetch({ xml: secondXml })),
        store: temp.store,
        logger,
      });
      expect(report.changes).toEqual({ changed: 1, added: 1, removed: 1 });
      const changes = JSON.parse(temp.store.getMeta('last_changes') ?? '{}') as {
        baseline: boolean;
        changed: number;
        changedCitations: string[];
        addedCitations: string[];
        removedCitations: string[];
        fromIssueDate: string | null;
        toIssueDate: string;
        parserChanged: boolean;
      };
      expect(changes.baseline).toBe(false);
      expect(changes.changedCitations).toEqual(['4.125']);
      expect(changes.addedCitations).toEqual(['4.126']);
      expect(changes.removedCitations).toEqual(['Appendix A to Part 4']);
      expect(changes.fromIssueDate).toBe(ISSUE_DATE);
      expect(changes.toIssueDate).toBe(ISSUE_DATE);
      expect(changes.parserChanged).toBe(false);
    } finally {
      temp.cleanup();
    }
  });

  it('rolls the rebuild back atomically so index and change report stay coherent', async () => {
    const temp = openTempStore({ seed: false });
    const logger = createTestLogger();
    try {
      // 1) First successful sync — baseline report committed.
      await syncIndex({ ecfr: makeEcfr(makeFetch()), store: temp.store, logger });
      const beforeIssueDate = temp.store.getMeta('issue_date');
      const beforeChanges = temp.store.getMeta('last_changes');
      const beforeSyncedAt = temp.store.getMeta('synced_at');
      const beforeCount = temp.store.countSections();
      expect(beforeIssueDate).toBe(ISSUE_DATE);
      expect(beforeCount).toBe(2);

      // 2) Failure INSIDE the rebuild transaction (duplicate citation violates
      //    the UNIQUE constraint at the INSERT step) → the whole transaction
      //    rolls back; no partial state may be observable.
      await expect(
        syncIndex({
          ecfr: makeEcfr(makeFetch({ issueDate: '2026-10-16', xml: DUPLICATE_CITATION_XML })),
          store: temp.store,
          logger,
        }),
      ).rejects.toThrow(/UNIQUE constraint failed/i);

      // Same handle: previous index and previous report intact, untouched.
      expect(temp.store.getMeta('issue_date')).toBe(beforeIssueDate);
      expect(temp.store.getMeta('last_changes')).toBe(beforeChanges);
      expect(temp.store.getMeta('synced_at')).toBe(beforeSyncedAt);
      expect(temp.store.countSections()).toBe(beforeCount);

      // A subsequent store on the SAME file sees the same previous state.
      temp.store.close();
      const reopened = Store.open(temp.indexPath);
      try {
        expect(reopened.getMeta('issue_date')).toBe(ISSUE_DATE);
        expect(reopened.getMeta('last_changes')).toBe(beforeChanges);
        expect(reopened.countSections()).toBe(beforeCount);

        // 3) Corrective sync on clean (amended) data: the committed triplet
        //    (issue_date, synced_at, last_changes) is coherent — the report
        //    can never be orphaned from the index it describes.
        const amendedXml = FULL_XML.replace('<P>Body text.</P>', '<P>Body text, amended.</P>')
          .replace(
            '</DIV5>',
            '<DIV8 N="4.126" TYPE="SECTION"><HEAD>§ 4.126 Newly added.</HEAD><P>New.</P></DIV8></DIV5>',
          )
          .replace(/<DIV9[\s\S]*?<\/DIV9>/, '');
        const report = await syncIndex({
          ecfr: makeEcfr(makeFetch({ issueDate: '2026-10-16', xml: amendedXml })),
          store: reopened,
          logger,
        });
        expect(report.issueDate).toBe('2026-10-16');
        expect(reopened.getMeta('issue_date')).toBe('2026-10-16');
        expect(reopened.getMeta('synced_at')).not.toBe(beforeSyncedAt);
        const after = JSON.parse(reopened.getMeta('last_changes') ?? '{}') as {
          baseline: boolean;
          changed: number;
          added: number;
          removed: number;
          fromIssueDate: string | null;
          toIssueDate: string;
          parserChanged: boolean;
        };
        expect(after.baseline).toBe(false);
        expect(after.fromIssueDate).toBe(ISSUE_DATE);
        expect(after.toIssueDate).toBe('2026-10-16');
        expect(after.parserChanged).toBe(false);
        expect({ changed: after.changed, added: after.added, removed: after.removed }).toEqual(
          report.changes,
        );
        expect(report.changes).toEqual({ changed: 1, added: 1, removed: 1 });
      } finally {
        reopened.close();
      }
    } finally {
      temp.cleanup();
    }
  });

  it('commits last_changes inside the rebuild transaction, not as a second write', async () => {
    const deps = makeDeps(makeFetch());
    try {
      const replace = vi.spyOn(deps.store, 'replaceAllWithBaseline');
      const setMeta = vi.spyOn(deps.store, 'setMeta');
      await syncIndex(deps);
      expect(replace).toHaveBeenCalledTimes(1);
      // The report is a field of the SAME meta object the rebuild commits.
      const meta = replace.mock.calls[0]?.[2] ?? {};
      expect(Object.keys(meta)).toContain('last_changes');
      expect(meta.last_changes).toBe(deps.store.getMeta('last_changes'));
      // No separate post-commit write could orphan it from the new index.
      expect(setMeta.mock.calls.some(([key]) => key === 'last_changes')).toBe(false);
      replace.mockRestore();
      setMeta.mockRestore();
    } finally {
      deps.temp.cleanup();
    }
  });

  it('snapshots the baseline inside the rebuild transaction (interleaving regression)', async () => {
    const temp = openTempStore({ seed: false });
    const logger = createTestLogger();
    try {
      // 1) Baseline sync at issue date A succeeds and records a baseline report.
      await syncIndex({ ecfr: makeEcfr(makeFetch()), store: temp.store, logger });
      const first = JSON.parse(temp.store.getMeta('last_changes') ?? '{}') as {
        baseline: boolean;
        fromIssueDate: string | null;
      };
      expect(first.baseline).toBe(true);
      expect(first.fromIssueDate).toBeNull();

      // 2) Simulate a concurrent writer committing into the window between a
      //    pre-transaction snapshot and BEGIN IMMEDIATE: the spy fires exactly
      //    at transaction entry and overwrites issue_date there. With a
      //    PRE-transaction snapshot the report would still carry issue date A;
      //    with the snapshot INSIDE the transaction it sees the interleaved
      //    write.
      let fired = false;
      const original = temp.store.transaction.bind(temp.store);
      const spy = vi.spyOn(temp.store, 'transaction').mockImplementation((fn) => {
        if (!fired) {
          fired = true;
          temp.store.setMeta('issue_date', 'SENTINEL');
        }
        original(fn);
      });

      // 3) Second sync (issue date B) — runs the same code path as a real
      //    concurrent `cfr-free sync` would after the interleave above.
      const report = await syncIndex({
        ecfr: makeEcfr(makeFetch({ issueDate: '2026-10-16' })),
        store: temp.store,
        logger,
      });
      spy.mockRestore();
      expect(fired).toBe(true);

      // 4) The committed report must describe the state the rebuild ACTUALLY
      //    replaced — the interleaved live index — not a stale pre-tx snapshot.
      const changes = JSON.parse(temp.store.getMeta('last_changes') ?? '{}') as {
        baseline: boolean;
        fromIssueDate: string | null;
        toIssueDate: string;
        changed: number;
        added: number;
        removed: number;
      };
      expect(changes.fromIssueDate).toBe('SENTINEL');
      expect(changes.baseline).toBe(false);
      expect(changes.toIssueDate).toBe('2026-10-16');
      expect(report.issueDate).toBe('2026-10-16');
      expect({ changed: changes.changed, added: changes.added, removed: changes.removed }).toEqual(
        report.changes,
      );
    } finally {
      temp.cleanup();
    }
  });

  it('leaves no state at all when the very first rebuild transaction fails', async () => {
    const deps = makeDeps(makeFetch({ issueDate: '2026-10-16', xml: DUPLICATE_CITATION_XML }));
    try {
      await expect(syncIndex(deps)).rejects.toThrow(/UNIQUE constraint failed/i);
      expect(deps.store.countSections()).toBe(0);
      expect(deps.store.getMeta('issue_date')).toBeNull();
      expect(deps.store.getMeta('last_changes')).toBeNull();
      expect(deps.store.getMeta('synced_at')).toBeNull();
    } finally {
      deps.temp.cleanup();
    }
  });
});

describe('Store.replaceAllWithBaseline', () => {
  it('runs the baseline callback inside the transaction, before the wipe', () => {
    const temp = openTempStore(); // seeded: 4 fixture sections, issue_date 2026-10-09
    try {
      expect(temp.store.countSections()).toBe(4);
      const seen = temp.store.replaceAllWithBaseline(
        FIXTURE_SECTIONS.slice(0, 1),
        '2026-10-16',
        { issue_date: '2026-10-16', synced_at: 'later' },
        (snapshot) => {
          // Chosen ordering: callback runs BEFORE the DELETE — the baseline
          // must still see the outgoing rows it is describing.
          const countAtSnapshot = snapshot.countSections();
          const issueDateAtSnapshot = snapshot.getMeta('issue_date');
          // A write performed here participates in the SAME transaction as
          // the rebuild: it must be visible only after the COMMIT.
          snapshot.setMeta('baseline_probe', 'inside-tx');
          return {
            countAtSnapshot,
            issueDateAtSnapshot,
            probe: snapshot.getMeta('baseline_probe'),
          };
        },
      );
      // Snapshot saw the OUTGOING index, not the new one.
      expect(seen.countAtSnapshot).toBe(4);
      expect(seen.issueDateAtSnapshot).toBe('2026-10-09');
      expect(seen.probe).toBe('inside-tx');
      // The rebuild committed...
      expect(temp.store.countSections()).toBe(1);
      expect(temp.store.getMeta('issue_date')).toBe('2026-10-16');
      // ...and the callback's own write rode the SAME commit.
      expect(temp.store.getMeta('baseline_probe')).toBe('inside-tx');
      // The callback's return value is handed back to the caller.
      expect(seen.countAtSnapshot).not.toBe(temp.store.countSections());
    } finally {
      temp.cleanup();
    }
  });

  it('rolls back wipe, meta and callback writes together when the callback throws', () => {
    const temp = openTempStore(); // seeded: 4 fixture sections, issue_date 2026-10-09
    try {
      expect(() =>
        temp.store.replaceAllWithBaseline([], '2026-10-16', { issue_date: '2026-10-16' }, () => {
          throw new Error('baseline failed');
        }),
      ).toThrow('baseline failed');
      // If the callback ran OUTSIDE the transaction its effects (or the
      // wipe) would survive; none do — proof it is part of the BEGIN
      // IMMEDIATE…COMMIT unit.
      expect(temp.store.countSections()).toBe(4);
      expect(temp.store.getMeta('issue_date')).toBe('2026-10-09');
      expect(temp.store.getMeta('baseline_probe')).toBeNull();
    } finally {
      temp.cleanup();
    }
  });

  it('commits baseline-written meta keys in the same rebuild (last_changes rides)', () => {
    const temp = openTempStore({ seed: false });
    try {
      const meta: Record<string, string> = { issue_date: '2026-10-16' };
      const changes = temp.store.replaceAllWithBaseline(
        FIXTURE_SECTIONS.slice(0, 1),
        '2026-10-16',
        meta,
        () => {
          const built = '{"fromIssueDate":"2026-10-09","baseline":false}';
          // Mirrors syncIndex: the report is derived from the in-tx
          // snapshot and injected into the SAME meta object the rebuild
          // upserts.
          meta.last_changes = built;
          return built;
        },
      );
      expect(changes).toBe(meta.last_changes);
      expect(temp.store.getMeta('last_changes')).toBe(changes);
      expect(temp.store.getMeta('issue_date')).toBe('2026-10-16');
    } finally {
      temp.cleanup();
    }
  });
});
