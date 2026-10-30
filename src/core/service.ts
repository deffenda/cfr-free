import { z } from 'zod';
import { normalizeCitation } from './citations.js';
import { extractReferences } from './references.js';
import type { SyncChanges } from './changes.js';
import { diffIssues, type IssueDiff } from './diff.js';
import { redlineSection, type SectionRedline } from './redline.js';
import type { EcfrApi } from './ecfr.js';
import type { Logger } from '../logger.js';
import {
  browse as browseStructure,
  parseStructure,
  type BrowseResult,
  type StructureNode,
} from './structure.js';
import {
  Store,
  contentTerms,
  hitWords,
  queryTerms,
  termResponded,
  type MatchMode,
  type QueryTerm,
  type SearchHit,
  visibleMatches,
} from './store.js';

/**
 * Application facade shared by the MCP server and the HTTP API. All input
 * validation happens here so both surfaces behave identically.
 */

/**
 * The codes a service failure carries.
 *
 * `invalid_input` is the READER's mistake (exit 2 on the CLI, HTTP 400) and
 * `not_found` is a missing provision (HTTP 404). `unavailable` is neither:
 * it is a DEPLOYMENT fault — the service was wired without the client it
 * needs — so it is a service failure (exit 1, HTTP 500), never a usage
 * error a script would retry forever.
 */
export type ServiceErrorCode = 'invalid_input' | 'not_found' | 'unavailable';

/** Domain error carrying a machine-readable code and client-safe message. */
export class ServiceError extends Error {
  override readonly name = 'ServiceError';
  readonly code: ServiceErrorCode;

  constructor(message: string, code: ServiceErrorCode) {
    super(message);
    this.code = code;
  }
}

/**
 * The query length the index accepts. Exported so the CLI can refuse a
 * query the service would reject BEFORE it opens the index: a rejected
 * query must not cost a 2-3 MB sync (a rejected input is the user's
 * mistake, and it must not be billed to the network).
 */
export const SEARCH_QUERY_MIN_LENGTH = 3;
export const SEARCH_QUERY_MAX_LENGTH = 200;

const searchInputSchema = z.object({
  query: z.string().trim().min(SEARCH_QUERY_MIN_LENGTH).max(SEARCH_QUERY_MAX_LENGTH),
  page: z.number().int().min(1).max(10_000).default(1),
  perPage: z.number().int().min(1).max(20).default(10),
  part: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  kind: z.enum(['section', 'appendix']).optional(),
  chapter: z
    .string()
    .min(1)
    .max(8)
    .regex(/^[IVXLCDM]+$/)
    .optional(),
});

export interface SearchInput {
  readonly query: string;
  readonly page?: number | undefined;
  readonly perPage?: number | undefined;
  readonly part?: string | undefined;
  readonly kind?: 'section' | 'appendix' | undefined;
  readonly chapter?: string | undefined;
}

/** A search hit dressed for human/legal consumption. */
export interface PresentedHit extends Omit<SearchHit, 'issueDate'> {
  /** Paste-ready legal citation, e.g. `38 C.F.R. § 4.130`. */
  readonly citationDisplay: string;
  /** Permalink to the provision on ecfr.gov. */
  readonly sourceUrl: string;
  /**
   * The same provision at the index's issue date — the URL that proves which
   * revision the text was read at. `sourceUrl` is the CURRENT text.
   */
  readonly sourceUrlAtIndexDate: string;
  /** True when this row was pinned because the query *is* this citation. */
  readonly direct: boolean;
  /** True when the section matched the ranked search. For non-pin hits
   * this is always true (they came from the search). For pin hits
   * (`direct: true`) it reports whether the pin also appeared in the
   * ranked results. */
  readonly inResults: boolean;
  /** Part title from the index's structure tree, without the "Part N—" prefix;
   * null when the hit has no part, the part has no title, or the map is empty. */
  readonly partTitle: string | null;
}

