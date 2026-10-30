import { z } from 'zod';
import type { HttpClient } from './http-client.js';
import { DEFAULT_MAX_WAITERS, Semaphore } from './semaphore.js';

/** Title handled by this service (v1 scope). */
export const TITLE_38 = 38;

const DEFAULT_BASE_URL = 'https://www.ecfr.gov';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const titlesSchema = z.object({
  titles: z.array(
    z.object({
      number: z.number(),
      name: z.string(),
      // Reserved titles (e.g. 35) legitimately report null dates; only the
      // title we act on needs real values, checked at extraction time.
      latest_issue_date: z.string().nullable(),
      up_to_date_as_of: z.string().nullable(),
      latest_amended_on: z.string().nullable(),
    }),
  ),
});

/** Freshness facts for Title 38 as reported by eCFR. */
export interface TitleSchedule {
  /** Newest date eCFR accepts for point-in-time endpoints. */
  readonly upToDateAsOf: string;
}

function assertDate(value: string): string {
  if (!DATE_RE.test(value)) throw new Error(`eCFR returned an invalid date: ${value}`);
  return value;
}

/** True for `YYYY-MM-DD` — the only date shape eCFR endpoints accept. */
export function isIssueDateString(value: string): boolean {
  return DATE_RE.test(value);
}

/**
 * How many upstream document fetches may be in flight at once, how many
 * may wait for a permit, and how long a fetched document is reused.
 *
 * The upstream fetches are the expensive ones: the complete Title 38
 * document is ~2 MB on the wire and ~16 MB parsed, and a peer with the
 * published image's budget could otherwise have tens of them in flight
 * at once.
 */
export const DEFAULT_MAX_CONCURRENT_FETCHES = 4;

/**
 * How many fetches may WAIT for a permit before a request is refused.
 *
 * The same bound as the semaphore's own wait queue — it IS that queue, so
 * the published number and the code's number cannot drift apart.
 */
export const DEFAULT_MAX_QUEUED_FETCHES = DEFAULT_MAX_WAITERS;
/** How long a fetched document is reused, from the fetch (not from a read). */
export const DEFAULT_FULL_TITLE_XML_TTL_MS = 5 * 60_000;
/** How many fetched documents are kept: ~2-3 MB each. */
export const FULL_TITLE_XML_MEMO_CAP = 4;

/**
 * The bounds of the upstream-fetch machinery, injectable for tests.
 *
 * The defaults are the published contract (SPEC §5): four fetches in
 * flight, sixteen waiting, a five-minute reuse window and four kept
 * documents.
 */
export interface EcfrApiOptions {
  /** How many upstream document fetches may run at once (default 4). */
  readonly maxConcurrentFetches?: number;
  /** How many fetches may wait for a permit before a request is refused (default 16). */
  readonly maxQueuedFetches?: number;
  /** How long a fetched document is reused, in milliseconds (default 300 000). */
  readonly fullTitleXmlTtlMs?: number;
  /** How many fetched documents are kept (default 4). */
  readonly fullTitleXmlMemoCap?: number;
}

/** A fetched document and the moment it stops being reused. */
interface MemoEntry {
  readonly xml: string;
  readonly expiresAtMs: number;
}

/**
 * Thin client for the public eCFR versioner API.
 *
 * The base URL is fixed by construction — callers only ever pass validated
 * date segments, so no user input reaches the URL (no SSRF surface).
 */
export class EcfrApi {
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  /** Bounds the document fetches in flight at once — and the queue behind them. */
  private readonly fetches: Semaphore;
  private readonly fullTitleXmlTtlMs: number;
  private readonly fullTitleXmlMemoCap: number;
  /** Fetched documents by issue date: the same date is the same document. */
  private readonly fullTitleXmlMemo = new Map<string, MemoEntry>();
  /** Fetches in progress, by issue date: one fetch per date, shared by all. */
  private readonly fullTitleXmlInFlight = new Map<string, Promise<string>>();

  constructor(http: HttpClient, baseUrl: string = DEFAULT_BASE_URL, options: EcfrApiOptions = {}) {
    this.http = http;
    this.baseUrl = baseUrl;
    this.fetches = new Semaphore(
      options.maxConcurrentFetches ?? DEFAULT_MAX_CONCURRENT_FETCHES,
      options.maxQueuedFetches ?? DEFAULT_MAX_QUEUED_FETCHES,
    );
    this.fullTitleXmlTtlMs = options.fullTitleXmlTtlMs ?? DEFAULT_FULL_TITLE_XML_TTL_MS;
    this.fullTitleXmlMemoCap = Math.max(1, options.fullTitleXmlMemoCap ?? FULL_TITLE_XML_MEMO_CAP);
  }

