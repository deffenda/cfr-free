import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Store, StoreError, SCHEMA_VERSION } from '../src/core/store.js';
import { syncIndex } from '../src/core/sync.js';
import type { EcfrApi } from '../src/core/ecfr.js';
import {
  createTestLogger,
  FIXTURE_SECTIONS,
  FIXTURE_STRUCTURE,
  makeSection,
  openTempStore,
} from './helpers.js';

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
      // The OR tier is the only candidate tier, so the mode reports it.
      expect(result.matchMode).toBe('or');
      const first = result.hits[0];
      expect(first).toBeDefined();
      expect(first?.snippet.length).toBeGreaterThan(0);
      expect(first?.score).toBeLessThan(0);
      expect(first?.citation).toMatch(/^\d+\.\d+|Appendix/);
    } finally {
      temp.cleanup();
    }
  });

  it('searches the OR candidate set when no term matches every row', () => {
    const temp = openTempStore();
    try {
      // "zzzunfindable" matches nothing, but "mental" does: the candidate set
      // is the OR tier, so the section is a candidate and ranks by the
      // heading-phrase key, then the AND-tier membership, then bm25.
      const result = temp.store.search({ query: 'mental zzzunfindable', page: 1, perPage: 10 });
      expect(result.matchMode).toBe('or');
      expect(result.total).toBeGreaterThan(0);
      expect(result.hits.map((hit) => hit.citation)).toContain('4.125');
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
        matchMode: 'or',
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
      // The candidate set is the OR tier: "rating schedule" matches 4.130
      // (both terms) and 4.125 ("rating agency" — one term). § 4.125 is a
      // candidate now, and it ranks BELOW § 4.130 because § 4.130 carries
      // every query term (the AND-tier membership boost).
      const sections = temp.store.search({
        query: 'rating schedule',
        page: 1,
        perPage: 10,
        kind: 'section',
      });
      expect(sections.total).toBe(2);
      expect(sections.hits.map((hit) => hit.citation)).toEqual(['4.130', '4.125']);
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
      expect(all.total).toBe(3);
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

describe('Store ranking: exception demotion and citation tie-break', () => {
  // The corpus's real § 4.85/§ 4.86 shape: BOTH headings carry the query's
  // bridge phrase ("hearing impairment"), so the heading key ties and both
  // sections are AND members — § 4.86's heavier body repetition would win
  // on bm25 alone (the measured baseline state; research doc 2026-10-21).
  const HEARING_SECTIONS = [
    makeSection({
      citation: '4.85',
      heading: 'Evaluation of hearing impairment.',
      text: 'How hearing loss is rated under this evaluation of hearing impairment. Exceptions to the rule are noted here.',
      markdown: '## Evaluation of hearing impairment.',
    }),
    makeSection({
      citation: '4.86',
      heading: 'Exceptional patterns of hearing impairment.',
      text:
        'How is hearing loss rated in exceptional patterns: hearing loss rated, hearing loss rated, ' +
        'hearing impairment rated. Exceptions to the rule: exceptions to the hearing impairment rule, ' +
        'the rule and its exceptions. Rated hearing loss again.',
      markdown: '## Exceptional patterns of hearing impairment.',
    }),
  ];

  it('demotes an announcing exception heading when the query does not ask about exceptions', () => {
    const temp = openTempStore({ sections: HEARING_SECTIONS });
    try {
      // "how is hearing loss rated": no query term starts with "exception",
      // so the demotion key applies and § 4.85 leads despite § 4.86's body
      // repetition (which hands § 4.86 the answer without the demotion).
      const result = temp.store.search({
        query: 'how is hearing loss rated',
        page: 1,
        perPage: 10,
      });
      expect(result.total).toBe(2);
      expect(result.hits.map((hit) => hit.citation)).toEqual(['4.85', '4.86']);
    } finally {
      temp.cleanup();
    }
  });

  it('keeps the demotion off when the query itself asks about exceptions', () => {
    const temp = openTempStore({ sections: HEARING_SECTIONS });
    try {
      // "exceptions" in the query switches the demotion key off: § 4.86 and
      // § 4.85 tie on the heading key and the AND tier, and § 4.86's body
      // repetition decides on bm25. Applied unconditionally, the demotion
      // key would break that tie toward § 4.85 instead.
      const result = temp.store.search({
        query: 'exceptions to the hearing impairment rule',
        page: 1,
        perPage: 10,
      });
      expect(result.hits.map((hit) => hit.citation)).toEqual(['4.86', '4.85']);
    } finally {
      temp.cleanup();
    }
  });

  // The audit of 2026-10-21 (P1-20261021-06) reproduced the defect with
  // THESE sections: the general provision mentions the exceptions in
  // passing, while the exception provision repeats the phrase, so the body
  // repetition — and not the demotion — is what separates the two.
  //
  // Note the fixture's property: "the hearing impairment" is a phrase
  // NEITHER heading contains, so a query quoting it leaves the heading
  // column out of the bm25 comparison and the body repetition decides. That
  // is what makes the demotion DECISIVE for those queries — without it the
  // general provision's shorter heading would win on bm25 anyway and the
  // assertions could not tell the demotion on from the demotion off.
  const AUDIT_HEARING_SECTIONS = [
    makeSection({
      citation: '4.85',
      heading: 'Evaluation of hearing impairment.',
      text: 'The hearing impairment exceptions are elsewhere.',
      markdown: '## Evaluation of hearing impairment.',
    }),
    makeSection({
      citation: '4.86',
      heading: 'Exceptional patterns of hearing impairment.',
      text:
        'The hearing impairment exceptions apply here. The hearing impairment exceptions govern this evaluation. ' +
        'Hearing impairment exceptions apply here.',
      markdown: '## Exceptional patterns of hearing impairment.',
    }),
  ];

  it('keeps the demotion off when a QUOTED span asks about exceptions', () => {
    const temp = openTempStore({ sections: AUDIT_HEARING_SECTIONS });
    try {
      // A quoted span is ONE term, so the exception word does not START the
      // term and a startsWith gate missed it: the demotion stayed on and
      // the GENERAL provision led, the opposite of what the user asked for.
      const result = temp.store.search({
        query: '"hearing impairment exceptions"',
        page: 1,
        perPage: 10,
      });
      expect(result.total).toBe(2);
      expect(result.hits.map((hit) => hit.citation)).toEqual(['4.86', '4.85']);
    } finally {
      temp.cleanup();
    }
  });

  it('keeps the demotion off for the unquoted form of the same question', () => {
    const temp = openTempStore({ sections: AUDIT_HEARING_SECTIONS });
    try {
      // The unquoted form was never broken: the gate saw the bare
      // "exceptions" token. It must stay that way after the fix.
      const result = temp.store.search({
        query: 'hearing impairment exceptions',
        page: 1,
        perPage: 10,
      });
      expect(result.total).toBe(2);
      expect(result.hits.map((hit) => hit.citation)).toEqual(['4.86', '4.85']);
    } finally {
      temp.cleanup();
    }
  });

  it('still demotes the announcing heading for a query that asks about nothing exceptional', () => {
    const temp = openTempStore({ sections: AUDIT_HEARING_SECTIONS });
    try {
      // No term names an exception, so the demotion must fire: the general
      // provision leads even though the exception's body repeats the phrase
      // three times and would win on bm25 alone.
      const plain = temp.store.search({
        query: 'hearing impairment',
        page: 1,
        perPage: 10,
      });
      expect(plain.total).toBe(2);
      expect(plain.hits.map((hit) => hit.citation)).toEqual(['4.85', '4.86']);

      // The QUOTED span is the decisive form of the same control: it is a
      // phrase NEITHER heading contains, so no heading column separates the
      // rows and the body repetition decides on bm25 — with the demotion
      // wrongly switched off, § 4.86 would lead here.
      const quoted = temp.store.search({
        query: '"the hearing impairment"',
        page: 1,
        perPage: 10,
      });
      expect(quoted.total).toBe(2);
      expect(quoted.hits.map((hit) => hit.citation)).toEqual(['4.85', '4.86']);
    } finally {
      temp.cleanup();
    }
  });

  it('does not switch the demotion off for a non-boundary relative of the word', () => {
    const temp = openTempStore({ sections: AUDIT_HEARING_SECTIONS });
    try {
      // "unexceptional", "antiexception" and "exceptionally" CONTAIN the
      // letters of the word but are not the word: a substring test would
      // switch the demotion off and hand the answer to the exception. The
      // quoted span is the decisive control — a phrase neither heading
      // contains, so the body repetition decides on bm25 and the demotion
      // is the only thing that keeps § 4.85 first.
      for (const word of ['unexceptional', 'antiexception', 'exceptionally']) {
        const result = temp.store.search({
          query: `"the hearing impairment" ${word}`,
          page: 1,
          perPage: 10,
        });
        expect(result.total).toBe(2);
        expect(result.hits.map((hit) => hit.citation)).toEqual(['4.85', '4.86']);
      }
    } finally {
      temp.cleanup();
    }
  });

  it('orders a genuine score tie by citation so one query returns one stable order', () => {
    // Identical heading and body: every ranking key ties through bm25.
    // Inserted LATER citation first, so only the s.citation tie-break can
    // order the rows by citation — rowid order would give 4.86 first.
    const temp = openTempStore({
      sections: [
        makeSection({
          citation: '4.86',
          heading: 'Evaluation of hearing impairment.',
          text: 'How hearing loss is rated under this evaluation of hearing impairment.',
          markdown: '## Evaluation of hearing impairment.',
        }),
        makeSection({
          citation: '4.85',
          heading: 'Evaluation of hearing impairment.',
          text: 'How hearing loss is rated under this evaluation of hearing impairment.',
          markdown: '## Evaluation of hearing impairment.',
        }),
      ],
    });
    try {
      const query = 'how is hearing loss rated';
      const first = temp.store.search({ query, page: 1, perPage: 10 });
      const second = temp.store.search({ query, page: 1, perPage: 10 });
      const order = (result: { readonly hits: readonly { citation: string }[] }): string[] =>
        result.hits.map((hit) => hit.citation);
      expect(order(first)).toEqual(['4.85', '4.86']);
      expect(order(second)).toEqual(order(first));
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
      // for quick_check to report the damage (delivery log §12 #9 in spirit).
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