export interface SearchResponse {
  readonly query: string;
  readonly page: number;
  readonly perPage: number;
  /**
   * Size of the CANDIDATE SET — every provision matching at least one query
   * term, plus the pinned citation when the candidate set did not already
   * hold it. The increment is identical on every page.
   */
  readonly total: number;
  /**
   * The tier the candidate set came from. The OR tier is the only candidate
   * tier, so this reports `or`; the field stays for wire compatibility.
   */
  readonly matchMode: MatchMode;
  readonly hits: readonly PresentedHit[];
  /** Issue date of the local index backing these results. */
  readonly indexIssueDate: string | null;
  /** True when the local index is older than CFR_MAX_AGE_DAYS. */
  readonly indexStale: boolean;
  /** Warning to surface to a client when the index is stale; null otherwise. */
  readonly notice: string | null;
  /**
   * The query's content terms that the returned hits answered.
   *
   * A term counts as answered when a hit's text carries the term's words,
   * or every word of one of the corpus phrases the term stands for — the
   * same reading the search itself used.
   */
  readonly matchedTerms: readonly string[];
  /**
   * The query's content terms that NO returned hit answered.
   *
   * This says what the RESULTS did not speak to — never what Title 38
   * covers. A term can be unmatched because the governing provision sits
   * outside the returned window, because it uses other words, or because
   * the corpus does not discuss it at all.
   */
  readonly unmatchedTerms: readonly string[];
}

/**
 * Split the query's content terms into those the returned hits answered and
 * those they did not.
 *
 * The test is the same one the per-hit `matches` uses, so the response can
 * never claim a term was missing that the search actually looked for.
 */
function grounding(
  terms: readonly QueryTerm[],
  hits: readonly PresentedHit[],
): { matchedTerms: string[]; unmatchedTerms: string[] } {
  const words = hits.map((hit) => hitWords(hit));
  const matchedTerms: string[] = [];
  const unmatchedTerms: string[] = [];
  for (const term of contentTerms(terms)) {
    const answered = words.some((hit) => termResponded(term, hit));
    (answered ? matchedTerms : unmatchedTerms).push(term.term);
  }
  return { matchedTerms, unmatchedTerms };
}

const citationInputSchema = z.string().trim().min(1).max(120);

const browseInputSchema = z.object({
  chapter: z.string().trim().min(1).max(20).optional(),
  part: z.string().trim().min(1).max(20).optional(),
  subpart: z.string().trim().min(1).max(20).optional(),
  // A subject group's identifier is the eCFR's own node id (e.g.
  // "ECFRd158704dcab040e") — 18 chars in the 2026-10-16 corpus.
  subjgrp: z.string().trim().min(1).max(40).optional(),
});

export interface BrowseInput {
  readonly chapter?: string | undefined;
  readonly part?: string | undefined;
  readonly subpart?: string | undefined;
  readonly subjgrp?: string | undefined;
}

export interface SectionDetail {
  readonly citation: string;
  readonly kind: 'section' | 'appendix';
  readonly heading: string;
  readonly chapter: string | null;
  readonly part: string | null;
  readonly subpart: string | null;
  readonly path: string;
  readonly issueDate: string;
  readonly markdown: string;
  readonly text: string;
  readonly sourceUrl: string;
  /**
   * The same provision at the revision THIS index was built from — the
   * eCFR point-in-time URL for the index's issue date. `sourceUrl` points
   * at the CURRENT text (for navigation and verification); this one points
   * at the text the index actually holds, so a reader (or an agent) can
   * open exactly the words that were quoted.
   */
  readonly sourceUrlAtIndexDate: string;
  /** Citations referenced from this text, with local-availability flags. */
  readonly references: ReadonlyArray<{ readonly citation: string; readonly available: boolean }>;
  /**
   * Citations of indexed sections whose text references this one (reverse
   * direction of `references`, served from the materialized edge table).
   * Sorted lexicographically; empty array when nothing cites it.
   */
  readonly citedBy: ReadonlyArray<string>;
  /** True when the local index backing this read is older than CFR_MAX_AGE_DAYS. */
  readonly indexStale: boolean;
  /** Warning to surface when the index is stale; null otherwise. */
  readonly notice: string | null;
}

