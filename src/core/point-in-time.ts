/**
 * The limit on what a point-in-time date MEANS, in one place.
 *
 * eCFR's versioner serves the revision IN FORCE on a requested date and
 * does not report which issue date that revision was. So a date is a
 * SELECTOR, never a stamp of what was served — the two differ whenever a
 * date is not itself an issue date, and a reader who believes otherwise
 * can be wrong about which text they are looking at.
 *
 * The sentence already existed, in the `historical` command's output and in
 * the MCP tool descriptions. It did NOT exist on the change views (the
 * diff and the redline), which is where a reader comparing two revisions
 * is most likely to over-read the dates. These surfaces now carry it.
 *
 * One constant, so the diff and the redline cannot drift apart in wording
 * and so the limit is phrased identically wherever it appears.
 */
export const POINT_IN_TIME_NOTICE =
  'eCFR serves the revision in force on the requested date and does not report which issue date that is, so these dates are selectors and not a stamp of the revision served';

/**
 * The same limit, phrased for a reader looking at a section read (one
 * provision at a date) rather than a comparison.
 */
export const POINT_IN_TIME_NOTICE_SECTION =
  'eCFR serves the revision in force on that date; it does not report which issue date that is';
