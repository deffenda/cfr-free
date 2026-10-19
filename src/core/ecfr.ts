import { z } from 'zod';
import type { HttpClient } from './http-client.js';

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

/**
 * Thin client for the public eCFR versioner API.
 *
 * The base URL is fixed by construction — callers only ever pass validated
 * date segments, so no user input reaches the URL (no SSRF surface).
 */
export class EcfrApi {
  private readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(http: HttpClient, baseUrl: string = DEFAULT_BASE_URL) {
    this.http = http;
    this.baseUrl = baseUrl;
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

  /** Fetch the complete Title 38 XML document (~2 MB, gzip on the wire). */
  async getFullTitleXml(issueDate: string): Promise<string> {
    const date = assertDate(issueDate);
    const url = new URL(`/api/versioner/v1/full/${date}/title-${TITLE_38}.xml`, this.baseUrl);
    return this.http.getText(url, {
      headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' },
    });
  }
}