export interface IndexStatus {
  readonly issueDate: string | null;
  readonly syncedAt: string | null;
  readonly sections: number;
  readonly appendices: number;
  readonly stale: boolean;
  readonly maxAgeDays: number;
  readonly parserVersion: string | null;
  /** True when parsed counts differ from the structure tree; null when never recorded. */
  readonly structureDrift: boolean | null;
  /** What the most recent sync changed at the provision level; null before any sync. */
  readonly lastChanges: SyncChanges | null;
  /**
   * The corpus receipt (SPEC §4): sha256 over the whole corpus's
   * per-provision content hashes at rebuild time. Null on indexes built
   * before the receipt existed.
   */
  readonly corpusHash: string | null;
}

/** Coarse readiness enum for MCP clients gating queries on one call. */
export interface HealthReport {
  readonly status: 'empty' | 'degraded' | 'stale' | 'ready';
  readonly issueDate: string | null;
  readonly syncedAt: string | null;
  readonly stale: boolean;
}

/** One part present in the local index. */
export interface PartSummary {
  readonly part: string;
  readonly title: string | null;
  readonly sections: number;
  readonly appendices: number;
}

/** Strip a leading `Part <id>—` prefix from a structure label for display. */
function partTitle(identifier: string, label: string): string {
  const prefix = `Part ${identifier}`;
  if (label.startsWith(prefix)) {
    const rest = label.slice(prefix.length).replace(/^[—–\-:.\s]+/, '');
    if (rest.length > 0) return rest;
  }
  return label;
}

function collectPartTitles(node: StructureNode, into: Map<string, string>): void {
  if (node.type === 'part') into.set(node.identifier, partTitle(node.identifier, node.label));
  for (const child of node.children) collectPartTitles(child, into);
}

/**
 * Plain-language guidance for a rejected input, keyed by the field AND by
 * the rule that was broken.
 *
 * The validation library's own phrasing — "Too small: expected string to
 * have >=3 characters" — is developer-facing. The people reading this tool
 * are claims practitioners, so a rejected input says what to type instead.
 *
 * The rule matters as much as the field. `page` can be the wrong type
 * (`?page=1.5`) or out of range (`?page=0`), and a hint that always
 * states the range answers a question the request did not ask. Each entry
 * therefore names the rule it explains, and an input that breaks a rule
 * with no entry keeps the library's own wording.
 */
type Hints = Readonly<Record<string, Readonly<Record<string, string>>>>;

const SEARCH_HINTS: Hints = {
  query: {
    too_small: `the query needs at least ${SEARCH_QUERY_MIN_LENGTH} characters`,
    too_big: `the query may be at most ${SEARCH_QUERY_MAX_LENGTH} characters`,
  },
  page: {
    invalid_type: 'the page number must be a whole number',
    too_small: 'the page number starts at 1',
    too_big: 'the page number may be at most 10000',
  },
  perPage: {
    invalid_type: 'the number of results per page must be a whole number',
    too_small: 'the number of results per page starts at 1',
    too_big: 'the number of results per page may be at most 20',
  },
  part: { invalid_format: 'the part must be a number such as 4' },
  kind: { invalid_value: 'the kind must be `section` or `appendix`' },
  chapter: {
    too_small: 'the chapter must be at least one character',
    too_big: 'the chapter may be at most 8 characters',
    invalid_format: 'the chapter must be a Roman numeral such as I, II or IV',
  },
};

/**
 * The same, for the fields `browse` accepts. Separate from the search
 * guidance because the two schemas differ: search's `chapter` must be a
 * Roman numeral of at most 8 characters, while browse's is the identifier
 * the hierarchy prints, capped only by length.
 */
