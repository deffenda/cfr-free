import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Store, StoreError, MAX_TERMS, toFtsQuery } from '../src/core/store.js';
import { FIXTURE_SECTIONS, makeSection, openTempStore } from './helpers.js';

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

  it('adopts pre-versioning index files as schema v1', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-version-'));
    const file = path.join(dir, 'index.sqlite');
    try {
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE dummy(x)');
      raw.close();
      const store = Store.open(file);
      store.close();
      const check = new DatabaseSync(file);
      expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
