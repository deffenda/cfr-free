import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashContent } from './changes.js';
import {
  EXCEPTION_DEMOTION_KEY,
  asksAboutExceptions,
  buildFtsQueries,
  contentTerms,
  queryTerms,
  tidySnippet,
  toFtsQuery,
  visibleMatches,
  type MatchMode,
  type QueryTerm,
} from './query.js';
import { extractReferences } from './references.js';
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
  /** The index issue date the row was read at; used to build the dated eCFR URL. */
  readonly issueDate: string;
  /** bm25 score — lower is better (more negative = stronger match). */
  readonly score: number;
  /** Query terms visible in this hit's citation, heading, or snippet. */
  readonly matches: readonly string[];
}

export interface SearchQuery {
  readonly query: string;
  readonly page: number;
  readonly perPage: number;
  readonly part?: string | undefined;
  readonly kind?: SectionKind | undefined;
  readonly chapter?: string | undefined;
}

export interface SearchOutcome {
  readonly hits: readonly SearchHit[];
  /** Size of the CANDIDATE SET — the rows the pagination walks. */
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  /**
   * The tier the candidate set came from.
   *
   * The OR tier is the only candidate tier: a section matching at least one
   * query term is a candidate, and the AND tier (every term) survives only
   * as a ranking boost. The field stays in the response (its `and`/`or`
   * enum is part of the wire contract) and reports `or`.
   */
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

-- Reverse cross-reference edges ("what cites X"), the materialized
-- counterpart of the forward "references" list a section read computes on
-- the fly. Populated inside the rebuild transaction from the same
-- extractReferences() pass the service uses, so both directions always
-- describe the same corpus. citing_id cascades with its section row;
-- cited_citation stores the lowercase form extractReferences() emits,
-- matching the (lowercase) section citations the corpus actually uses.
CREATE TABLE IF NOT EXISTS section_references (
  citing_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  cited_citation TEXT NOT NULL,
  PRIMARY KEY (citing_id, cited_citation)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS section_references_cited ON section_references(cited_citation);

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

// citing_id comes from the section INSERT's lastInsertRowid; cited_citation
// is one already-lowercased extractReferences() entry (deduped by the
// PRIMARY KEY below, which also bounds self-citations to one row each).
const INSERT_SECTION_REFERENCE_SQL = `
INSERT INTO section_references (citing_id, cited_citation) VALUES (?, ?)`;

// Reverse lookup: which sections cite `cited_citation`. Deterministic order
// (citing citation, lexicographic) so wire consumers see a stable list.
const CITED_BY_SQL = `
SELECT s.citation
FROM section_references r
JOIN sections s ON s.id = r.citing_id
WHERE r.cited_citation = ?
ORDER BY s.citation`;

// Full-corpus read for the export command: same row shape as getSection
// (SELECT * + toSectionRow), citation-ordered like the repo's other
// citation listing (CITED_BY_SQL).
const SELECT_ALL_SECTIONS_SQL = 'SELECT * FROM sections ORDER BY citation';

const UPSERT_META_SQL = `
INSERT INTO meta (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

// 36 tokens ≈ 2–3 sentences: enough context to quote from, bounded enough
// for token-sensitive MCP consumers. tidySnippet() then trims leading
// mid-sentence fragments (SPEC: sentence-boundary fidelity).
const SNIPPET_TEXT = `snippet(sections_fts, 2, '', '', '…', 36)`;
const SNIPPET_HEADING = `snippet(sections_fts, 1, '', '', '…', 36)`;
const SNIPPET_EXPR = `CASE WHEN ${SNIPPET_TEXT} = '' THEN ${SNIPPET_HEADING} ELSE ${SNIPPET_TEXT} END`;

/** Current schema version, stored in `PRAGMA user_version`.
 *  v2: section_references reverse-reference edge table added. v1 files are
 *  not migrated in place — the version-mismatch path guides a rebuild. */
export const SCHEMA_VERSION = 2;

/** How long a connection waits on a locked database before failing. */
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface StoreOpenOptions {
  /** Override the busy-wait timeout (tests use a short one). */
  readonly busyTimeoutMs?: number;
  /**
   * Adopt an OLDER schema version (0 < version < SCHEMA_VERSION) instead of
   * failing. Only the sync path may set this: `syncIndex` immediately
   * wholesale-rebuilds every row via replaceAllWithBaseline (which also
   * populates the new section_references edge table), so adoption is never
   * left holding stale-shaped data. Downgrade (version > SCHEMA_VERSION)
   * always fails regardless of this flag.
   */
  readonly allowSchemaUpgrade?: boolean;
}

// Column weights (citation 10, heading 5, body 1): exact-citation and
// heading matches must outrank body-only matches (SPEC §13).
const SCORE_EXPR = 'bm25(sections_fts, 10.0, 5.0, 1.0) AS score';

/**
 * The AND tier's citations, as a CTE.
 *
 * The AND tier is not a candidate tier any more (the candidate set is the
 * OR tier); it is a RANKING boost, and the boost is computed IN SQL: a JS
 * prototype that sorted the rows to find the AND members cost ~200 ms and
 * ~700 ms on citation queries. The CTE's MATCH parameter binds FIRST — the
 * CTE precedes the main SELECT in the statement text.
 */
const AND_TIER_CTE = `
WITH and_hits(citation) AS (
  SELECT s.citation
  FROM sections_fts
  JOIN sections s ON s.id = sections_fts.rowid
  WHERE sections_fts MATCH ?
)`;

/**
 * The AND-tier membership key: 1 when the row matches EVERY query term, 0
 * when it matches only some. Sorted DESC, it puts the rows that answered
 * the whole question ahead of the rows that answered part of it.
 */
const AND_TIER_KEY = '(CASE WHEN a.citation IS NOT NULL THEN 1 ELSE 0 END) DESC';

/**
 * The ranked-search statement.
 *
 * The candidate set is the OR tier (`sections_fts MATCH ?` with the OR
 * query); the AND tier joins onto it as the ranking boost. `where` is the
 * filter tail (` AND s.part = ? …`, always fixed column names with bound
 * values) and `orderBy` is the sort-key prefix, so every value binds as a
 * parameter and no user input reaches the SQL text.
 */
const SELECT_MATCHES_SQL = (where: string, orderBy: string): string => `
${AND_TIER_CTE}
SELECT s.citation, s.heading, s.part, s.path, s.issue_date AS issue_date, ${SNIPPET_EXPR} AS snippet,
       ${SCORE_EXPR}
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
LEFT JOIN and_hits a ON a.citation = s.citation
WHERE sections_fts MATCH ?${where}
ORDER BY ${orderBy}score, s.citation
LIMIT ? OFFSET ?`;

/**
 * Optional search filters map to FIXED column names. The WHERE tail is
 * assembled from this map only — never from user input — and every filter
 * value is a bound parameter, so no filter value ever reaches SQL text.
 * The prepared-statement cache is keyed by SQL text, so each of the ≤8
 * filter combinations compiles exactly once.
 */
const SEARCH_FILTER_COLUMNS = {
  part: 's.part',
  kind: 's.kind',
  chapter: 's.chapter',
} as const;

type SearchFilterName = keyof typeof SEARCH_FILTER_COLUMNS;

/** A present search filter: fixed column key plus its (bound) value. */
type SearchFilter = readonly [name: SearchFilterName, value: string];

/** Present filters in a fixed order so statement shapes stay deterministic. */
function presentFilters(query: SearchQuery): SearchFilter[] {
  const filters: SearchFilter[] = [];
  if (query.part !== undefined) filters.push(['part', query.part]);
  if (query.kind !== undefined) filters.push(['kind', query.kind]);
  if (query.chapter !== undefined) filters.push(['chapter', query.chapter]);
  return filters;
}

/** ` AND s.x = ? …` WHERE tail for the filters; values bind separately. */
function filterClause(filters: readonly SearchFilter[]): string {
  return filters.map(([name]) => ` AND ${SEARCH_FILTER_COLUMNS[name]} = ?`).join('');
}

const COUNT_MATCHES_SQL = `
SELECT count(*) AS n
FROM sections_fts
WHERE sections_fts MATCH ?`;

const COUNT_MATCHES_FILTERED_SQL = (where: string): string => `
SELECT count(*) AS n
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
WHERE sections_fts MATCH ?${where}`;

const DIRECT_MATCH_SQL = `
SELECT 1
FROM sections_fts
JOIN sections s ON s.id = sections_fts.rowid
WHERE sections_fts MATCH ? AND s.citation = ? COLLATE NOCASE
LIMIT 1`;

/**
 * Ensure the on-disk schema version is compatible; adopt legacy files.
 *
 * Adoption rules: version 0 (pre-versioning) always adopts; an OLDER
 * versioned file adopts only when `allowSchemaUpgrade` vouches for an
 * immediate wholesale rebuild (the sync path, the only permitted caller —
 * replaceAllWithBaseline repopulates every row, including the new
 * section_references edges); a NEWER version always fails — downgrade is
 * unsupported, flag or not.
 */
function ensureSchemaVersion(db: DatabaseSync, allowSchemaUpgrade: boolean): void {
  const versionRow = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined;
  const version = Number(versionRow?.['user_version'] ?? 0);
  if (version === SCHEMA_VERSION) return;
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      `index schema version ${version} is not supported (expected ${SCHEMA_VERSION}) — ` +
        'downgrade is unsupported; delete the index file and run `cfr-free sync`',
    );
  }
  if (version !== 0 && !allowSchemaUpgrade) {
    throw new StoreError(
      `index schema version ${version} is not supported (expected ${SCHEMA_VERSION}) — rebuild it with \`cfr-free sync\``,
    );
  }
  // Adopting version 0 (pre-versioning) or an older versioned file whose
  // caller vouches for a full rebuild. Failure window: if that rebuild then
  // fails, the file is marked SCHEMA_VERSION with pre-upgrade rows and an
  // empty section_references table — reads stay servable (citedBy answers
  // []) and the next successful sync completes the edge population.
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * The sort key that puts a HEADING match ahead of a body-only match.
 *
 * bm25 weighs term frequency WITHIN a column, so a section whose body
 * repeats the phrase ten times outranks a section whose heading IS the
 * phrase — which is not what SPEC §13 row 4 promises ("citation/heading
 * matches outrank body-only hits"). The key counts how many of the
 * query's content terms the heading carries (the term itself, or the
 * corpus phrase a synonym stands for) and sorts on it before the score.
 *
 * The SQL text is assembled from a fixed shape; every value binds as a
 * parameter, so no user input reaches the statement.
 */
