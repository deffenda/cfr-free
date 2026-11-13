import { describe, expect, it } from 'vitest';
import {
  MAX_TERMS,
  queryTerms,
  toFtsQuery,
  tidySnippet,
  visibleMatches,
} from '../src/core/query.js';

/**
 * The query language, tested without a database.
 *
 * These tests used to live in `test/store.test.ts`, above the `Store`
 * suite. CR-32 moved the rules they exercise into `src/core/query.ts`,
 * which has no SQLite dependency — so they moved here too, and that is
 * the point of the move: the tokenizer, the synonym table, the FTS5
 * fragment builder, the stopword list and the "did this hit answer"
 * rules are now unit-testable on their own.
 */
describe('toFtsQuery', () => {
  it('builds quoted prefix terms joined by AND', () => {
    expect(toFtsQuery('Mental Disorders', 'and')).toBe('"mental"* AND "disorders"*');
    expect(toFtsQuery('Mental Disorders', 'or')).toBe('"mental"* OR "disorders"*');
  });

  it('neutralizes FTS operator injection', () => {
    const query = toFtsQuery('" OR 1=1 -- NEAR(x)', 'and');
    expect(query).toBe('"or"* AND "1"* AND "1"* AND "near"* AND "x"*');
  });

  it('never emits raw quotes from user input', () => {
    const query = toFtsQuery('a"b OR c', 'and');
    expect(query).toBe('"a"* AND "b"* AND "or"* AND "c"*');
  });

  it('bounds the number of terms', () => {
    const many = Array.from({ length: 50 }, (_, i) => `term${i}`).join(' ');
    const query = toFtsQuery(many, 'and');
    expect(query).not.toBeNull();
    expect((query ?? '').split(' AND ')).toHaveLength(MAX_TERMS);
  });

  it('returns null for inputs with no alphanumerics', () => {
    expect(toFtsQuery('!!! ???', 'and')).toBeNull();
    expect(toFtsQuery('', 'or')).toBeNull();
  });

  it('turns quoted spans into prefix-phrase queries', () => {
    expect(toFtsQuery('"traumatic brain injury" evaluation', 'and')).toBe(
      '"traumatic brain injury"* AND "evaluation"*',
    );
    // A quoted span with only operator-looking content stays fully quoted.
    expect(toFtsQuery('"NEAR(a b)"', 'and')).toBe('"near a b"*');
  });

  it('expands curated claims acronyms into phrase alternatives', () => {
    // Every expansion lists the spellings the CORPUS actually uses, so it
    // reaches the sections that contain the concept: the corpus spells
    // "posttraumatic stress" (6 sections) AND "post-traumatic stress" (2).
    expect(toFtsQuery('ptsd', 'and')).toBe(
      '("ptsd"* OR "posttraumatic stress"* OR "post-traumatic stress"*)',
    );
    expect(toFtsQuery('ptsd rating', 'and')).toBe(
      '("ptsd"* OR "posttraumatic stress"* OR "post-traumatic stress"*) AND "rating"*',
    );
    expect(toFtsQuery('evaluation', 'and')).toBe('"evaluation"*'); // no false expansion
  });

  it("expands a client word to the corpus's phrasing", () => {
    // The corpus says "hearing impairment" (14 sections, including § 4.85
    // "Evaluation of hearing impairment"); clients say "hearing loss".
    // Before the expansion, "hearing loss" led with § 20.715 and § 21.422
    // — provisions that are not about hearing at all.
    expect(toFtsQuery('hearing', 'and')).toBe('("hearing"* OR "hearing impairment"*)');
    expect(toFtsQuery('hearing loss', 'and')).toBe(
      '("hearing"* OR "hearing impairment"*) AND "loss"*',
    );
  });

  it('expands the acronyms whose corpus spelling differs from the old form', () => {
    // "dependency and indemnity compensation" (98 sections) — the old
    // expansion omitted the "and" and matched ONE section.
    expect(toFtsQuery('dic', 'and')).toBe('("dic"* OR "dependency and indemnity compensation"*)');
    // "board of veterans' appeals" (75 sections) — the old expansion
    // omitted the apostrophe and matched SEVEN.
    expect(toFtsQuery('bva', 'and')).toBe('("bva"* OR "board of veterans\' appeals"*)');
  });

  it('expands a punctuated abbreviation only when it stands alone', () => {
    // The base commit expanded "A&A" wherever it appeared, so "VA&A"
    // became the aid-and-attendance phrase (and "A&As" became the phrase
    // plus a stray "s"). An abbreviation is a standalone word: "VA&A" is
    // a different word. These two queries are the ONLY ones whose FTS
    // string changed.
    expect(toFtsQuery('VA&A', 'and')).toBe('"va"* AND "a"*');
    expect(toFtsQuery('A&As', 'and')).toBe('"a"* AND "as"*');
    // Everything else is unchanged by the standalone rule.
    expect(toFtsQuery('A&A', 'and')).toBe('"aid and attendance"*');
    expect(toFtsQuery('(A&A)', 'and')).toBe('"aid and attendance"*');
    expect(toFtsQuery('a & a', 'and')).toBe('"a"* AND "a"*');
  });

  it('expands punctuated abbreviations before tokenizing', () => {
    // "A&A" tokenizes to two single letters, which are dropped — the
    // query degenerated and the search returned noise. The raw-phrase
    // table expands it first: "aid and attendance" is in 31 sections.
    expect(toFtsQuery('A&A', 'and')).toBe('"aid and attendance"*');
    expect(toFtsQuery('a&a', 'and')).toBe('"aid and attendance"*');
    // The literal words are NOT an abbreviation match — they tokenize
    // individually, exactly as before this change.
    expect(toFtsQuery('aid and attendance for a parent', 'and')).toBe(
      '"aid"* AND "and"* AND "attendance"* AND "for"* AND "a"* AND "parent"*',
    );
  });

  it('never lets an expansion introduce an FTS operator', () => {
    // The raw-phrase table is applied to the raw query, so whatever the
    // user types around the abbreviation is still emitted as quoted
    // tokens: no operator can escape into the FTS expression.
    expect(toFtsQuery('A&A" OR 1=1--', 'and')).toBe(
      '"aid and attendance"* AND "or"* AND "1"* AND "1"*',
    );
    expect(toFtsQuery('A&A OR NEAR(x)', 'and')).toBe(
      '"aid and attendance"* AND "or"* AND "near"* AND "x"*',
    );
  });

  it('charges phrase words against the term budget', () => {
    const phrase = '"one two three four five"'; // 5 words
    const many = `${phrase} ${Array.from({ length: 20 }, (_, i) => `term${i}`).join(' ')}`;
    const query = toFtsQuery(many, 'and');
    // 5 phrase words + 7 loose terms = MAX_TERMS words consumed.
    expect((query ?? '').split(' AND ')).toHaveLength(1 + (MAX_TERMS - 5));
    // A phrase alone may exceed the budget; loose terms then stay empty.
    const longPhrase = `"${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}" tail`;
    expect(toFtsQuery(longPhrase, 'and')).not.toContain('tail');
  });
});