  /** Resolve Title 38's current issue date (eCFR rejects dates past it). */
  async getTitleSchedule(): Promise<TitleSchedule> {
    const url = new URL('/api/versioner/v1/titles.json', this.baseUrl);
    const data = await this.http.getJson(url, (raw) => titlesSchema.parse(raw));
    const title = data.titles.find((entry) => entry.number === TITLE_38);
    if (!title) throw new Error(`eCFR titles.json does not include title ${TITLE_38}`);
    const upToDateAsOf = title.up_to_date_as_of ?? title.latest_issue_date;
    if (upToDateAsOf === null) throw new Error(`eCFR reports no issue date for title ${TITLE_38}`);
    return { upToDateAsOf: assertDate(upToDateAsOf) };
  }

  /** Fetch the full hierarchical structure of Title 38 as JSON. */
  async getStructureJson(issueDate: string): Promise<unknown> {
    const date = assertDate(issueDate);
    const url = new URL(`/api/versioner/v1/structure/${date}/title-${TITLE_38}.json`, this.baseUrl);
    return this.http.getJson(url, (raw) => raw);
  }

  /**
   * Fetch the complete Title 38 XML document (~2 MB, gzip on the wire).
   *
   * Three bounds apply, and they are different bounds. The semaphore caps
   * how many document fetches are in flight at once — and refuses a
   * request whose turn never comes, because the request budget caps how
   * fast they start and nothing capped the concurrency, which is what
   * turns a burst into gigabytes of heap. The memo stops the same
   * document being fetched again: a point-in-time document does not
   * change, so a second read of the same date is the same bytes. And
   * concurrent readers of the same date share ONE fetch, so a burst of
   * identical requests does not become a burst of identical downloads.
   *
   * The memo is per-process and ephemeral: it lives in this instance
   * only, holds at most four documents for five minutes, and disappears
   * with the process. It is not a cross-process or persistent cache.
   */
  async getFullTitleXml(issueDate: string): Promise<string> {
    const date = assertDate(issueDate);
    const memoised = this.fullTitleXmlMemo.get(date);
    if (memoised !== undefined && memoised.expiresAtMs > Date.now()) {
      // A read does not extend the reuse window, but it does make the
      // document the most recently used one (the memo evicts the LEAST
      // recently used).
      this.touchMemo(date, memoised);
      return memoised.xml;
    }

    // Single flight: a concurrent reader of the same date waits for the
    // fetch that is already running instead of starting a second one.
    const inFlight = this.fullTitleXmlInFlight.get(date);
    if (inFlight !== undefined) return inFlight;

    const fetch = this.fetchFullTitleXml(date);
    this.fullTitleXmlInFlight.set(date, fetch);
    try {
      return await fetch;
    } finally {
      // Drop the shared fetch: nothing else can have replaced it (only
      // this call creates the entry, and only this call removes it), so
      // the next reader starts a fresh fetch — a FAILED fetch is not
      // remembered.
      this.fullTitleXmlInFlight.delete(date);
    }
  }

  /** Fetch one document and put it in the memo. */
  private async fetchFullTitleXml(date: string): Promise<string> {
    const url = new URL(`/api/versioner/v1/full/${date}/title-${TITLE_38}.xml`, this.baseUrl);
    const xml = await this.fetches.run(() =>
      this.http.getText(url, {
        headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' },
      }),
    );

    this.touchMemo(date, { xml, expiresAtMs: Date.now() + this.fullTitleXmlTtlMs });
    return xml;
  }

  /**
   * Record the document as the most recently used one and drop the
   * least recently used document if the memo is over its cap.
   *
   * The memo is a cache, not a store: the memory it holds is bounded,
   * and the document a caller keeps asking for is the one that stays.
   */
  private touchMemo(date: string, entry: MemoEntry): void {
    // `Map.set` on an existing key keeps the old insertion position, so
    // the entry is re-inserted to move it to the most-recent end.
    this.fullTitleXmlMemo.delete(date);
    this.fullTitleXmlMemo.set(date, entry);
    // The map's iteration order is insertion order, and the entry was
    // just re-inserted, so the first key is the least recently used one.
    for (const key of this.fullTitleXmlMemo.keys()) {
      if (this.fullTitleXmlMemo.size <= this.fullTitleXmlMemoCap) break;
      this.fullTitleXmlMemo.delete(key);
    }
  }
}
