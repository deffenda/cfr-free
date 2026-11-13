import { describe, expect, it } from 'vitest';
import { findProvision, normalizeCitation } from '../src/core/citations.js';
import { buildFtsQueries, queryTerms, toFtsQuery } from '../src/core/store.js';
import { datedSourceUrlFor, sourceUrlFor } from '../src/core/urls.js';
import type { RawSection } from '../src/core/xml.js';

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
