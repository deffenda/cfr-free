import { z } from 'zod';
import { normalizeCitation } from './citations.js';
import { browse as browseStructure, parseStructure, type BrowseResult } from './structure.js';
import { Store, type SearchHit, type MatchMode } from './store.js';

/**
 * Application facade shared by the MCP server and the HTTP API. All input
 * validation happens here so both surfaces behave identically.
 */

export type ServiceErrorCode = 'invalid_input' | 'not_found';

/** Domain error carrying a machine-readable code and client-safe message. */
export class ServiceError extends Error {
  override readonly name = 'ServiceError';
  readonly code: ServiceErrorCode;

  constructor(message: string, code: ServiceErrorCode) {
    super(message);
    this.code = code;
  }
}

const searchInputSchema = z.object({
  query: z.string().trim().min(3).max(200),
  page: z.number().int().min(1).max(10_000).default(1),
  perPage: z.number().int().min(1).max(20).default(10),
  part: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
});

export interface SearchInput {
  readonly query: string;
  readonly page?: number | undefined;
  readonly perPage?: number | undefined;
  readonly part?: string | undefined;
}

export interface SearchResponse {
  readonly query: string;
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly matchMode: MatchMode;
  readonly hits: readonly SearchHit[];
}

const citationInputSchema = z.string().trim().min(1).max(120);

const browseInputSchema = z.object({
  chapter: z.string().trim().min(1).max(20).optional(),
  part: z.string().trim().min(1).max(20).optional(),
  subpart: z.string().trim().min(1).max(20).optional(),
});

export interface BrowseInput {
  readonly chapter?: string | undefined;
  readonly part?: string | undefined;
  readonly subpart?: string | undefined;
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
}

export interface IndexStatus {
  readonly issueDate: string | null;
  readonly syncedAt: string | null;
  readonly sections: number;
  readonly appendices: number;
  readonly stale: boolean;
  readonly maxAgeDays: number;
  readonly parserVersion: string | null;
}

function toServiceError(error: unknown): never {
  if (error instanceof z.ZodError) {
    const details = error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
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

/** Read-only operations over the local Title 38 index. */
export class CFRService {
  private readonly store: Store;
  private readonly maxAgeDays: number;

  constructor(store: Store, maxAgeDays: number) {
    this.store = store;
    this.maxAgeDays = maxAgeDays;
  }

  search(input: SearchInput): SearchResponse {
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) toServiceError(parsed.error);
    const { query, page, perPage, part } = parsed.data;
    const outcome = this.store.search({ query, page, perPage, part });
    return {
      query,
      page,
      perPage,
      total: outcome.total,
      matchMode: outcome.matchMode,
      hits: outcome.hits,
    };
  }

  /** Fetch one section by citation (`4.125`, `§ 4.125`, `38 CFR 4.125`, …). */
  getSection(citationInput: string): SectionDetail {
    const parsed = citationInputSchema.safeParse(citationInput);
    if (!parsed.success) toServiceError(parsed.error);
    const normalized = normalizeCitation(parsed.data);
    if (normalized === null) {
      throw new ServiceError(
        `unrecognized citation: ${JSON.stringify(citationInput)} (expected e.g. "4.125" or "38 CFR 4.125")`,
        'invalid_input',
      );
    }
    const row = this.store.getSection(normalized.citation, normalized.kind);
    if (row === null) {
      throw new ServiceError(`no indexed content for citation ${normalized.citation}`, 'not_found');
    }
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
    };
  }

  /** Navigate the structure tree; empty query returns the chapters. */
  browse(input: BrowseInput = {}): BrowseResult {
    const parsed = browseInputSchema.safeParse(input);
    if (!parsed.success) toServiceError(parsed.error);
    if (parsed.data.subpart !== undefined && parsed.data.part === undefined) {
      throw new ServiceError("subpart navigation requires 'part'", 'invalid_input');
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
    let stale = true;
    if (syncedAt !== null) {
      const ageMs = Date.now() - Date.parse(syncedAt);
      stale = !Number.isFinite(ageMs) || ageMs > this.maxAgeDays * 24 * 60 * 60 * 1000;
    }
    return {
      issueDate,
      syncedAt,
      sections,
      appendices: Number(this.store.getMeta('appendices_count') ?? '0'),
      stale,
      maxAgeDays: this.maxAgeDays,
      parserVersion: this.store.getMeta('parser_version'),
    };
  }
}
