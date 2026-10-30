import { fetchFullTitleXml } from './archive.js';
import { assertIssueDate } from './diff.js';
import { normalizeCitation, findProvision } from './citations.js';
import { ServiceError } from './errors.js';
import { datedSourceUrlFor, sourceUrlFor } from './urls.js';
import { parseTitleXml } from './xml.js';
import type { EcfrApi } from './ecfr.js';
import type { Logger } from '../logger.js';

/**
 * A provision AS IT STOOD at a requested date — the point-in-time read.
 *
 * eCFR's versioner serves the revision in force on a requested date, so a
 * date that is not itself an issue date resolves to the revision that was
 * in force then. The upstream does NOT report which issue date it served,
 * so this read NAMES THE REQUESTED DATE and never a "served revision" it
 * cannot verify.
 *
 * Archive floor (measured 2026-10-20): the versioner answers 404 for
 * dates before 2017 (`full/2016-06-01/…` -> 404, `full/2017-01-01/…` -> 200).
 * That is surfaced as a usage error (`invalid_input`), not as an upstream
 * failure — `archive.ts` owns that translation for every date-keyed read.
 */

export interface HistoricalSection {
  /** The date the caller asked for — NOT a claim about the issue date served. */
  readonly requestedDate: string;
  /** The citation as the corpus spells it. */
  readonly citation: string;
  readonly kind: 'section' | 'appendix';
  readonly heading: string;
  readonly chapter: string | null;
  readonly part: string | null;
  readonly subpart: string | null;
  readonly path: string;
  readonly text: string;
  readonly markdown: string;
  /** The provision on ecfr.gov today (for navigation). */
  readonly sourceUrl: string;
  /** The SAME provision at the requested date — the revision this text came from. */
  readonly sourceUrlAtRequestedDate: string;
}

export interface HistoricalDeps {
  readonly ecfr: EcfrApi;
  readonly logger: Logger;
}

/** Permalink to the CURRENT text, and to the same provision at a date. */
function urlsFor(
  kind: 'section' | 'appendix',
  citation: string,
  requestedDate: string,
): { sourceUrl: string; sourceUrlAtRequestedDate: string } {
  return {
    sourceUrl: sourceUrlFor(citation, kind),
    sourceUrlAtRequestedDate: datedSourceUrlFor(citation, kind, requestedDate),
  };
}

/**
 * Read one provision as it stood at a requested date.
 *
 * @throws {ServiceError} `invalid_input` for a malformed date or citation
 *   (before any fetch), and for a date that predates eCFR's archive;
 *   `not_found` when the provision does not exist at that date.
 */
export async function historicalSection(
  deps: HistoricalDeps,
  requestedDate: string,
  rawCitation: string,
): Promise<HistoricalSection> {
  // Validation first: a bad date or citation must not cost a 2-3 MB fetch.
  const date = assertIssueDate(requestedDate, 'requested date');
  const parsed = normalizeCitation(rawCitation);
  if (parsed === null) {
    throw new ServiceError(
      `not a citation: ${rawCitation} (e.g. "4.130" or "38 CFR 4.130")`,
      'invalid_input',
    );
  }

  deps.logger.info('fetching historical title XML', { requestedDate: date });
  const xml = await fetchFullTitleXml(deps.ecfr, date);

  const sections = parseTitleXml(xml);
  if (sections.length === 0) {
    throw new ServiceError(
      `parsed zero provisions from the ${date} document — eCFR XML format may have changed (see docs/SPEC.md §3)`,
      'not_found',
    );
  }

  const provision = findProvision(sections, parsed.kind, parsed.citation);
  if (provision === undefined) {
    throw new ServiceError(
      `${parsed.citation} is not in Title 38 as of ${date} (eCFR serves the revision in force on that date)`,
      'not_found',
    );
  }

  const { sourceUrl, sourceUrlAtRequestedDate } = urlsFor(provision.kind, provision.citation, date);
  return {
    requestedDate: date,
    citation: provision.citation,
    kind: provision.kind,
    heading: provision.heading,
    chapter: provision.chapter,
    part: provision.part,
    subpart: provision.subpart,
    path: provision.path,
    text: provision.text,
    markdown: provision.markdown,
    sourceUrl,
    sourceUrlAtRequestedDate,
  };
}