function headingMatchKey(terms: readonly QueryTerm[]): { clause: string; params: string[] } {
  const content = contentTerms(terms);
  // The heading must carry the query's terms as a PHRASE, not merely one of
  // them: counting the terms that appear promotes any heading that happens
  // to contain a generic word ("rating", "service", "recipients") above the
  // provision that actually answers the question — measured, that cost the
  // holdout three of its exact-citation hits.
  const alternatives: string[] = [];
  const phrase = content.map((term) => term.term).join(' ');
  if (phrase !== '') alternatives.push(phrase);
  for (const term of content) {
    for (const expansion of term.expansions) alternatives.push(expansion);
  }
  const params: string[] = [];
  const tests = alternatives.map((alternative) => {
    params.push(alternative.toLowerCase());
    return 'instr(lower(s.heading), ?) > 0';
  });
  if (tests.length === 0) return { clause: '', params: [] };
  return { clause: `(CASE WHEN ${tests.join(' OR ')} THEN 1 ELSE 0 END) DESC, `, params };
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
      // Pinned explicitly (node:sqlite currently defaults it on, but the
      // section_references ON DELETE CASCADE wipe depends on it — never let
      // that hinge on a driver default).
      db.exec('PRAGMA foreign_keys = ON');
      // Wait for a concurrent writer (e.g. a second sync) instead of failing
      // instantly with a cryptic SQLITE_BUSY.
      db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
      const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
      const result = check ? String(Object.values(check)[0] ?? '') : '';
      if (result !== 'ok') throw new StoreError(`integrity check failed: ${result || 'no result'}`);
      db.exec(SCHEMA_SQL);
      ensureSchemaVersion(db, options.allowSchemaUpgrade ?? false);
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

  /**
   * Atomically replace the entire index contents.
   *
   * Delegates to {@link replaceAllWithBaseline} with a no-op baseline.
   */
  replaceAll(
    sections: readonly RawSection[],
    issueDate: string,
    meta: Readonly<Record<string, string>>,
  ): void {
    this.replaceAllWithBaseline(sections, issueDate, meta, () => undefined);
  }

  /**
   * Atomically replace the entire index while running `baseline` INSIDE the
   * same IMMEDIATE transaction, BEFORE the wipe.
   *
   * The baseline callback reads the OUTGOING index (previous issue date,
   * previous text hashes) only after the write lock is held: a concurrent
   * writer can no longer commit its own index between the snapshot and the
   * rebuild, so the advisory change report always describes the exact state
   * this call replaced (scout #3 / batch-5 R3). The callback's return value
   * is handed back to the caller, and any meta it writes participates in the
   * same COMMIT.
   *
   * Ordering: callback first, then DELETE → INSERT → meta upserts — the
   * baseline must see pre-wipe rows, and everything it reads is pinned by
   * BEGIN IMMEDIATE until COMMIT.
   */
  replaceAllWithBaseline<T>(
    sections: readonly RawSection[],
    issueDate: string,
    meta: Readonly<Record<string, string>>,
    baseline: (store: Store) => T,
  ): T {
    let result!: T;
    this.transaction(() => {
      result = baseline(this);
      // The sections wipe also clears every edge: citing_id cascades
      // (PRAGMA foreign_keys is pinned ON in open()).
      this.db.exec('DELETE FROM sections');
      const insert = this.stmt(INSERT_SECTION_SQL);
      const insertReference = this.stmt(INSERT_SECTION_REFERENCE_SQL);
      for (const section of sections) {
        const { lastInsertRowid } = insert.run(
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
        // Reverse-reference edges, materialized in the SAME transaction as
        // the sections they describe (extractReferences is the exact pass
        // the service runs on read, so both directions stay consistent).
        const citingId = Number(lastInsertRowid);
        for (const cited of extractReferences(section.text)) {
          insertReference.run(citingId, cited);
        }
      }
      const upsert = this.stmt(UPSERT_META_SQL);
      for (const [key, value] of Object.entries(meta)) upsert.run(key, value);
    });
    return result;
  }

  countSections(): number {
    const row = this.stmt('SELECT count(*) AS n FROM sections').get() as
      Record<string, unknown> | undefined;
    return row ? Number(row['n'] ?? 0) : 0;
  }

  /**
   * Every indexed row (section + appendix) in citation order — the export
   * read path. Same SELECT/row mapping as {@link getSection}, applied to
   * the whole table.
   *
   * Materializes the corpus once: at Title 38 scale that is 2 970 rows /
   * ~16 MB of text+markdown (measured on the live index), which the export
   * writers serialize immediately. Unlike `captureTextHashes` (folded into
   * a hash map, so it batches to bound memory), callers here need the text
   * itself, so the rows are returned in one array by design.
   */
  allSections(): SectionRow[] {
    const rows = this.stmt(SELECT_ALL_SECTIONS_SQL).all() as Record<string, unknown>[];
    return rows.map(toSectionRow);
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

  /**
   * @deprecated Production code should pass meta via `replaceAll(sections, issueDate, meta)`.
   * Retained as a public method for test fixtures only. Will be removed in a future major.
   */
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

  /**
   * Citations of indexed sections whose text references `citation` — the
   * reverse of the forward `references` list on a section read. Sorted
   * lexicographically by citing citation (deterministic wire output); empty
   * array when nothing cites it. `citation` is bound as a parameter and
   * matched exactly against the lowercase form extractReferences emits.
   */
  citedBy(citation: string): string[] {
    const rows = this.stmt(CITED_BY_SQL).all(citation) as Record<string, unknown>[];
    return rows.map((row) => String(row['citation']));
  }

  /**
   * SHA-256 of every section's text, keyed by citation. Read in bounded
   * rowid batches: materializing the whole corpus in one `.all()` would
   * roughly double sync's peak memory (text + map), which matters in the
   * memory-capped container image.
   */
  captureTextHashes(): Map<string, string> {
    const hashes = new Map<string, string>();
    const statement = this.stmt(
      'SELECT id, citation, text, heading FROM sections WHERE id > ? ORDER BY id LIMIT 500',
    );
    let cursor = -1;
    for (;;) {
      const rows = statement.all(cursor) as Record<string, unknown>[];
      if (rows.length === 0) break;
      for (const row of rows) {
        // TEXT AND HEADING: a heading-only amendment (a retitled section
        // with an unchanged body) is a change to the provision, and a
        // text-only hash reported it as "no change". The baseline is this
        // live table, so there is no hash-compatibility transition: the
        // previous index's rows carry their headings.
        hashes.set(
          String(row['citation']),
          hashContent(String(row['text']), String(row['heading'])),
        );
        cursor = Number(row['id']);
      }
    }
    return hashes;
  }

  private countMatches(ftsQuery: string, filters: readonly SearchFilter[]): number {
    const sql =
      filters.length === 0 ? COUNT_MATCHES_SQL : COUNT_MATCHES_FILTERED_SQL(filterClause(filters));
    const row = this.stmt(sql).get(ftsQuery, ...filters.map(([, value]) => value)) as
      Record<string, unknown> | undefined;
    return row ? Number(row['n'] ?? 0) : 0;
  }

  /**
   * Ranked full-text search.
   *
   * The CANDIDATE SET is the OR tier: every section that matches at least
   * one query term. The AND tier is no longer a candidate tier — requiring
   * EVERY term excluded the provision that answers the question from the
   * results altogether (§ 4.85 "Evaluation of hearing impairment." carries
   * neither "rated" nor "loss", so "how is hearing loss rated" never saw it),
   * and no ranking rule can surface a row that was never a candidate.
   *
   * The AND tier survives as a RANKING boost: a row that matches every
   * query term outranks a row that matches only some. The order is
   *
   *   1. the heading-phrase key (SPEC §4.1) DESC,
   *   2. the AND-tier membership DESC,
   *   3. the exception demotion ASC (gated off when the query itself
   *      asks about exceptions),
   *   4. bm25 ASC (lower is better),
   *   then `s.citation` ASC as the deterministic tie-break.
   *
   * `total` is the size of the candidate set — what the pagination walks.
   * Optional `part`/`kind`/`chapter` filters are exact column matches
   * applied to both the count and the ranked rows.
   */
  search(query: SearchQuery): SearchOutcome {
    const perPage = Math.max(1, query.perPage);
    const offset = (Math.max(1, query.page) - 1) * perPage;
    const filters = presentFilters(query);

    // ONE parse of the query feeds both tiers: the candidate query (OR) and
    // the AND-tier membership query (AND) are the same fragments joined
    // differently, so a query with no usable terms has no candidate set.
    // The builder is the SAME one `toFtsQuery` uses, so the hits and the
    // `inResults` membership check can never disagree (CR-15).
    const terms = queryTerms(query.query);
    const queries = buildFtsQueries(terms);
    if (queries === null) {
      return { hits: [], total: 0, page: query.page, perPage, matchMode: 'or' };
    }
    const { or: orQuery, and: andQuery } = queries;

    const total = this.countMatches(orQuery, filters);
    if (total === 0) {
      return { hits: [], total: 0, page: query.page, perPage, matchMode: 'or' };
    }

    const key = headingMatchKey(terms);
    const demotion = asksAboutExceptions(terms) ? '' : `${EXCEPTION_DEMOTION_KEY}, `;
    const sql = SELECT_MATCHES_SQL(
      filterClause(filters),
      `${key.clause}${AND_TIER_KEY}, ${demotion}`,
    );
    const rows = this.stmt(sql).all(
      andQuery,
      orQuery,
      ...filters.map(([, value]) => value),
      ...key.params,
      perPage,
      offset,
    );

    const hits = rows.map((row) => {
      const record = row as Record<string, unknown>;
      const hit = {
        citation: String(record['citation']),
        heading: String(record['heading']),
        part: nullableString(record['part']),
        path: String(record['path']),
        snippet: tidySnippet(String(record['snippet'] ?? '')),
        issueDate: String(record['issue_date']),
        score: Number(record['score'] ?? 0),
      };
      return { ...hit, matches: visibleMatches(terms, hit) };
    });
    return { hits, total, page: query.page, perPage, matchMode: 'or' };
  }

  /**
   * Whether an exact citation participates in the FTS result set for this
   * query/mode — used by the service to adjust `total` when it prepends a
   * direct citation hit that FTS itself did not return.
   *
   * The mode MUST mirror the tier the candidate set came from: the search
   * runs the OR tier, so a caller asking "is this citation among the
   * results?" has to ask about the OR tier, or the pin's `total` adjustment
   * counts a citation the results already contain.
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
