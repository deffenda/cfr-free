import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashText } from './changes.js';
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
  /** Query terms visible in this hit's citation, heading, or snippet. */
  readonly matches: readonly string[];
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

-- FTS external-content triggers: keep the index consistent with the
-- 'sections' table on every write path. All three must be updated together
-- if columns ever change (single schema, no migrations: index is rebuilt
-- wholesale by sync).
CREATE TRIGGER IF NOT EXISTS sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO sections_fts(rowid, citation, heading, text)
  VALUES (new.id, new.citation, new.heading, new.text);
END;

-- Delete-side mirror of sections_ai (external-content tables do not track
-- deletions themselves).
CREATE TRIGGER IF NOT EXISTS sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, citation, heading, text)
  VALUES ('delete', old.id, old.citation, old.heading, old.text);
END;

-- Update path: remove the old index row, then index the new values.
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

// 36 tokens ≈ 2–3 sentences: enough context to quote from, bounded enough
// for token-sensitive MCP consumers. tidySnippet() then trims leading
// mid-sentence fragments (SPEC: sentence-boundary fidelity).
const SNIPPET_TEXT = `snippet(sections_fts, 2, '', '', '…', 36)`;
const SNIPPET_HEADING = `snippet(sections_fts, 1, '', '', '…', 36)`;
const SNIPPET_EXPR = `CASE WHEN ${SNIPPET_TEXT} = '' THEN ${SNIPPET_HEADING} ELSE ${SNIPPET_TEXT} END`;

/** Current schema version, stored in `PRAGMA user_version`. */
const SCHEMA_VERSION = 1;

/** How long a connection waits on a locked database before failing. */
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface StoreOpenOptions {
  /** Override the busy-wait timeout (tests use a short one). */
  readonly busyTimeoutMs?: number;
}

// Column weights (citation 10, heading 5, body 1): exact-citation and
// heading matches must outrank body-only matches (SPEC §13).
const SCORE_EXPR = 'bm25(sections_fts, 10.0, 5.0, 1.0) AS score';

const SELECT_MATCHES_SQL = `
SELECT s.citation, s.heading, s.part, s.path, ${SNIPPET_EXPR} AS snippet,
       ${SCORE_EXPR}
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
WHERE sections_fts MATCH ?
ORDER BY score
LIMIT ? OFFSET ?`;

const SELECT_MATCHES_PART_SQL = `
SELECT s.citation, s.heading, s.part, s.path, ${SNIPPET_EXPR} AS snippet,
       ${SCORE_EXPR}
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

const DIRECT_MATCH_SQL = `
SELECT 1
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
WHERE sections_fts MATCH ? AND s.citation = ? COLLATE NOCASE
LIMIT 1`;

/**
 * Curated VA claims-language → regulatory-phrase expansions (one direction:
 * acronym → phrase). Queries written in rating-office shorthand ("ptsd",
 * "TDIU", "SMC") match text that only spells the concept out, while the
 * primary prefix term still catches text that uses the acronym itself.
 * Kept deliberately small: every entry is unambiguous in Title 38 context.
 */
const SYNONYM_PHRASES: Readonly<Record<string, string>> = {
  ptsd: 'posttraumatic stress',
  tbi: 'traumatic brain injury',
  tdiu: 'individual unemployability',
  smc: 'special monthly compensation',
  dic: 'dependency indemnity compensation',
  mst: 'military sexual trauma',
  hlr: 'high level review',
  bva: 'board of veterans appeals',
  nsc: 'non service connected',
};

/**
 * Translate free text into a safe FTS5 match string.
 *
 * Quoted spans become phrase queries (exact token sequence, prefix on the
 * last token) so verbatim regulatory language can be searched as written.
 * Every other token is emitted as a quoted prefix (`"tok"*`), optionally
 * grouped with a curated claims-language synonym phrase. User input can
 * never introduce FTS5 operators: every emitted piece is alphanumeric
 * tokens wrapped in quotes, and the result is always passed to SQLite as a
 * bound parameter, never concatenated into SQL.
 */
export function toFtsQuery(raw: string, mode: MatchMode): string | null {
  const parts: string[] = [];
  let budget = MAX_TERMS;

  const remaining = raw.toLowerCase().replace(/"([^"]{3,200})"/g, (_match, span: string) => {
    const words = span.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
    if (words.length > 0 && budget > 0) {
      parts.push(`"${words.join(' ')}"*`);
      budget = Math.max(0, budget - words.length);
    }
    return ' ';
  });

  const tokens = remaining
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .slice(0, budget);
  for (const token of tokens) {
    const phrase = SYNONYM_PHRASES[token];
    parts.push(phrase === undefined ? `"${token}"*` : `("${token}"* OR "${phrase}"*)`);
  }
  if (parts.length === 0) return null;
  return parts.join(mode === 'and' ? ' AND ' : ' OR ');
}

/**
 * Trim a snippet so it never starts mid-sentence: when the window opens
 * on a lowercase fragment and a sentence boundary arrives in the first
 * 60% (so at least ~40% of the window remains), restart at the next
 * sentence. Returns the input unchanged when no safe boundary exists.
 */
export function tidySnippet(raw: string): string {
  const snippet = raw.trim();
  if (!/^[a-z]/.test(snippet)) return snippet;
  const boundary = snippet.match(/[.!?]["')\]]?\s+/);
  if (boundary?.index !== undefined && boundary.index < snippet.length * 0.6) {
    return snippet.slice(boundary.index + boundary[0].length);
  }
  return snippet;
}

/** Ensure the on-disk schema version is compatible; adopt legacy files. */
function ensureSchemaVersion(db: DatabaseSync): void {
  const versionRow = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined;
  const version = Number(versionRow?.['user_version'] ?? 0);
  if (version !== 0 && version !== SCHEMA_VERSION) {
    throw new StoreError(
      `index schema version ${version} is not supported (expected ${SCHEMA_VERSION}) — rebuild it with \`cfr-free sync\``,
    );
  }
  if (version !== SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** True for SQLITE_BUSY/SQLITE_LOCKED failures (concurrent writer). */
function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { errcode?: unknown; message?: unknown };
  if (err.errcode === 5 || err.errcode === 6) return true;
  return (
    typeof err.message === 'string' &&
    /database is locked|database table is locked|SQLITE_BUSY/i.test(err.message)
  );
}

