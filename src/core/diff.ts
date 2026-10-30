import type { Logger } from '../logger.js';
import { fetchFullTitleXml } from './archive.js';
import { diffHashes, hashContent } from './changes.js';
import { isIssueDateString, type EcfrApi } from './ecfr.js';
import { POINT_IN_TIME_NOTICE } from './point-in-time.js';
import { ServiceError } from './errors.js';
import { SyncError } from './sync.js';
import { parseTitleXml } from './xml.js';

/**
 * Stateless point-in-time diff: "what changed in Title 38 between issue date
 * A and issue date B?". Both dates' full-title XML is fetched from eCFR and
 * parsed on the fly, then hashed per citation with the SAME machinery the
 * sync change report uses (`hashText` + `diffHashes`). No history table, no
 * schema growth, no storage policy: the corpus is small enough that an
 * on-demand fetch delivers what a persisted snapshot would.
 */

/** Provision-level diff of two issue dates; lists are sorted and FULL. */
export interface IssueDiff {
  readonly fromIssueDate: string;
  readonly toIssueDate: string;
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /**
   * The limit on what these two dates MEAN, stated on the surface that
   * shows the diff. eCFR serves the revision in force on a requested date
   * and does not report which issue date that revision was, so the dates
   * are SELECTORS and not a stamp of what was served. Without this on the
   * diff, a reader of the change view has to find the sentence somewhere
   * else to know what it does not claim.
   */
  readonly notice: string;
}

/**
 * Maximum days a month can hold in ANY year — a coarse pre-fetch rejection
 * only. February's real limit is year-specific (28 vs 29); computing that is
 * a full calendar validator, and real per-month day counts stay upstream
 * authority: eCFR rejects impossible dates (e.g. 2025-02-29) on the fetch,
 * and this check deliberately does not duplicate that logic. What lives here
 * is the set no year could ever produce: month outside 01–12, or a day past
 * the month's maximum (2026-13-01, 2026-02-30, 2026-04-31) — shapes that
 * would otherwise burn a network round-trip before failing upstream.
 */
const MAX_DAYS_BY_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Validate an operator-supplied date against eCFR's `YYYY-MM-DD` shape plus a
 * plausible month/day — `ServiceError` (`invalid_input`) BEFORE any fetch.
 */
export function assertIssueDate(value: string, label: string): string {
  if (!isIssueDateString(value)) {
    throw new ServiceError(`${label} must be a YYYY-MM-DD date, got: ${value}`, 'invalid_input');
  }
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const maxDay = month >= 1 && month <= 12 ? (MAX_DAYS_BY_MONTH[month - 1] ?? 0) : 0;
  if (day < 1 || day > maxDay) {
    throw new ServiceError(
      `${label} must be a YYYY-MM-DD date with month 01-12 and a day within that month, got: ${value}`,
      'invalid_input',
    );
  }
  return value;
}

/** Parse one date's full-title XML into citation → text-hash. */
function hashesByCitation(xml: string, issueDate: string): Map<string, string> {
  const sections = parseTitleXml(xml);
  if (sections.length === 0) {
    throw new SyncError(
      `parsed zero sections for issue date ${issueDate} — eCFR XML format may have changed (see docs/SPEC.md §3)`,
    );
  }
  const hashes = new Map<string, string>();
  for (const section of sections) {
    // Text AND heading: a provision retitled with an unchanged body is a
    // change between the two dates (see hashContent).
    hashes.set(section.citation, hashContent(section.text, section.heading));
  }
  return hashes;
}

/**
 * Diff two eCFR issue dates of Title 38 at the provision level.
 *
 * Pure function of the two dates: no store interaction, no structure fetch
 * (sync's structure validation guards index integrity; a textual diff of two
 * parsed documents does not need it).
 *
 * @throws {ServiceError} (`invalid_input`) for malformed, impossible
 *   (out-of-range month/day), or identical dates — all before any fetch.
 * @throws {SyncError} when either date parses to zero sections.
 */
export async function diffIssues(
  deps: { readonly ecfr: EcfrApi; readonly logger: Logger },
  fromDate: string,
  toDate: string,
): Promise<IssueDiff> {
  assertIssueDate(fromDate, 'from date');
  assertIssueDate(toDate, 'to date');
  if (fromDate === toDate) {
    throw new ServiceError('from date and to date are the same', 'invalid_input');
  }
  const { ecfr, logger } = deps;

  // Two independent GETs on a stateless HttpClient (http-client.ts keeps all
  // request state function-local: fresh AbortSignal per call, function-local
  // retry counters, immutable options), so the fetches run in
  // parallel — half the wall time of sequential on a ~2 s upstream.
  logger.info('fetching full title XML', { issueDate: fromDate });
  logger.info('fetching full title XML', { issueDate: toDate });
  const [fromXml, toXml] = await Promise.all([
    fetchFullTitleXml(ecfr, fromDate),
    fetchFullTitleXml(ecfr, toDate),
  ]);

  logger.info('parsing and hashing provisions', { fromDate, toDate });
  const fromHashes = hashesByCitation(fromXml, fromDate);
  const toHashes = hashesByCitation(toXml, toDate);
  const diff = diffHashes(fromHashes, toHashes);

  logger.info('issue diff computed', {
    fromDate,
    toDate,
    changed: diff.changed.length,
    added: diff.added.length,
    removed: diff.removed.length,
  });
  return {
    fromIssueDate: fromDate,
    toIssueDate: toDate,
    changed: diff.changed,
    added: diff.added,
    removed: diff.removed,
    notice: POINT_IN_TIME_NOTICE,
  };
}
