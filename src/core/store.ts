import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SectionKind, RawSection } from './xml.js';

/**
 * SQLite index of Title 38: one row per section/appendix, plus an FTS5
 * external-content index kept consistent by triggers. All writes happen in a
 * single transaction so concurrent readers (WAL) never observe a partial
 * index.
 */

type Statement = ReturnType<DatabaseSync['prepare']>;

/** Raised when the local index cannot be opened or queried. */
export class StoreError extends Error {
  override readonly name = 'StoreError';
}

/** FTS5 caps the number of terms we emit per query (bounded wildcards). */
export const MAX_TERMS = 12;

export interface SectionRow {
  readonly citation: string;
  readonly kind: SectionKind;
  readonly heading: string;
  readonly chapter: string | null;
  readonly subchapter: string | null;
  readonly part: string | null;
  readonly subpart: string | null;
  readonly subjectGroup: string | null;
  readonly path: string;
  readonly text: string;
  readonly markdown: string;
  readonly issueDate: string;
}

export interface SearchHit {
  readonly citation: string;
  readonly heading: string;
  readonly part: string | null;
  readonly path: string;
  readonly snippet: string;
  /** bm25 score — lower is better (more negative = stronger match). */
  readonly score: number;
}

export type MatchMode = 'and' | 'or';

export interface SearchQuery {
  readonly query: string;
  readonly page: number;
  readonly perPage: number;
  readonly part?: string | undefined;
}

export interface SearchOutcome {
  readonly hits: readonly SearchHit[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  readonly matchMode: MatchMode;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  citation TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('section', 'appendix')),
  heading TEXT NOT NULL,
  chapter TEXT,
  subchapter TEXT,
  part TEXT,
  subpart TEXT,
  subject_group TEXT,
  path TEXT NOT NULL,
  text TEXT NOT NULL,
  markdown TEXT NOT NULL,
  issue_date TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  citation, heading, text,
  content = 'sections',
  content_rowid = 'id',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO sections_fts(rowid, citation, heading, text)
  VALUES (new.id, new.citation, new.heading, new.text);
END;

CREATE TRIGGER IF NOT EXISTS sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, citation, heading, text)
  VALUES ('delete', old.id, old.citation, old.heading, old.text);
END;

CREATE TRIGGER IF NOT EXISTS sections_au AFTER UPDATE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, citation, heading, text)
  VALUES ('delete', old.id, old.citation, old.heading, old.text);
  INSERT INTO sections_fts(rowid, citation, heading, text)
  VALUES (new.id, new.citation, new.heading, new.text);
