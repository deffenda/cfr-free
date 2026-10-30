import { z } from 'zod';
import type { HttpClient } from './http-client.js';
import { Semaphore } from './semaphore.js';

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
 * Thin client for the public eCFR versioner API.
 *
 * The base URL is fixed by construction — callers only ever pass validated
 * date segments, so no user input reaches the URL (no SSRF surface).
 */
/**
 * How many upstream document fetches may be in flight at once, and how long
 * a fetched document is reused.
 *
 * The upstream fetches are the expensive ones: the complete Title 38
 * document is ~2 MB on the wire and ~16 MB parsed, and a peer with the
 * published image's budget could otherwise have hundreds of them in
 * flight at once.
 */
const DEFAULT_MAX_CONCURRENT_FETCHES = 4;
const DEFAULT_FULL_TITLE_XML_TTL_MS = 5 * 60_000;
/** How many fetched documents are kept: ~2-3 MB each. */
const FULL_TITLE_XML_MEMO_CAP = 4;

export class EcfrApi {
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  /** Bounds the document fetches in flight at once. */
  private readonly fetches: Semaphore;
  private readonly fullTitleXmlTtlMs: number;
  /** Fetched documents by issue date: the same date is the same document. */
  private readonly fullTitleXmlMemo = new Map<string, { xml: string; expiresAtMs: number }>();

  constructor(http: HttpClient, baseUrl: string = DEFAULT_BASE_URL) {
    this.http = http;
    this.baseUrl = baseUrl;
    this.fetches = new Semaphore(DEFAULT_MAX_CONCURRENT_FETCHES);
    this.fullTitleXmlTtlMs = DEFAULT_FULL_TITLE_XML_TTL_MS;
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
   * Two bounds apply, and they are different bounds. The semaphore caps
   * how many document fetches are in flight at once — the request budget
   * caps how fast they start, and nothing capped the concurrency, which
   * is what turns a burst into gigabytes of heap. The memo stops the same
   * document being fetched again: a point-in-time document does not
   * change, so a second read of the same date is the same bytes.
   */
  async getFullTitleXml(issueDate: string): Promise<string> {
    const date = assertDate(issueDate);
    const memoised = this.fullTitleXmlMemo.get(date);
    if (memoised !== undefined && memoised.expiresAtMs > Date.now()) return memoised.xml;

    const url = new URL(`/api/versioner/v1/full/${date}/title-${TITLE_38}.xml`, this.baseUrl);
    const xml = await this.fetches.run(() =>
      this.http.getText(url, {
        headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' },
      }),
    );

    this.fullTitleXmlMemo.set(date, { xml, expiresAtMs: Date.now() + this.fullTitleXmlTtlMs });
    // The memo is a cache, not a store: the oldest entry goes when the
    // cap is reached, so the memory it holds is bounded.
    for (const key of this.fullTitleXmlMemo.keys()) {
      if (this.fullTitleXmlMemo.size <= FULL_TITLE_XML_MEMO_CAP) break;
      this.fullTitleXmlMemo.delete(key);
    }
    return xml;
  }
}
