import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  Store,
  StoreError,
  MAX_TERMS,
  SCHEMA_VERSION,
  toFtsQuery,
  tidySnippet,
} from '../src/core/store.js';
import { syncIndex } from '../src/core/sync.js';
import type { EcfrApi } from '../src/core/ecfr.js';
import {
  createTestLogger,
  FIXTURE_SECTIONS,
  FIXTURE_STRUCTURE,
  makeSection,
  openTempStore,
} from './helpers.js';

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

  it('expands the acronyms whose corpus spelling differs from the old form', () => {
    // "dependency and indemnity compensation" (98 sections) — the old
    // expansion omitted the "and" and matched ONE section.
    expect(toFtsQuery('dic', 'and')).toBe('("dic"* OR "dependency and indemnity compensation"*)');
    // "board of veterans' appeals" (75 sections) — the old expansion
    // omitted the apostrophe and matched SEVEN.
    expect(toFtsQuery('bva', 'and')).toBe('("bva"* OR "board of veterans\' appeals"*)');
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

describe('Store', () => {
  it('creates parent directories and reports its path', () => {
    const temp = openTempStore();
    try {
      expect(temp.store.path).toContain('index.sqlite');
      expect(temp.store.countSections()).toBe(FIXTURE_SECTIONS.length);
    } finally {
      temp.cleanup();
    }
  });

  it('stores and reads back metadata atomically', () => {
    const temp = openTempStore();
    try {
      expect(temp.store.getMeta('issue_date')).toBe('2026-10-09');
      expect(temp.store.getMeta('parser_version')).toBe('1');
      expect(temp.store.getMeta('missing_key')).toBeNull();
      temp.store.setMeta('custom', 'value');
      expect(temp.store.getMeta('custom')).toBe('value');
    } finally {
      temp.cleanup();
    }
  });

  it('replaces contents without leaving phantom FTS entries', () => {
    const temp = openTempStore();
    try {
      expect(
        temp.store.search({ query: 'prosthetic', page: 1, perPage: 10 }).total,
      ).toBeGreaterThan(0);
      temp.store.replaceAll(
        [makeSection({ citation: '1.1', text: 'Entirely new content now.' })],
        '2026-10-09',
        {},
      );
      expect(temp.store.countSections()).toBe(1);
      expect(temp.store.search({ query: 'prosthetic', page: 1, perPage: 10 }).total).toBe(0);
      expect(temp.store.search({ query: 'entirely', page: 1, perPage: 10 }).total).toBe(1);
    } finally {
      temp.cleanup();
    }
  });

  it('rolls back a failing transaction', () => {
    const temp = openTempStore();
    try {
      const before = temp.store.countSections();
      expect(() =>
        temp.store.transaction(() => {
          temp.store.setMeta('in_transaction', 'yes');
          throw new Error('abort');
        }),
      ).toThrow('abort');
      expect(temp.store.getMeta('in_transaction')).toBeNull();
      expect(temp.store.countSections()).toBe(before);
    } finally {
      temp.cleanup();
    }
  });

  it('looks up sections by exact citation', () => {
    const temp = openTempStore();
    try {
      const row = temp.store.getSection('4.125', 'section');
      expect(row?.heading).toBe('Diagnosis of mental disorders.');
      expect(row?.part).toBe('4');
      expect(row?.issueDate).toBe('2026-10-09');
      expect(temp.store.getSection('9.999', 'section')).toBeNull();
      // Section lookups are exact: appendices are not found as sections.
      expect(temp.store.getSection('Appendix A to Part 4', 'section')).toBeNull();
    } finally {
      temp.cleanup();
    }
  });

  it('looks up appendices case-insensitively', () => {
    const temp = openTempStore();
    try {
      expect(temp.store.getSection('appendix a to part 4', 'appendix')?.citation).toBe(
        'Appendix A to Part 4',
      );
    } finally {
      temp.cleanup();
    }
  });

  it('ranks matches and returns snippets', () => {
    const temp = openTempStore();
    try {
      const result = temp.store.search({ query: 'mental disorder', page: 1, perPage: 10 });
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.matchMode).toBe('and');
      const first = result.hits[0];
      expect(first).toBeDefined();
      expect(first?.snippet.length).toBeGreaterThan(0);
      expect(first?.score).toBeLessThan(0);
      expect(first?.citation).toMatch(/^\d+\.\d+|Appendix/);
    } finally {
      temp.cleanup();
    }
  });

  it('falls back to OR when AND finds nothing', () => {
    const temp = openTempStore();
    try {
      const result = temp.store.search({ query: 'mental zzzunfindable', page: 1, perPage: 10 });
      expect(result.matchMode).toBe('or');
      expect(result.total).toBeGreaterThan(0);
    } finally {
      temp.cleanup();
    }
  });

  it('returns zero results for unmatched queries', () => {
    const temp = openTempStore();
    try {
      const result = temp.store.search({ query: 'zzzunfindable', page: 1, perPage: 10 });
      expect(result.total).toBe(0);
      expect(result.hits).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });

  it('treats queries without alphanumerics as empty', () => {
    const temp = openTempStore();
    try {
      expect(temp.store.search({ query: '!!! ???', page: 1, perPage: 10 })).toMatchObject({
        total: 0,
        hits: [],
        matchMode: 'and',
      });
    } finally {
      temp.cleanup();
    }
  });

  it('filters by part', () => {
    const temp = openTempStore();
    try {
      const part4 = temp.store.search({ query: 'disorder', page: 1, perPage: 10, part: '4' });
      expect(part4.hits.every((hit) => hit.part === '4')).toBe(true);
      const part17 = temp.store.search({ query: 'prosthetic', page: 1, perPage: 10, part: '17' });
      expect(part17.hits.map((hit) => hit.citation)).toEqual(['17.15']);
      const impossible = temp.store.search({ query: 'mental', page: 1, perPage: 10, part: '17' });
      expect(impossible.total).toBe(0);
    } finally {
      temp.cleanup();
    }
  });

  it('filters by kind', () => {
    const temp = openTempStore();
    try {
      // "rating schedule" matches 4.130 (section) and Appendix A to Part 4.
      const sections = temp.store.search({
        query: 'rating schedule',
        page: 1,
        perPage: 10,
        kind: 'section',
      });
      expect(sections.total).toBe(1);
      expect(sections.hits.map((hit) => hit.citation)).toEqual(['4.130']);
      const appendices = temp.store.search({
        query: 'rating schedule',
        page: 1,
        perPage: 10,
        kind: 'appendix',
      });
      expect(appendices.total).toBe(1);
      expect(appendices.hits.map((hit) => hit.citation)).toEqual(['Appendix A to Part 4']);
      // Unfiltered: both kinds still match.
      const all = temp.store.search({ query: 'rating schedule', page: 1, perPage: 10 });
      expect(all.total).toBe(2);
    } finally {
      temp.cleanup();
    }
  });

  it('filters by chapter with exact, case-sensitive matching', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '9.1',
          chapter: 'II',
          part: '9',
          subpart: null,
          path: '/title:38/chapter:II/part:9',
          text: 'Disorder provisions enacted under chapter two authority.',
        }),
        makeSection({
          citation: '9.2',
          chapter: 'II',
          part: '9',
          subpart: null,
          kind: 'appendix',
          path: '/title:38/chapter:II/part:9',
          text: 'Disorder provisions tabled under chapter two authority.',
        }),
        makeSection({
          citation: '8.1',
          chapter: 'I',
          part: '8',
          subpart: null,
          path: '/title:38/chapter:I/part:8',
          text: 'Disorder provisions enacted under chapter one authority.',
        }),
      ],
    });
    try {
      const chapterTwo = temp.store.search({
        query: 'disorder',
        page: 1,
        perPage: 10,
        chapter: 'II',
      });
      expect(chapterTwo.total).toBe(2);
      expect(chapterTwo.hits.map((hit) => hit.citation).sort()).toEqual(['9.1', '9.2']);
      // Exact and case-sensitive: neither "ii" nor a decimal form matches.
      expect(
        temp.store.search({ query: 'disorder', page: 1, perPage: 10, chapter: 'ii' }).total,
      ).toBe(0);
      expect(
        temp.store.search({ query: 'disorder', page: 1, perPage: 10, chapter: '2' }).total,
      ).toBe(0);
    } finally {
      temp.cleanup();
    }
  });

  it('combines kind, chapter, and part filters', () => {
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '9.1',
          chapter: 'II',
          part: '9',
          subpart: null,
          path: '/title:38/chapter:II/part:9',
          text: 'Disorder provisions enacted under chapter two authority.',
        }),
        makeSection({
          citation: '9.2',
          chapter: 'II',
          part: '9',
          subpart: null,
          kind: 'appendix',
          path: '/title:38/chapter:II/part:9',
          text: 'Disorder provisions tabled under chapter two authority.',
        }),
        makeSection({
          citation: '8.1',
          chapter: 'I',
          part: '8',
          subpart: null,
          path: '/title:38/chapter:I/part:8',
          text: 'Disorder provisions enacted under chapter one authority.',
        }),
      ],
    });
    try {
      const sectionOnly = temp.store.search({
        query: 'disorder',
        page: 1,
        perPage: 10,
        kind: 'section',
        chapter: 'II',
      });
      expect(sectionOnly.total).toBe(1);
      expect(sectionOnly.hits.map((hit) => hit.citation)).toEqual(['9.1']);
      const appendixOnly = temp.store.search({
        query: 'disorder',
        page: 1,
        perPage: 10,
        kind: 'appendix',
        chapter: 'II',
      });
      expect(appendixOnly.total).toBe(1);
      expect(appendixOnly.hits.map((hit) => hit.citation)).toEqual(['9.2']);
      // All three filters together: the part filter prunes a chapter-II row
      // away even though kind and chapter alone would match it.
      const partPruned = temp.store.search({
        query: 'disorder',
        page: 1,
        perPage: 10,
        kind: 'appendix',
        chapter: 'II',
        part: '8',
      });
      expect(partPruned.total).toBe(0);
      const combined = temp.store.search({
        query: 'disorder',
        page: 1,
        perPage: 10,
        kind: 'appendix',
        chapter: 'II',
        part: '9',
      });
      expect(combined.total).toBe(1);
      expect(combined.hits.map((hit) => hit.citation)).toEqual(['9.2']);
    } finally {
      temp.cleanup();
    }
  });

  it('paginates results', () => {
    const temp = openTempStore();
    try {
      const page1 = temp.store.search({ query: 'disorder', page: 1, perPage: 1 });
      const page2 = temp.store.search({ query: 'disorder', page: 2, perPage: 1 });
      expect(page1.total).toBe(page2.total);
      expect(page1.hits).toHaveLength(1);
      expect(page2.hits).toHaveLength(1);
      expect(page1.hits[0]?.citation).not.toBe(page2.hits[0]?.citation);
      const page99 = temp.store.search({ query: 'disorder', page: 99, perPage: 10 });
      expect(page99.hits).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });
});