const BROWSE_HINTS: Hints = {
  chapter: {
    too_small: 'the chapter must be at least one character',
    too_big: 'the chapter may be at most 20 characters — the hierarchy prints it as I or II',
  },
  part: {
    too_small: 'the part must be at least one character',
    too_big: 'the part may be at most 20 characters — the hierarchy prints it as 4',
  },
  subpart: {
    too_small: 'the subpart must be at least one character',
    too_big: 'the subpart may be at most 20 characters — the hierarchy prints it as B',
  },
  subjgrp: {
    too_small: 'the subject group must be at least one character',
    too_big:
      'the subject group may be at most 40 characters — it is the eCFR node id, such as ECFRd158704dcab040e',
  },
};

/**
 * Guidance for the citation a section read accepts. The schema caps its
 * length; whether it names a real provision is a separate check with its
 * own message.
 */
const CITATION_HINTS: Hints = {
  input: {
    too_small: 'the citation must be at least one character',
    too_big: 'the citation may be at most 120 characters',
  },
};

function toServiceError(error: unknown, hints: Hints): never {
  if (error instanceof z.ZodError) {
    const details = error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'input';
        // The hint must state the rule that was broken — a field can break
        // more than one — so the lookup is by rule as well as by field.
        return hints[field]?.[issue.code] ?? `${field}: ${issue.message}`;
      })
      .join('; ');
    throw new ServiceError(`invalid input: ${details}`, 'invalid_input');
  }
  throw error;
}

/** Permalink to the section on ecfr.gov (verified redirect pattern). */
function sourceUrlFor(kind: 'section' | 'appendix', citation: string): string {
  if (kind === 'appendix') {
    return `https://www.ecfr.gov/search?searchTerm=${encodeURIComponent(citation)}&titles=38`;
  }
  return `https://www.ecfr.gov/current/title-38/section-${encodeURIComponent(citation)}`;
}

/**
 * Permalink to the SAME provision at a DATED revision on ecfr.gov — the
 * `/on/<date>/…` form, which keeps the date in the canonical path (the
 * `/current/` form drops it).
 *
 * Verified 2026-10-20 against the live site: both forms answer 302 to a
 * canonical path that PRESERVES the date, e.g.
 *   /on/2026-10-16/title-38/section-4.125
 *     -> /on/2026-10-16/title-38/chapter-I/part-4/subpart-B/subject-group-…/section-4.125
 * The appendix form needs the citation URL-ENCODED (the unencoded form
 * answers 404):
 *   /on/2026-10-16/title-38/appendix-Appendix%20A%20to%20Part%204
 *     -> /on/2026-10-16/title-38/chapter-I/part-4/appendix-Appendix%20A%20to%20Part%204
 */
function datedSourceUrlFor(
  kind: 'section' | 'appendix',
  citation: string,
  issueDate: string,
): string {
  const kindSegment = kind === 'appendix' ? 'appendix' : 'section';
  return `https://www.ecfr.gov/on/${issueDate}/title-38/${kindSegment}-${encodeURIComponent(citation)}`;
}

/** Sections are numeric citations; everything else is an appendix name. */
function kindForCitation(citation: string): 'section' | 'appendix' {
  return /^\d/.test(citation) ? 'section' : 'appendix';
}

/** Paste-ready display form for hits (`38 C.F.R. § 4.130`). */
function displayCitation(kind: 'section' | 'appendix', citation: string): string {
  return kind === 'section' ? `38 C.F.R. § ${citation}` : citation;
}

/** Strip trailing paragraph designators: `3.350(a)(4)` → `3.350`. */
function stripParagraphSuffix(query: string): string {
  // Loop with a flat anchored pattern instead of one nested quantifier —
  // identical behavior, and linear-time for ReDoS checkers.
  let stripped = query.trim();
  for (;;) {
    const next = stripped.replace(/\s*\([a-z0-9]{1,4}\)$/i, '');
    if (next === stripped) return next;
    stripped = next;
  }
}

/** First sentence(s) of a section's text, capped at ~200 chars on a boundary. */
function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 200) return clean;
  const window = clean.slice(0, 200);
  const stop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
  );
  if (stop >= 100) return clean.slice(0, stop + 1);
  const word = window.lastIndexOf(' ');
  return `${window.slice(0, word > 0 ? word : 200)}…`;
}