/** Query tokens that actually appear in a hit (citation/heading/snippet). */
export function visibleMatches(
  tokens: readonly string[],
  hit: {
    citation: string;
    heading: string;
    snippet: string;
  },
): string[] {
  const words = `${hit.citation}\n${hit.heading}\n${hit.snippet}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const token of tokens) {
    if (matches.length >= 8) break;
    if (seen.has(token)) continue;
    seen.add(token);
    // Word-start match mirrors the FTS prefix semantics ("term"*) and avoids
    // false positives like token "in" matching inside "brain".
    if (words.some((word) => word.startsWith(token))) matches.push(token);
  }
  return matches;
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
  static open(filePath: string, options: StoreOpenOptions = {}): Store {
    const directory = path.dirname(filePath);
    if (directory.length > 0 && directory !== '.') mkdirSync(directory, { recursive: true });

    let db: DatabaseSync;
    try {
      db = new DatabaseSync(filePath);
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      // Wait for a concurrent writer (e.g. a second sync) instead of failing
      // instantly with a cryptic SQLITE_BUSY.
      db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
      const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
      const result = check ? String(Object.values(check)[0] ?? '') : '';
      if (result !== 'ok') throw new StoreError(`integrity check failed: ${result || 'no result'}`);
      db.exec(SCHEMA_SQL);
      ensureSchemaVersion(db);
    } catch (error) {
      if (error instanceof StoreError) {
        throw new StoreError(`cannot open index at ${filePath}: ${error.message}`);
      }
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
    try {
      this.db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      if (isBusyError(error)) {
        throw new StoreError(
          'index is locked by another cfr-free process (a sync appears to be running) — wait for it to finish and retry',
        );
      }
      throw error;
    }
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Rollback is best-effort: the connection may already be clean.
      }
      if (isBusyError(error)) {
        throw new StoreError(
          'index write was interrupted by another cfr-free process — wait for it to finish and retry',
        );
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

  /**
   * Write a consistent snapshot of the index (including WAL content) to
   * `target` via `VACUUM INTO`. The target must not already exist.
   */
  backupTo(target: string): void {
    try {
      this.db.prepare('VACUUM INTO ?').run(target);
    } catch (error) {
      throw new StoreError(
        `cannot export index to ${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

  /** Whether any indexed row (section or appendix) carries this citation. */
  hasSection(citation: string): boolean {
    const row = this.stmt('SELECT 1 FROM sections WHERE citation = ? COLLATE NOCASE LIMIT 1').get(
      citation,
    );
    return row !== undefined;
  }

  /** sha256 of every indexed section's text — the pre-sync snapshot. */
  /**
   * SHA-256 of every section's text, keyed by citation. Read in bounded
   * rowid batches: materializing the whole corpus in one `.all()` would
   * roughly double sync's peak memory (text + map), which matters in the
   * memory-capped container image.
   */
  captureTextHashes(): Map<string, string> {
    const hashes = new Map<string, string>();
    const statement = this.stmt(
      'SELECT id, citation, text FROM sections WHERE id > ? ORDER BY id LIMIT 500',
    );
    let cursor = -1;
    for (;;) {
      const rows = statement.all(cursor) as Record<string, unknown>[];
      if (rows.length === 0) break;
      for (const row of rows) {
        hashes.set(String(row['citation']), hashText(String(row['text'])));
        cursor = Number(row['id']);
      }
    }
    return hashes;
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

    const queryTokens = query.query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 0);

    const hits = rows.map((row) => {
      const record = row as Record<string, unknown>;
      const hit = {
        citation: String(record['citation']),
        heading: String(record['heading']),
        part: nullableString(record['part']),
        path: String(record['path']),
        snippet: tidySnippet(String(record['snippet'] ?? '')),
        score: Number(record['score'] ?? 0),
      };
      return { ...hit, matches: visibleMatches(queryTokens, hit) };
    });
    return { hits, total, page: query.page, perPage, matchMode: mode };
  }

  /**
   * Whether an exact citation participates in the FTS result set for this
   * query/mode — used by the service to adjust `total` when it prepends a
   * direct citation hit that FTS itself did not return.
   */
  hasSearchMatch(mode: MatchMode, rawQuery: string, citation: string): boolean {
    const ftsQuery = toFtsQuery(rawQuery, mode);
    if (ftsQuery === null) return false;
    const row = this.stmt(DIRECT_MATCH_SQL).get(ftsQuery, citation);
    return row !== undefined;
  }

  /** Every part present in the index, with per-kind counts. */
  listParts(): { part: string; sections: number; appendices: number }[] {
    const rows = this.stmt(
      `
      SELECT part,
             SUM(kind = 'section') AS sections,
             SUM(kind = 'appendix') AS appendices
      FROM sections
      WHERE part IS NOT NULL AND part != ''
      GROUP BY part
      ORDER BY CAST(part AS INTEGER), part
    `,
    ).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      part: String(row['part']),
      sections: Number(row['sections'] ?? 0),
      appendices: Number(row['appendices'] ?? 0),
    }));
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
