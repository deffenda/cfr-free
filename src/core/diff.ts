import type { Logger } from '../logger.js';
import { diffHashes, hashText } from './changes.js';
import { isIssueDateString, type EcfrApi } from './ecfr.js';
import { ServiceError } from './service.js';
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
}

/** Validate an operator-supplied date against eCFR's `YYYY-MM-DD` shape. */
function assertIssueDate(value: string, label: string): string {
  if (!isIssueDateString(value)) {
    throw new ServiceError(`${label} must be a YYYY-MM-DD date, got: ${value}`, 'invalid_input');
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
  for (const section of sections) hashes.set(section.citation, hashText(section.text));
  return hashes;
}

/**
 * Diff two eCFR issue dates of Title 38 at the provision level.
 *
 * Pure function of the two dates: no store interaction, no structure fetch
 * (sync's structure validation guards index integrity; a textual diff of two
 * parsed documents does not need it).
 *
 * @throws {ServiceError} (`invalid_input`) for malformed or identical dates.
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

  // Two independent GETs on a stateless HttpClient (all request state is
  // function-local, nothing mutable is shared), so the fetches run in
  // parallel — half the wall time of sequential on a ~2 s upstream.
  logger.info('fetching full title XML', { issueDate: fromDate });
  logger.info('fetching full title XML', { issueDate: toDate });
  const [fromXml, toXml] = await Promise.all([
    ecfr.getFullTitleXml(fromDate),
    ecfr.getFullTitleXml(toDate),
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
  };
}