/** Stale-index warning shared by search and section reads. */
function noticeFor(status: IndexStatus): string | null {
  if (!status.stale) return null;
  return (
    `local index is stale (issue date ${status.issueDate ?? 'unknown'}, ` +
    `synced ${status.syncedAt ?? 'never'}, limit ${status.maxAgeDays} days) — ` +
    'verify against the current eCFR before relying on this text; for the version ' +
    'in force on a past date (e.g. the date of claim) use the eCFR point-in-time ' +
    'URL /on/<YYYY-MM-DD>/title-38/section-<citation>'
  );
}

/** Read-only operations over the local Title 38 index. */
export class CFRService {
  private readonly store: Store;
  private readonly maxAgeDays: number;
  /**
   * Optional point-in-time stack (batch-7 D2 diff, batch-8 E1 redline):
   * injected by `serve`/`mcp`, absent in plain index readers and tests — the
   * facades below fail closed without it.
   */
  private readonly ecfr: EcfrApi | undefined;
  private readonly logger: Logger | undefined;
  /** Memoised part-number → display-title map built from the index's structure tree. */
  private partTitles: Map<string, string> | undefined;

  constructor(store: Store, maxAgeDays: number, ecfr?: EcfrApi, logger?: Logger) {
    this.store = store;
    this.maxAgeDays = maxAgeDays;
    this.ecfr = ecfr;
    this.logger = logger;
  }

  search(input: SearchInput): SearchResponse {
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) toServiceError(parsed.error, SEARCH_HINTS);
    const { query, page, perPage, part, kind, chapter } = parsed.data;
    const outcome = this.store.search({ query, page, perPage, part, kind, chapter });
    const direct = this.directHit(query, { part, kind, chapter });

    let hits = outcome.hits.map((hit) => this.presentHit(hit, false));
    let total = outcome.total;
    if (direct !== null) {
      // The pin-adjusted total must be identical on every page: the union of
      // all pages is what `total` describes, and the pin is part of that
      // union whether FTS found it or not.
      if (!direct.inResults) total += 1;
      // Later pages drop their natural copy of the pinned section: it was
      // already shown on page 1, so keeping it would duplicate the hit
      // across the pagination sequence.
      hits = hits.filter((hit) => hit.citation !== direct.citation);
      if (page === 1) hits = [direct, ...hits];
    }