describe('Store resilience', () => {
  it('rejects corrupted database files with an actionable error', () => {
    const temp = openTempStore();
    const corruptPath = path.join(temp.dir, 'corrupt.sqlite');
    try {
      temp.store.close();
      writeFileSync(corruptPath, 'this is definitely not a sqlite database');
      expect(() => Store.open(corruptPath)).toThrow(StoreError);
      expect(() => Store.open(corruptPath)).toThrow(/cannot open index/);
    } finally {
      temp.cleanup();
    }
  });
});

describe('Store schema versioning', () => {
  /** A raw file stamped with `version` (only the version gate inspects it). */
  function makeVersionedFile(version: number): { file: string; cleanup: () => void } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-version-'));
    const file = path.join(dir, 'index.sqlite');
    const raw = new DatabaseSync(file);
    raw.exec('CREATE TABLE dummy(x)');
    raw.exec(`PRAGMA user_version = ${version}`);
    raw.close();
    return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it('rejects indexes written by a newer schema version', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-version-'));
    const file = path.join(dir, 'index.sqlite');
    try {
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE dummy(x)');
      raw.exec('PRAGMA user_version = 99');
      raw.close();
      expect(() => Store.open(file)).toThrow(/schema version 99/);
      expect(() => Store.open(file)).toThrow(/cfr-free sync/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(`adopts pre-versioning index files as schema v${SCHEMA_VERSION}`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-version-'));
    const file = path.join(dir, 'index.sqlite');
    try {
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE dummy(x)');
      raw.close();
      const store = Store.open(file);
      store.close();
      const check = new DatabaseSync(file);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({
        user_version: SCHEMA_VERSION,
      });
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adopts an older schema version when the caller vouches for a rebuild', () => {
    const v1 = makeVersionedFile(1);
    try {
      const store = Store.open(v1.file, { allowSchemaUpgrade: true });
      store.close();
      const check = new DatabaseSync(v1.file);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({
        user_version: SCHEMA_VERSION,
      });
      check.close();
    } finally {
      v1.cleanup();
    }
  });

  it('refuses an older schema version without the rebuild flag', () => {
    const v1 = makeVersionedFile(1);
    try {
      // The unchanged fail-open message: sync can now actually rebuild.
      expect(() => Store.open(v1.file)).toThrow(/schema version 1 is not supported/);
      expect(() => Store.open(v1.file)).toThrow(/cfr-free sync/);
    } finally {
      v1.cleanup();
    }
  });

  it('never adopts a newer schema version, flag or not', () => {
    const future = makeVersionedFile(99);
    try {
      expect(() => Store.open(future.file, { allowSchemaUpgrade: true })).toThrow(
        /schema version 99/,
      );
      expect(() => Store.open(future.file, { allowSchemaUpgrade: true })).toThrow(
        /downgrade is unsupported/,
      );
    } finally {
      future.cleanup();
    }
  });

  it('rebuilds a v1 index end-to-end: sync adopts the version and fills the edge table', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-version-'));
    const file = path.join(dir, 'index.sqlite');
    try {
      // A faithful v1 file: real schema + old rows, then section_references
      // dropped (v1 predates it) and the version stamped back to 1.
      const seed = Store.open(file);
      seed.replaceAll(
        [makeSection({ citation: '4.125', text: 'Old v1 body text.' })],
        '2026-01-01',
        {},
      );
      seed.close();
      const raw = new DatabaseSync(file);
      raw.exec('DROP TABLE section_references');
      raw.exec('PRAGMA user_version = 1');
      raw.close();

      // Offline eCFR: two sections, 4.130 cites § 4.125.
      const ecfr = {
        getTitleSchedule: async () => ({ upToDateAsOf: '2026-10-09' }),
        getStructureJson: async () => FIXTURE_STRUCTURE,
        getFullTitleXml: async () => `<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
<DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD>
<DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>
<DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis.</HEAD><P>New v2 body text.</P></DIV8>
<DIV8 N="4.130" TYPE="SECTION"><HEAD>§ 4.130 Evaluation.</HEAD><P>See § 4.125 for details.</P></DIV8>
</DIV5>
</DIV3>
</ECFR>`,
      } as unknown as EcfrApi;

      const store = Store.open(file, { allowSchemaUpgrade: true });
      try {
        const report = await syncIndex({ ecfr, store, logger: createTestLogger() });
        expect(report.sections).toBe(2);
        // The adopted (recreated) edge table was filled by the rebuild, and
        // the old v1 row is gone — wholesale replacement, not a merge.
        expect(store.citedBy('4.125')).toEqual(['4.130']);
        expect(store.getSection('4.125', 'section')?.text).toContain('New v2 body text');
      } finally {
        store.close();
      }
      const check = new DatabaseSync(file);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({
        user_version: SCHEMA_VERSION,
      });
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Store section backlinks', () => {
  it('materializes reverse-reference edges during replaceAllWithBaseline', () => {
    const temp = openTempStore({
      sections: [
        makeSection({ citation: '4.105', text: 'Basic entitlement criteria apply.' }),
        makeSection({
          citation: '4.106',
          text: 'Special monthly compensation criteria. See § 4.105 for basic entitlement.',
        }),
      ],
    });
    try {
      expect(temp.store.citedBy('4.105')).toEqual(['4.106']);
      expect(temp.store.citedBy('4.106')).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });

  it('clears stale edges on rebuild (sections wipe cascades)', () => {
    const temp = openTempStore({
      sections: [
        makeSection({ citation: '4.105', text: 'Basic entitlement criteria apply.' }),
        makeSection({
          citation: '4.106',
          text: 'Special monthly compensation criteria. See § 4.105 for basic entitlement.',
        }),
      ],
    });
    try {
      expect(temp.store.citedBy('4.105')).toEqual(['4.106']);
      // Rebuild with text that no longer references 4.105. A surviving edge
      // would reattach to whichever section reuses the freed rowid — the
      // empty result proves the wipe cleared the edge table too.
      temp.store.replaceAll(
        [
          makeSection({ citation: '4.105', text: 'Basic entitlement criteria apply.' }),
          makeSection({ citation: '4.106', text: 'Special monthly compensation criteria only.' }),
        ],
        '2026-10-16',
        {},
      );
      expect(temp.store.citedBy('4.105')).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });

  it('cascades edge deletion with its section row (FK ON DELETE CASCADE)', () => {
    const temp = openTempStore({
      sections: [
        makeSection({ citation: '4.105', text: 'Basic entitlement criteria apply.' }),
        makeSection({ citation: '4.106', text: 'See § 4.105 for basic entitlement.' }),
        makeSection({ citation: '4.107', text: 'Also see § 4.105 for details.' }),
      ],
    });
    try {
      expect(temp.store.citedBy('4.105')).toEqual(['4.106', '4.107']);
      // Delete one citing section directly: only ITS edge may vanish — the
      // per-row cascade constraint is live, not a wipe-shaped coincidence.
      const raw = new DatabaseSync(temp.indexPath);
      raw.exec("DELETE FROM sections WHERE citation = '4.106'");
      raw.close();
      expect(temp.store.citedBy('4.105')).toEqual(['4.107']);
    } finally {
      temp.cleanup();
    }
  });
});

describe('Store lock handling', () => {
  it('surfaces a friendly error when another writer holds the lock', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-busy-'));
    const file = path.join(dir, 'index.sqlite');
    const store = Store.open(file, { busyTimeoutMs: 50 });
    const blocker = new DatabaseSync(file);
    blocker.exec('BEGIN IMMEDIATE');
    try {
      expect(() => store.transaction(() => {})).toThrow(/locked by another cfr-free process/);
    } finally {
      blocker.exec('ROLLBACK');
      blocker.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still rolls back on inner failures', () => {
    const temp = openTempStore({ seed: false });
    try {
      expect(() =>
        temp.store.transaction(() => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(temp.store.countSections()).toBe(0);
    } finally {
      temp.cleanup();
    }
  });
});

describe('Store.backupTo', () => {
  it('fails cleanly when the export target is an existing database', () => {
    const temp = openTempStore();
    const target = path.join(temp.dir, 'taken.sqlite');
    try {
      const existing = new DatabaseSync(target);
      existing.exec('CREATE TABLE z(y)');
      existing.close();
      expect(() => temp.store.backupTo(target)).toThrow(StoreError);
      expect(() => temp.store.backupTo(target)).toThrow(/cannot export index/);
    } finally {
      temp.cleanup();
    }
  });
});

describe('Store search matches', () => {
  it('caps and dedupes the visible query terms per hit', () => {
    const temp = openTempStore();
    try {
      const result = temp.store.search({
        query:
          'the mental disorder the report the rating the agency the diagnosis conform shall return',
        page: 1,
        perPage: 5,
      });
      expect(result.hits[0]?.citation).toBe('4.125');
      const matches = result.hits[0]?.matches ?? [];
      expect(matches).toHaveLength(8); // capped: "shall"/"return" fall off
      expect(new Set(matches).size).toBe(matches.length);
      expect(matches).not.toContain('shall');
    } finally {
      temp.cleanup();
    }
  });
});

describe('Store transaction and integrity edge cases', () => {
  it('propagates non-busy BEGIN failures raw', () => {
    const temp = openTempStore();
    try {
      expect(() =>
        temp.store.transaction(() => {
          temp.store.transaction(() => undefined);
        }),
      ).toThrow(/within a transaction/);
    } finally {
      temp.cleanup();
    }
  });

  it('wraps busy errors raised mid-transaction', () => {
    const temp = openTempStore();
    try {
      expect(() =>
        temp.store.transaction(() => {
          throw Object.assign(new Error('synthetic contention'), { errcode: 5 });
        }),
      ).toThrow(/interrupted by another cfr-free process/);
    } finally {
      temp.cleanup();
    }
  });

  it('rethrows non-object failures from the transaction body', () => {
    const temp = openTempStore();
    try {
      let caught: unknown;
      try {
        temp.store.transaction(() => {
          throw 'plain failure';
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe('plain failure');
    } finally {
      temp.cleanup();
    }
  });

  it('opens an index in the current directory without mkdir', () => {
    const relative = 'cfr-free-relative-open-test.sqlite';
    try {
      const store = Store.open(relative);
      store.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${relative}${suffix}`, { force: true });
      }
    }
  });

  it('fails the integrity check on a database with corrupted pages', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-integrity-'));
    const file = path.join(dir, 'index.sqlite');
    const damaged = path.join(dir, 'damaged.sqlite');
    try {
      const source = Store.open(file);
      source.replaceAll(FIXTURE_SECTIONS, '2026-10-09', {});
      source.close();
      // Find a btree root page that is not the schema page, then corrupt only
      // it: the header and page 1 must stay valid so opening gets far enough
      // for quick_check to report the damage (SPEC §12 #9 in spirit).
      const raw = new DatabaseSync(file);
      const roots = raw
        .prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND rootpage > 1")
        .all() as Array<{ rootpage: number }>;
      raw.close();
      const rootpage = roots[0]?.rootpage ?? 0;
      expect(rootpage).toBeGreaterThan(1);
      const bytes = readFileSync(file);
      const pageSize = bytes.readUInt16BE(16) || 65_536;
      const start = (rootpage - 1) * pageSize;
      expect(bytes.length).toBeGreaterThan(start);
      bytes.fill(0xab, start, start + pageSize);
      writeFileSync(damaged, bytes);
      expect(() => Store.open(damaged)).toThrow(/integrity check failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
