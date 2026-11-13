import { describe, expect, it } from 'vitest';
import { findProvision, normalizeCitation } from '../src/core/citations.js';
import { buildFtsQueries, queryTerms, toFtsQuery } from '../src/core/store.js';
import { datedSourceUrlFor, sourceUrlFor } from '../src/core/urls.js';
import type { RawSection } from '../src/core/xml.js';
import { syncChangesSchema, type SyncChanges } from '../src/core/changes.js';
import { ARCHIVE_FLOOR, fetchFullTitleXml } from '../src/core/archive.js';
import { HttpError } from '../src/core/http-client.js';
import { UpstreamFormatError } from '../src/core/errors.js';
import type { EcfrApi } from '../src/core/ecfr.js';

/**
 * The shared vocabulary the core modules now speak.
 *
 * CR-15, CR-16, CR-17, CR-20 and CR-22 each found the same rule written
 * twice — the FTS query, the eCFR permalink, the provision lookup — with
 * two copies that could drift apart. These tests pin the ONE place each
 * rule lives, so a second copy cannot appear without a failing test.
 */

describe('the shared FTS query builder (CR-15)', () => {
  it('builds both tiers from one parse', () => {
    const queries = buildFtsQueries(queryTerms('Mental Disorders'));
    expect(queries).not.toBeNull();
    expect(queries?.or).toBe('"mental"* OR "disorders"*');
    expect(queries?.and).toBe('"mental"* AND "disorders"*');
  });

  it('yields nothing for a query with no usable terms', () => {
    expect(buildFtsQueries(queryTerms('!!! ???'))).toBeNull();
    expect(buildFtsQueries(queryTerms(''))).toBeNull();
  });

  it('is the builder the exported toFtsQuery uses', () => {
    // The whole point of CR-15: `search()` and `toFtsQuery()` must not be
    // able to disagree about what the query means. Both go through
    // `buildFtsQueries`, so both answer the same for the same input.
    const terms = queryTerms('Mental Disorders');
    const queries = buildFtsQueries(terms);
    expect(toFtsQuery('Mental Disorders', 'or')).toBe(queries?.or);
    expect(toFtsQuery('Mental Disorders', 'and')).toBe(queries?.and);
  });

  it('gives the same answer whichever path asks', () => {
    // A representative query with a synonym, a phrase and a plain token —
    // the shapes the escaping rules exist for.
    const raw = '"traumatic brain injury" evaluation ptsd';
    const queries = buildFtsQueries(queryTerms(raw));
    expect(queries).not.toBeNull();
    expect(toFtsQuery(raw, 'or')).toBe(queries?.or);
    expect(toFtsQuery(raw, 'and')).toBe(queries?.and);
  });

  it('still refuses to let user input introduce FTS operators', () => {
    const query = toFtsQuery('" OR 1=1 -- NEAR(x)', 'and');
    expect(query).not.toBeNull();
    expect(query).not.toContain('OR 1=1');
    expect(query).not.toContain('--');
  });
});

describe('the shared eCFR permalinks (CR-16)', () => {
  it('links a section to its own page', () => {
    expect(sourceUrlFor('4.125', 'section')).toBe(
      'https://www.ecfr.gov/current/title-38/section-4.125',
    );
  });

  it('links an appendix to the site search', () => {
    expect(sourceUrlFor('Appendix A to Part 4', 'appendix')).toBe(
      'https://www.ecfr.gov/search?searchTerm=Appendix%20A%20to%20Part%204&titles=38',
    );
  });

  it('links a dated revision with the date in the path', () => {
    expect(datedSourceUrlFor('4.125', 'section', '2026-10-16')).toBe(
      'https://www.ecfr.gov/on/2026-10-16/title-38/section-4.125',
    );
    expect(datedSourceUrlFor('Appendix A to Part 4', 'appendix', '2026-10-16')).toBe(
      'https://www.ecfr.gov/on/2026-10-16/title-38/appendix-Appendix%20A%20to%20Part%204',
    );
  });

  it('encodes the citation, because the unencoded form answers 404', () => {
    // Verified against the live site (SPEC §6): the appendix form needs the
    // citation URL-ENCODED.
    expect(datedSourceUrlFor('Appendix A to Part 4', 'appendix', '2026-10-16')).toContain(
      'Appendix%20A%20to%20Part%204',
    );
    expect(datedSourceUrlFor('Appendix A to Part 4', 'appendix', '2026-10-16')).not.toContain(
      'Appendix A to Part 4',
    );
  });
});

describe('the shared provision lookup (CR-17)', () => {
  /** Two provisions, one whose XML citation carries capitals. */
  const sections: RawSection[] = [
    { kind: 'section', citation: '4.124A', heading: 'h', text: 't', markdown: 'm' },
    { kind: 'section', citation: '4.125', heading: 'h', text: 't', markdown: 'm' },
    { kind: 'appendix', citation: 'Appendix A to Part 4', heading: 'h', text: 't', markdown: 'm' },
  ] as RawSection[];

  it('folds both sides to lower case for a section', () => {
    // The corpus stores `4.124A`; `normalizeCitation` produces `4.124a`.
    // Plain equality would miss the provision.
    const found = findProvision(sections, 'section', '4.124a');
    expect(found?.citation).toBe('4.124A');
  });

  it('folds both sides to lower case for an appendix', () => {
    const found = findProvision(sections, 'appendix', 'appendix a to part 4');
    expect(found?.citation).toBe('Appendix A to Part 4');
  });

  it('requires the kind to match exactly', () => {
    expect(findProvision(sections, 'appendix', '4.125')).toBeUndefined();
    expect(findProvision(sections, 'section', 'Appendix A to Part 4')).toBeUndefined();
  });

  it('answers the same way for a citation that is already normalized', () => {
    const parsed = normalizeCitation('§ 4.125');
    expect(parsed).not.toBeNull();
    const found = findProvision(sections, 'section', parsed?.citation ?? '');
    expect(found?.citation).toBe('4.125');
  });
});

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
