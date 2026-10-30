import type { EcfrApi } from './ecfr.js';
import { ServiceError } from './errors.js';

/** The earliest date eCFR's point-in-time archive serves (measured 2026-10-20). */
export const ARCHIVE_FLOOR = '2017-01-01';

/**
 * Fetch the full title XML, turning eCFR's "no revision for this date"
 * into the usage error it is.
 *
 * A date before the archive is a bad ARGUMENT, not a missing provision:
 * it must exit 2 (usage) and answer 400, not 1 (a service failure a
 * script would retry forever) and 500. The same wording serves the CLI,
 * the HTTP API and the MCP tool, so the reader is told which of their
 * dates is the problem.
 *
 * This lives apart from `historical.ts` because `diff` and `redline` need
 * it too, and they sit below `historical` in the module graph.
 */
export async function fetchFullTitleXml(ecfr: EcfrApi, date: string): Promise<string> {
  try {
    return await ecfr.getFullTitleXml(date);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 404) throw error;
    // Two different mistakes share one upstream answer: a date before the
    // archive, and a date inside it that simply has no revision (a
    // calendar edge such as 2025-02-29). Both are the reader's argument,
    // not a service failure — but only the first has the archive to blame.
    if (date < ARCHIVE_FLOOR) {
      throw new ServiceError(
        `eCFR serves no revision for ${date} — its point-in-time archive starts at ${ARCHIVE_FLOOR}`,
        'invalid_input',
      );
    }
    throw new ServiceError(`eCFR serves no revision for ${date}`, 'invalid_input');
  }
}