    const status = this.status();
    const groundingTerms = grounding(queryTerms(query), hits);
    return {
      query,
      page,
      perPage,
      total,
      matchMode: outcome.matchMode,
      hits,
      indexIssueDate: status.issueDate,
      indexStale: status.stale,
      notice: noticeFor(status),
      matchedTerms: groundingTerms.matchedTerms,
      unmatchedTerms: groundingTerms.unmatchedTerms,
    };
  }

  /**
   * Pin the exact provision when the query itself is a citation — adjudicators
   * paste `38 CFR 4.130(a)` constantly, and keyword noise above the exact
   * section would be a correctness failure. Computed on every page so the
   * pin-adjusted `total` stays consistent across the pagination sequence;
   * only page 1 prepends the hit itself. Honors the part/kind/chapter
   * filters; `total` only counts the pin when FTS did not already return it.
   */
  private directHit(
    query: string,
    filters: {
      readonly part: string | undefined;
      readonly kind: 'section' | 'appendix' | undefined;
      readonly chapter: string | undefined;
    },
  ): (PresentedHit & { readonly inResults: boolean }) | null {
    const normalized = normalizeCitation(stripParagraphSuffix(query));
    if (normalized === null) return null;
    const row = this.store.getSection(normalized.citation, normalized.kind);
    if (row === null) return null;
    if (filters.part !== undefined && row.part !== filters.part) return null;
    if (filters.kind !== undefined && row.kind !== filters.kind) return null;
    if (filters.chapter !== undefined && row.chapter !== filters.chapter) return null;
    // The membership check MUST use the tier the candidate set came from —
    // the OR tier, the only candidate tier. Asking about the AND tier would
    // report a pinned citation as "not in the results" when the candidate
    // set holds it, and the pin would then be counted twice in `total`.
    const inResults = this.store.hasSearchMatch('or', query, row.citation);
    const snippet = excerpt(row.text);
    const hit = this.presentHit(
      {
        citation: row.citation,
        heading: row.heading,
        part: row.part,
        path: row.path,
        snippet,
        issueDate: row.issueDate,
        // Fabricated bm25, strictly better than any real score, so array order
        // and score order agree; `direct: true` is the reliable client signal.
        score: -1_000_000,
        matches: visibleMatches(queryTerms(query), {
          citation: row.citation,
          heading: row.heading,
          snippet,
        }),
      },
      true,
      inResults,
    );
    return { ...hit, inResults };
  }

  /** Attach display citation, source URL, direct flag, and inResults to a raw hit. */
  private presentHit(hit: SearchHit, direct: boolean, inResults = true): PresentedHit {
    const { issueDate, ...rest } = hit;
    const kind = kindForCitation(hit.citation);
    const partTitleValue =
      hit.part === null || hit.part === undefined
        ? null
        : (this.partTitleMap().get(hit.part) ?? null);
    return {
      ...rest,
      citationDisplay: displayCitation(kind, hit.citation),
      sourceUrl: sourceUrlFor(kind, hit.citation),
      sourceUrlAtIndexDate: datedSourceUrlFor(kind, hit.citation, issueDate),
      direct,
      inResults,
      partTitle: partTitleValue,
    };
  }

  /**
   * Actionable not-found guidance: a section-shaped citation that missed the
   * index may be reserved, removed, or simply outside Title 38 — so say that,
   * link the provision on eCFR, and surface indexed sections that mention it
   * (neighbors like `4.151a` frequently explain the gap).
   */
  private notFoundMessage(citation: string): string {
    // Phrase, not tokenized: `"4 150"` matches sections that actually
    // reference the citation, while bare tokens (`"4"* AND "150"*`) rank
    // unrelated sections that merely contain both fragments.
    const mentions = this.store
      .search({ query: `"${citation}"`, page: 1, perPage: 5 })
      .hits.map((hit) => hit.citation)
      .filter((found) => found.toLowerCase() !== citation.toLowerCase());
    const base =
      `no indexed content for citation ${citation} — it may be reserved, removed, ` +
      'or outside Title 38 as of the local issue date';
    const verify = `verify it on eCFR: ${sourceUrlFor(kindForCitation(citation), citation)}`;
    if (mentions.length === 0) return `${base}; ${verify}`;
    return `${base}; ${verify}. Indexed sections that mention it: ${mentions.join(', ')}`;
  }

  /** Fetch one section by citation (`4.125`, `§ 4.125`, `38 CFR 4.125`, …). */
  getSection(citationInput: string): SectionDetail {
    const parsed = citationInputSchema.safeParse(citationInput);
    if (!parsed.success) toServiceError(parsed.error, CITATION_HINTS);
    const normalized = normalizeCitation(parsed.data);
    if (normalized === null) {
      throw new ServiceError(
        `unrecognized citation: ${JSON.stringify(citationInput)} (expected e.g. "4.125" or "38 CFR 4.125")`,
        'invalid_input',
      );
    }
    const row = this.store.getSection(normalized.citation, normalized.kind);
    if (row === null) {
      throw new ServiceError(this.notFoundMessage(normalized.citation), 'not_found');
    }
    const status = this.status();
    return {
      citation: row.citation,
      kind: row.kind,
      heading: row.heading,
      chapter: row.chapter,
      part: row.part,
      subpart: row.subpart,
      path: row.path,
      issueDate: row.issueDate,
      markdown: row.markdown,
      text: row.text,
      sourceUrl: sourceUrlFor(row.kind, row.citation),
      sourceUrlAtIndexDate: datedSourceUrlFor(row.kind, row.citation, row.issueDate),
      references: extractReferences(row.text).map((citation) => ({
        citation,
        available: this.store.hasSection(citation),
      })),
      // Reverse edges keyed by the section's canonical (lowercase) citation —
      // the exact form extractReferences() stored at rebuild time.
      citedBy: this.store.citedBy(row.citation),
      indexStale: status.stale,
      notice: noticeFor(status),
    };
  }

  /** Navigate the structure tree; empty query returns the chapters. */
  browse(input: BrowseInput = {}): BrowseResult {
    const parsed = browseInputSchema.safeParse(input);
    if (!parsed.success) toServiceError(parsed.error, BROWSE_HINTS);
    if (parsed.data.subpart !== undefined && parsed.data.part === undefined) {
      throw new ServiceError("subpart navigation requires 'part'", 'invalid_input');
    }
    // A subject group hangs off a part (directly) or off a subpart, so the
    // part is the one level it always needs.
    if (parsed.data.subjgrp !== undefined && parsed.data.part === undefined) {
      throw new ServiceError("subject-group navigation requires 'part'", 'invalid_input');
    }
    const structureJson = this.store.getMeta('structure_json');
    if (structureJson === null) {
      throw new ServiceError('index has no structure data — run `cfr-free sync`', 'not_found');
    }
    let structure;
    try {
      structure = parseStructure(JSON.parse(structureJson));
    } catch {
      throw new ServiceError('stored structure is unreadable — run `cfr-free sync`', 'not_found');
    }
    return browseStructure(structure, parsed.data);
  }

  /** Freshness report for the local index. */
  status(): IndexStatus {
    const issueDate = this.store.getMeta('issue_date');
    const syncedAt = this.store.getMeta('synced_at');
    const sections = this.store.countSections();
    const appendices = Number(this.store.getMeta('appendices_count') ?? '0');
    let stale = true;
    if (syncedAt !== null) {
      const ageMs = Date.now() - Date.parse(syncedAt);
      stale = !Number.isFinite(ageMs) || ageMs > this.maxAgeDays * 24 * 60 * 60 * 1000;
    }
    return {
      issueDate,
      syncedAt,
      sections,
      appendices,
      stale,
      maxAgeDays: this.maxAgeDays,
      parserVersion: this.store.getMeta('parser_version'),
      structureDrift: this.structureDrift(sections),
      lastChanges: this.lastChanges(),
      corpusHash: this.store.getMeta('corpus_hash'),
    };
  }

  /** Parsed sync-change record; corrupted meta degrades to null, never throws. */
  private lastChanges(): SyncChanges | null {
    const raw = this.store.getMeta('last_changes');
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SyncChanges;
    } catch {
      return null;
    }
  }

  /**
   * One-call readiness verdict for MCP clients: `empty` (no index yet),
   * `degraded` (structure drift — live rows disagree with the structure
   * tree, so provisions may be missing), `stale` (aged past
   * CFR_MAX_AGE_DAYS), or `ready` (query away). Precedence is
   * empty → degraded → stale → ready: incomplete data is the less safe
   * failure, and the `stale` boolean below still reports age alongside.
   */
  health(): HealthReport {
    const status = this.status();
    const state: HealthReport['status'] =
      status.sections === 0
        ? 'empty'
        : status.structureDrift === true
          ? 'degraded'
          : status.stale
            ? 'stale'
            : 'ready';
    return {
      status: state,
      issueDate: status.issueDate,
      syncedAt: status.syncedAt,
      stale: status.stale,
    };
  }

  /**
   * Compare the live row total against the structure-tree expectations
   * recorded at sync time. Null when an old index predates the expectation
   * meta. Catches both parse drift (warned at sync) and vanished rows.
   */
  private structureDrift(sections: number): boolean | null {
    const expectedSectionsRaw = this.store.getMeta('structure_expected_sections');
    const expectedAppendicesRaw = this.store.getMeta('structure_expected_appendices');
    if (expectedSectionsRaw === null || expectedAppendicesRaw === null) return null;
    const expectedSections = Number(expectedSectionsRaw);
    const expectedAppendices = Number(expectedAppendicesRaw);
    if (!Number.isFinite(expectedSections) || !Number.isFinite(expectedAppendices)) return true;
    return sections !== expectedSections + expectedAppendices;
  }

  /** Build (once) and return the memoised part-number → display-title map. */
  private partTitleMap(): Map<string, string> {
    // An EMPTY map is memoised too: a missing or unreadable structure must
    // not be re-parsed on every search.
    if (this.partTitles !== undefined) return this.partTitles;
    const titles = new Map<string, string>();
    try {
      const structureJson = this.store.getMeta('structure_json');
      if (structureJson !== null) {
        collectPartTitles(parseStructure(JSON.parse(structureJson)), titles);
      }
    } catch {
      // Unreadable or missing structure: degrade silently to an empty map.
    }
    this.partTitles = titles;
    return titles;
  }

  /** Parts present in the index, joined with titles from the structure tree. */
  listParts(): PartSummary[] {
    const titles = this.partTitleMap();
    return this.store.listParts().map((row) => ({
      part: row.part,
      title: titles.get(row.part) ?? null,
      sections: row.sections,
      appendices: row.appendices,
    }));
  }

  /**
   * Point-in-time diff of two eCFR issue dates (`/api/v1/diff`): a thin
   * facade over `diffIssues` so the HTTP surface shares the core's exact
   * validation and error semantics. BOTH dates are required — no default-to
   * resolution happens here (the store's `issue_date` lookup is the CLI's
   * convenience, deliberately not threaded behind this facade). Stateless by
   * design: every call fetches both dates' full-title XML from eCFR — no
   * prefetch, no cache.
   *
   * Every `serve`/`mcp` entrypoint injects the client and logger together;
   * the guard fails closed for test-constructed services without the diff
   * stack, so the route answers a clean mapped error instead of a crash.
   *
   * @throws {ServiceError} (`unavailable`) when no eCFR client was
   *   injected — a deployment fault, not the reader's argument;
   *   (`invalid_input`) when a date is malformed/impossible or the two dates
   *   are identical; upstream fetch failures surface as `HttpError`.
   */
  async diffBetween(fromDate: string, toDate: string): Promise<IssueDiff> {
    const { ecfr, logger } = this;
    if (ecfr === undefined || logger === undefined) {
      throw new ServiceError('diff unavailable — no eCFR client injected', 'unavailable');
    }
    return diffIssues({ ecfr, logger }, fromDate, toDate);
  }

  /**
   * Facade over `redlineSection` (batch-8 E1), mirroring `diffBetween`: the
   * guard fails closed without the injected client and logger, delegating to
   * the core otherwise. BOTH dates are required on the wire (no default-to
   * resolution); the core owns every validation (malformed/impossible/identical
   * dates, non-citation) and the `not_found` tripwire for a citation missing
   * from BOTH dates. Stateless by design: every call fetches both dates'
   * full-title XML from eCFR — no prefetch, no cache.
   *
   * Every `serve`/`mcp` entrypoint injects the client and logger together;
   * the guard fails closed for test-constructed services without the redline
   * stack, so both wire surfaces answer a clean mapped error instead of a
   * crash.
   *
   * @throws {ServiceError} (`unavailable`) when no eCFR client was
   *   injected — a deployment fault, not the reader's argument;
   *   (`invalid_input`) when a date is malformed/impossible, the two dates
   *   are identical, or the citation is not recognizable; (`not_found`) when
   *   the citation is missing from BOTH dates' parse results; upstream fetch
   *   failures surface as `HttpError`.
   */
  async redlineBetween(
    fromDate: string,
    toDate: string,
    citation: string,
  ): Promise<SectionRedline> {
    const { ecfr, logger } = this;
    if (ecfr === undefined || logger === undefined) {
      throw new ServiceError('redline unavailable — no eCFR client injected', 'unavailable');
    }
    return redlineSection({ ecfr, logger }, fromDate, toDate, citation);
  }
}