END;
`;

const INSERT_SECTION_SQL = `
INSERT INTO sections (
  citation, kind, heading, chapter, subchapter, part, subpart,
  subject_group, path, text, markdown, issue_date
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_META_SQL = `
INSERT INTO meta (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

const SNIPPET_TEXT = `snippet(sections_fts, 2, '', '', '…', 24)`;
const SNIPPET_HEADING = `snippet(sections_fts, 1, '', '', '…', 24)`;
const SNIPPET_EXPR = `CASE WHEN ${SNIPPET_TEXT} = '' THEN ${SNIPPET_HEADING} ELSE ${SNIPPET_TEXT} END`;

const SELECT_MATCHES_SQL = `
SELECT s.citation, s.heading, s.part, s.path, ${SNIPPET_EXPR} AS snippet,
       bm25(sections_fts) AS score
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
WHERE sections_fts MATCH ?
ORDER BY score
LIMIT ? OFFSET ?`;

const SELECT_MATCHES_PART_SQL = `
SELECT s.citation, s.heading, s.part, s.path, ${SNIPPET_EXPR} AS snippet,
       bm25(sections_fts) AS score
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
WHERE sections_fts MATCH ? AND s.part = ?
ORDER BY score
LIMIT ? OFFSET ?`;

const COUNT_MATCHES_SQL = `
SELECT count(*) AS n
FROM sections_fts
WHERE sections_fts MATCH ?`;

const COUNT_MATCHES_PART_SQL = `
SELECT count(*) AS n
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
WHERE sections_fts MATCH ? AND s.part = ?`;

/**
 * Translate free text into a safe FTS5 match string.
 *
 * Every token is emitted as a quoted prefix phrase (`"tok"*`), so user input
 * can never introduce FTS5 operators. The result is always passed to SQLite
 * as a bound parameter, never concatenated into SQL.
 */
export function toFtsQuery(raw: string, mode: MatchMode): string | null {
  const tokens = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .slice(0, MAX_TERMS);
  if (tokens.length === 0) return null;
  const terms = tokens.map((token) => `"${token}"*`);
  return terms.join(mode === 'and' ? ' AND ' : ' OR ');
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toSectionRow(row: Record<string, unknown>): SectionRow {
  return {
    citation: String(row['citation']),
    kind: row['kind'] === 'appendix' ? 'appendix' : 'section',
    heading: String(row['heading']),
    chapter: nullableString(row['chapter']),
    subchapter: nullableString(row['subchapter']),
    part: nullableString(row['part']),
    subpart: nullableString(row['subpart']),
    subjectGroup: nullableString(row['subject_group']),
    path: String(row['path']),
    text: String(row['text']),
    markdown: String(row['markdown']),
    issueDate: String(row['issue_date']),
  };
}

export class Store {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, Statement>();
  private readonly filePath: string;

  private constructor(db: DatabaseSync, filePath: string) {
    this.db = db;
    this.filePath = filePath;
  }

  /**
   * Open (creating if needed) the index at `filePath` and ensure the schema.
   *
   * @throws {StoreError} when the file fails its integrity check.
   */
  static open(filePath: string): Store {
    const directory = path.dirname(filePath);
    if (directory.length > 0 && directory !== '.') mkdirSync(directory, { recursive: true });

    let db: DatabaseSync;
    try {
      db = new DatabaseSync(filePath);
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
      const result = check ? String(Object.values(check)[0] ?? '') : '';
      if (result !== 'ok') throw new StoreError(`integrity check failed: ${result || 'no result'}`);
      db.exec(SCHEMA_SQL);
    } catch (error) {
      throw new StoreError(
        `cannot open index at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return new Store(db, filePath);
  }

  get path(): string {
    return this.filePath;
  }

  private stmt(sql: string): Statement {
    let prepared = this.statements.get(sql);
    if (!prepared) {
      prepared = this.db.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }

  /** Run `fn` inside a single IMMEDIATE transaction (rollback on throw). */
  transaction(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Rollback is best-effort: the connection may already be clean.
      }
      throw error;
    }
  }

  /** Atomically replace the entire index contents. */
  replaceAll(
    sections: readonly RawSection[],
    issueDate: string,
    meta: Readonly<Record<string, string>>,
  ): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM sections');
      const insert = this.stmt(INSERT_SECTION_SQL);
      for (const section of sections) {
        insert.run(
          section.citation,
          section.kind,
          section.heading,
          section.chapter,
          section.subchapter,
          section.part,
          section.subpart,
          section.subjectGroup,
          section.path,
          section.text,
          section.markdown,
          issueDate,
        );
      }
      const upsert = this.stmt(UPSERT_META_SQL);
      for (const [key, value] of Object.entries(meta)) upsert.run(key, value);
    });
  }

  countSections(): number {
    const row = this.stmt('SELECT count(*) AS n FROM sections').get() as
      Record<string, unknown> | undefined;
    return row ? Number(row['n'] ?? 0) : 0;
  }

  getMeta(key: string): string | null {
    const row = this.stmt('SELECT value FROM meta WHERE key = ?').get(key) as
      Record<string, unknown> | undefined;
    return row ? String(row['value']) : null;
  }

  setMeta(key: string, value: string): void {
    this.stmt(UPSERT_META_SQL).run(key, value);
  }

  /** Look up one section/appendix by canonical citation. */
  getSection(citation: string, kind: SectionKind): SectionRow | null {
    const sql =
      kind === 'appendix'
        ? 'SELECT * FROM sections WHERE kind = ? AND citation = ? COLLATE NOCASE'
        : 'SELECT * FROM sections WHERE kind = ? AND citation = ?';
    const row = this.stmt(sql).get(kind, citation) as Record<string, unknown> | undefined;
    return row ? toSectionRow(row) : null;
  }

  private countMatches(match: MatchMode, query: string, part?: string): number {
    const ftsQuery = toFtsQuery(query, match);
    if (ftsQuery === null) return 0;
    const sql = part === undefined ? COUNT_MATCHES_SQL : COUNT_MATCHES_PART_SQL;
    const row =
      part === undefined ? this.stmt(sql).get(ftsQuery) : this.stmt(sql).get(ftsQuery, part);
    return row ? Number((row as Record<string, unknown>)['n'] ?? 0) : 0;
  }

  /**
   * Ranked full-text search.
   *
   * Tries an AND query first for precision; falls back to OR once when AND
   * finds nothing. Each attempt is a separate prepared statement execution.
   */
  search(query: SearchQuery): SearchOutcome {
    const perPage = Math.max(1, query.perPage);
    const offset = (Math.max(1, query.page) - 1) * perPage;

    let mode: MatchMode = 'and';
    let total = this.countMatches('and', query.query, query.part);
    if (total === 0) {
      const orTotal = this.countMatches('or', query.query, query.part);
      if (orTotal > 0) {
        mode = 'or';
        total = orTotal;
      }
    }
    if (total === 0) return { hits: [], total: 0, page: query.page, perPage, matchMode: mode };

    const ftsQuery = toFtsQuery(query.query, mode);
    if (ftsQuery === null)
      return { hits: [], total: 0, page: query.page, perPage, matchMode: mode };

    const sql = query.part === undefined ? SELECT_MATCHES_SQL : SELECT_MATCHES_PART_SQL;
    const statement = this.stmt(sql);
    const rows =
      query.part === undefined
        ? statement.all(ftsQuery, perPage, offset)
        : statement.all(ftsQuery, query.part, perPage, offset);

    const hits = rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        citation: String(record['citation']),
        heading: String(record['heading']),
        part: nullableString(record['part']),
        path: String(record['path']),
        snippet: String(record['snippet'] ?? ''),
        score: Number(record['score'] ?? 0),
      };
    });
    return { hits, total, page: query.page, perPage, matchMode: mode };
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