describe('queryTerms', () => {
  it('reads tokens, quoted spans and punctuated abbreviations as terms', () => {
    const terms = queryTerms('smc "aid and attendance" A&A');
    // Spans first (the FTS builder's order), then the bare tokens.
    expect(terms.map((term) => term.kind)).toEqual(['phrase', 'substitution', 'token']);
    expect(terms[0]?.term).toBe('aid and attendance');
    expect(terms[0]?.words).toEqual(['aid', 'and', 'attendance']);
    // A punctuated abbreviation is ONE term standing for its corpus phrase.
    expect(terms[1]?.term).toBe('a&a');
    expect(terms[1]?.expansions).toEqual(['aid and attendance']);
    expect(terms[2]?.term).toBe('smc');
  });

  it('does not read a punctuated abbreviation inside a word as an abbreviation', () => {
    // "VA&A" is a different word: the abbreviation must stand alone, so no
    // substitution term is created ("&" only splits it into two tokens).
    const terms = queryTerms('VA&A');
    expect(terms.map((term) => term.kind)).toEqual(['token', 'token']);
    expect(terms.map((term) => term.term)).toEqual(['va', 'a']);
  });

  it('expands a curated acronym to every corpus spelling it stands for', () => {
    const [term] = queryTerms('ptsd');
    expect(term?.expansions).toEqual(['posttraumatic stress', 'post-traumatic stress']);
  });

  it('keeps a quoted span verbatim', () => {
    const [term] = queryTerms('"mental disorder"');
    expect(term?.kind).toBe('phrase');
    expect(term?.expansions).toEqual([]);
  });
});

describe('visibleMatches', () => {
  const hit = {
    citation: '3.350',
    heading: 'Special monthly compensation ratings.',
    snippet: 'Ratings for special monthly compensation.',
  };

  it('reports the term a hit answered through its corpus phrase', () => {
    // The hit never spells "smc" — it spells the phrase the synonym stands
    // for, so the term still answered.
    expect(visibleMatches(queryTerms('smc'), hit)).toEqual(['smc']);
    expect(visibleMatches(queryTerms('smc rating'), hit)).toEqual(['smc', 'rating']);
  });

  it('reports nothing for a term the hit does not answer', () => {
    expect(visibleMatches(queryTerms('tinnitus'), hit)).toEqual([]);
  });

  it('does not report a scattered quoted phrase as responded', () => {
    const scattered = {
      citation: '1.1',
      heading: 'Compensation.',
      snippet: 'Compensation includes attendance records and emergency aid.',
    };
    expect(visibleMatches(queryTerms('"aid and attendance"'), scattered)).toEqual([]);
  });

  it('reports a contiguous in-order quoted phrase as responded', () => {
    const contiguous = {
      citation: '1.1',
      heading: 'Compensation.',
      snippet: 'Compensation includes aid and attendance benefits.',
    };
    expect(visibleMatches(queryTerms('"aid and attendance"'), contiguous)).toEqual([
      'aid and attendance',
    ]);
  });

  it('does not report a reversed-order quoted phrase as responded', () => {
    const reversed = {
      citation: '1.1',
      heading: 'Compensation.',
      snippet: 'Compensation includes attendance and aid benefits.',
    };
    expect(visibleMatches(queryTerms('"aid and attendance"'), reversed)).toEqual([]);
  });

  it('does not satisfy a phrase from a longer token (token boundary)', () => {
    const longer = {
      citation: '1.1',
      heading: 'Compensation.',
      snippet: 'Compensation includes aidance and attendance benefits.',
    };
    expect(visibleMatches(queryTerms('"aid and attendance"'), longer)).toEqual([]);
  });
});

describe('tidySnippet', () => {
  it('drops a leading lowercase fragment when a sentence boundary follows', () => {
    expect(tidySnippet('rating agency shall return the report. Evaluation continues here.')).toBe(
      'Evaluation continues here.',
    );
  });

  it('keeps snippets that already start a sentence', () => {
    expect(tidySnippet('The rating agency shall return. next')).toBe(
      'The rating agency shall return. next',
    );
  });

  it('keeps fragments with no usable boundary', () => {
    expect(tidySnippet('subordinate clause without end')).toBe('subordinate clause without end');
  });
});
