import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { HttpClient, type FetchLike } from '../src/core/http-client.js';
import { EcfrApi } from '../src/core/ecfr.js';
import { CommandError } from '../src/exit-codes.js';
import { createEcfrApi, ensureIndex } from '../src/commands/ensure-index.js';
import { createTestLogger, FIXTURE_SECTIONS, openTempStore } from './helpers.js';

const MINIMAL_XML = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>T</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>C</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>P</HEAD><DIV8 N="4.1" TYPE="SECTION"><HEAD>§ 4.1 One.</HEAD><P>Body.</P></DIV8></DIV5>
</DIV3></DIV1></ECFR>`;

const MINIMAL_STRUCTURE = {
  type: 'title',
  identifier: '38',
  label: 'Title 38',
  children: [
    {
      type: 'chapter',
      identifier: 'I',
      label: 'Chapter I',
      children: [
        {
          type: 'part',
          identifier: '4',
          label: 'Part 4',
          children: [{ type: 'section', identifier: '4.1', label: '§ 4.1', children: [] }],
        },
      ],
    },
  ],
};

function offlineEcfr(): EcfrApi {
  const failingFetch: FetchLike = async () => {
    throw new TypeError('network disabled in tests');
  };
  return new EcfrApi(
    new HttpClient({ fetchFn: failingFetch, sleep: async () => undefined, retries: 0 }),
  );
}

function workingEcfr(): EcfrApi {
  const fetchFn: FetchLike = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/titles.json')) {
      return new Response(
        JSON.stringify({
          titles: [
            {
              number: 38,
              name: 'Pensions',
              latest_issue_date: '2026-08-27',
              up_to_date_as_of: '2026-10-09',
              latest_amended_on: null,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.pathname.includes('/structure/'))
      return new Response(JSON.stringify(MINIMAL_STRUCTURE), { status: 200 });
    return new Response(MINIMAL_XML, { status: 200 });
  };
  return new EcfrApi(new HttpClient({ fetchFn, sleep: async () => undefined, retries: 0 }));
}

/** Seed fixture sections but mark the index as long-stale. */
function seedStale(store: {
  replaceAll: (
    s: readonly (typeof FIXTURE_SECTIONS)[number][],
    d: string,
    m: Record<string, string>,
  ) => void;
}): void {
  store.replaceAll(FIXTURE_SECTIONS, '2026-01-01', {
    issue_date: '2026-01-01',
    synced_at: '2020-01-01T00:00:00.000Z',
    appendices_count: '1',
  });
}

describe('ensureIndex', () => {
  it('fails with guidance when the index is empty and auto-sync is off', async () => {
    const temp = openTempStore({ seed: false });
    try {
      const config = loadConfig({ CFR_AUTO_SYNC: '0' });
      await expect(ensureIndex(temp.store, config, createTestLogger())).rejects.toThrow(
        CommandError,
      );
      await expect(ensureIndex(temp.store, config, createTestLogger())).rejects.toMatchObject({
        exitCode: 3,
      });
      await expect(ensureIndex(temp.store, config, createTestLogger())).rejects.toThrow(
        /cfr-free sync/,
      );
    } finally {
      temp.cleanup();
    }
  });

  it('fails loudly when the initial sync cannot run', async () => {
    // The error a first-time user is most likely to hit: no network, no
    // index yet. It must say what happened and what to do, and it must not
    // show the upstream path — no user action depends on which endpoint
    // failed, and the raw message is developer-facing.
    const temp = openTempStore({ seed: false });
    try {
      const config = loadConfig({ CFR_AUTO_SYNC: '1' });
      const logger = createTestLogger();
      const failure = ensureIndex(temp.store, config, logger, { createEcfr: offlineEcfr });
      await expect(failure).rejects.toThrow(/could not build the index from eCFR/);
      await expect(failure).rejects.toThrow(/eCFR could not be reached/);
      await expect(failure).rejects.toThrow(/cfr-free sync/);
      await expect(failure).rejects.not.toThrow(/\/api\/versioner/);
      // The detail belongs in the log, where an operator can act on it.
      const logged = logger.records.filter((record) => record.level === 'error');
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.map((record) => record.message).join(' ')).toContain('eCFR request failed');
      expect(JSON.stringify(logged)).toContain('/api/versioner');
      // The kind travels with it. The reader's line tells the kinds apart
      // ("eCFR could not be reached" against "eCFR answered, but not with
      // valid JSON"), and the operator's record must say the same thing:
      // a status alone cannot tell an upstream that answered 200 with a
      // page of HTML from one that answered 200 with a body over the cap.
      const fields = logged[logged.length - 1]?.fields as Record<string, unknown> | undefined;
      expect(fields?.['kind']).toBe('transport');
    } finally {
      temp.cleanup();
    }
  });

  it('performs the initial sync when the index is empty', async () => {
    const temp = openTempStore({ seed: false });
    try {
      const config = loadConfig({ CFR_AUTO_SYNC: '1' });
      const freshness = await ensureIndex(temp.store, config, createTestLogger(), {
        createEcfr: workingEcfr,
      });
      expect(freshness).toBe('synced');
      expect(temp.store.countSections()).toBe(1);
    } finally {
      temp.cleanup();
    }
  });

  it('leaves a fresh index alone', async () => {
    const temp = openTempStore();
    try {
      const config = loadConfig({ CFR_AUTO_SYNC: '1' });
      // A failing client proves no sync attempt happens on the fresh path.
      const freshness = await ensureIndex(temp.store, config, createTestLogger(), {
        createEcfr: offlineEcfr,
      });
      expect(freshness).toBe('fresh');
      expect(temp.store.countSections()).toBe(FIXTURE_SECTIONS.length);
    } finally {
      temp.cleanup();
    }
  });

  it('serves stale data with a warning when a refresh fails', async () => {
    const temp = openTempStore();
    try {
      seedStale(temp.store);
      const config = loadConfig({ CFR_AUTO_SYNC: '1', CFR_MAX_AGE_DAYS: '7' });
      const logger = createTestLogger();
      const freshness = await ensureIndex(temp.store, config, logger, { createEcfr: offlineEcfr });
      expect(freshness).toBe('stale');
      expect(
        logger.records.some(
          (record) => record.level === 'warn' && record.message.includes('refresh failed'),
        ),
      ).toBe(true);
      // Stale rows remain readable — no empty window.
      expect(temp.store.countSections()).toBe(FIXTURE_SECTIONS.length);
    } finally {
      temp.cleanup();
    }
  });

  it('refreshes a stale index when sync succeeds', async () => {
    const temp = openTempStore();
    try {
      seedStale(temp.store);
      const config = loadConfig({ CFR_AUTO_SYNC: '1' });
      const freshness = await ensureIndex(temp.store, config, createTestLogger(), {
        createEcfr: workingEcfr,
      });
      expect(freshness).toBe('synced');
      expect(temp.store.countSections()).toBe(1);
      expect(temp.store.getMeta('issue_date')).toBe('2026-10-09');
    } finally {
      temp.cleanup();
    }
  });

  it('does not attempt a refresh when auto-sync is disabled', async () => {
    const temp = openTempStore();
    try {
      seedStale(temp.store);
      const config = loadConfig({ CFR_AUTO_SYNC: '0' });
      const freshness = await ensureIndex(temp.store, config, createTestLogger());
      expect(freshness).toBe('fresh');
      expect(temp.store.countSections()).toBe(FIXTURE_SECTIONS.length);
    } finally {
      temp.cleanup();
    }
  });

  it('builds a versioned eCFR client', () => {
    expect(createEcfrApi()).toBeInstanceOf(EcfrApi);
  });
});
