import { describe, expect, it } from 'vitest';
import { syncChangesSchema, type SyncChanges } from '../src/core/changes.js';
import { ARCHIVE_FLOOR, fetchFullTitleXml } from '../src/core/archive.js';
import { HttpError } from '../src/core/http-client.js';
import { UpstreamFormatError } from '../src/core/errors.js';
import type { EcfrApi } from '../src/core/ecfr.js';

/**
 * The errors the core modules raise, and how they are told apart.
 *
 * CR-20, CR-21 and CR-22 each found a place where the TYPE of a failure
 * was lost: a record read back through a cast, an upstream-data fault
 * raised as a bare `Error`, and a status read off any object that
 * happened to carry one. These tests pin the types.
 */
describe('the sync-change record validator (CR-20)', () => {
  /** A record in the shape `sync.ts` writes. */
  const record: SyncChanges = {
    fromIssueDate: '2026-10-01',
    toIssueDate: '2026-10-16',
    changed: 2,
    added: 1,
    removed: 0,
    changedCitations: ['4.125', '4.130'],
    addedCitations: ['4.131'],
    removedCitations: [],
    baseline: false,
    parserChanged: false,
    recordedAt: '2026-10-16T00:00:00.000Z',
  };

  it('accepts a well-formed record', () => {
    expect(syncChangesSchema.safeParse(record).success).toBe(true);
  });

  it('accepts a first-sync record, whose previous date is null', () => {
    const first = { ...record, fromIssueDate: null, baseline: true };
    expect(syncChangesSchema.safeParse(first).success).toBe(true);
  });

  it('rejects a record whose shape drifted', () => {
    // The whole point: a syntactically valid JSON record of the WRONG shape
    // must not pass through to the wire.
    expect(syncChangesSchema.safeParse({ ...record, changed: 'two' }).success).toBe(false);
    expect(syncChangesSchema.safeParse({ ...record, changedCitations: 'not-a-list' }).success).toBe(
      false,
    );
    const { changed: _changed, ...missing } = record;
    expect(syncChangesSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects a record that is not an object at all', () => {
    expect(syncChangesSchema.safeParse(null).success).toBe(false);
    expect(syncChangesSchema.safeParse([record]).success).toBe(false);
    expect(syncChangesSchema.safeParse('a string').success).toBe(false);
  });
});

describe('the archive guard recognises an upstream failure by its type (CR-22)', () => {
  /** An eCFR stub that fails every fetch with the given error. */
  function failingEcfr(error: unknown): EcfrApi {
    return {
      getFullTitleXml: async () => {
        throw error;
      },
    } as unknown as EcfrApi;
  }

  it('turns a 404 into the usage error the reader can act on', async () => {
    const error = await fetchFullTitleXml(
      failingEcfr(new HttpError('HTTP 404', '2015-01-01', 404)),
      '2015-01-01',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(ARCHIVE_FLOOR);
  });

  it('does NOT treat a look-alike as a 404', async () => {
    // The cast this replaced read `status` off ANY object that happened to
    // carry one. A non-HttpError with a `status` property is a DIFFERENT
    // thing: swallowing it into "your date is wrong" would tell the reader
    // to fix a date that was never the problem.
    const lookAlike = Object.assign(new Error('something else entirely'), { status: 404 });
    const error = await fetchFullTitleXml(failingEcfr(lookAlike), '2015-01-01').catch(
      (e: unknown) => e,
    );
    expect(error).toBe(lookAlike);
    expect((error as Error).message).toBe('something else entirely');
  });

  it('does NOT swallow a 500 from the upstream', async () => {
    const upstream = new HttpError('HTTP 500', '2026-01-01', 500);
    const error = await fetchFullTitleXml(failingEcfr(upstream), '2026-01-01').catch(
      (e: unknown) => e,
    );
    expect(error).toBe(upstream);
  });
});

describe('the upstream-data fault is typed, not a bare Error (CR-21)', () => {
  it('is a distinct type, so the HTTP layer can tell it apart', () => {
    const fault = new UpstreamFormatError('eCFR returned an invalid date: nope');
    expect(fault).toBeInstanceOf(Error);
    expect(fault).toBeInstanceOf(UpstreamFormatError);
    expect(fault.name).toBe('UpstreamFormatError');
    expect(fault.message).toContain('nope');
  });
});
