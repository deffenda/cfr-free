import type { Logger } from '../logger.js';
import { fetchFullTitleXml } from './archive.js';
import { hashText } from './changes.js';
import { normalizeCitation, type ParsedCitation } from './citations.js';
import { assertIssueDate } from './diff.js';
import type { EcfrApi } from './ecfr.js';
import { POINT_IN_TIME_NOTICE } from './point-in-time.js';
import { ServiceError } from './errors.js';
import { SyncError } from './sync.js';
import { parseTitleXml, type RawSection } from './xml.js';

/**
 * Per-provision line redline: "what lines changed in 38 CFR 4.125 between
 * issue date A and B?". Both dates' full-title XML is fetched through the
 * SAME document endpoint `diff` uses (no new eCFR URL shape = no new failure
 * modes), the one requested provision is extracted from each parse, and its
 * text is diffed line by line. A provision absent on one date is reported as
 * added/removed; one absent from BOTH dates is `not_found` after the fetches.
 */

/** Above this many lines on EITHER side, the LCS is replaced by coarse blocks. */
export const MAX_REDLINE_LINES = 2_000;

/** Provision lifecycle across the two issue dates. */
export type RedlineStatus = 'changed' | 'added' | 'removed' | 'unchanged';

/**
 * One line of the unified-diff-shaped redline. Line numbers are 1-based
 * anchors into the from/to text; `null` means "this side has no counterpart
 * line" (an addition has no from-line, a deletion no to-line).
 */
export interface Hunk {
  readonly fromLine: number | null;
  readonly toLine: number | null;
  readonly type: 'same' | 'add' | 'del';
  readonly text: string;
}

/** Line redline of one citation between two issue dates. */
export interface SectionRedline {
  readonly fromIssueDate: string;
  readonly toIssueDate: string;
  /** Canonical citation of the matched provision (the XML row's citation). */
  readonly citation: string;
  readonly status: RedlineStatus;
  /** Absent when the provision did not exist on that date. */
  readonly fromText?: string;
  readonly toText?: string;
  readonly hunks: readonly Hunk[];
  /**
   * True when either side exceeded {@link MAX_REDLINE_LINES}: `hunks` then
   * holds exactly two coarse blocks (whole from-text, whole to-text) instead
   * of an LCS walk, so no per-line identity is claimed above the cap.
   */
  readonly coarse: boolean;
  /**
   * The limit on what the two dates MEAN, stated on the surface that shows
   * the comparison. eCFR serves the revision in force on a requested date
   * and does not report which issue date that revision was, so the dates
   * are SELECTORS and not a stamp of what was served. A reader comparing two
   * revisions is exactly the reader most likely to over-read them.
   */
  readonly notice: string;
}

/**
 * Split redline text into lines on `\n` ONLY — a CRLF source keeps its `\r`
 * inside the line text (`"a\r\nb"` → `["a\r", "b"]`), so the redline shows
 * the source bytes honestly instead of silently normalizing them. eCFR text
 * is control-free in practice (parseTitleXml funnels every rendered path
 * through collapseWhitespace — probed: even `&#xD;` collapses to a space),
 * which makes this the diff layer's own defense-in-depth discipline.
 */
export function splitRedlineLines(text: string): string[] {
  return text.split('\n');
}

/**
 * Find the provision in one date's parse. Citation identity follows
 * normalizeCitation's output and the XML row's raw `N` attribute:
 *
 * - sections compare case-INSENSITIVELY — normalizeCitation lowercases the
 *   input (probe: `4.125`, `38 CFR 4.125`, `§ 4.125` all → `4.125`) while
 *   the XML `N` may carry different casing (probe: a row parses as
 *   `4.124A`), so both sides fold to lower case — plain equality would miss
 *   such a provision;
 * - appendices compare case-INSENSITIVELY too — the store is this repo's
 *   citation-identity authority and `Store.getSection` resolves appendix
 *   citations with COLLATE NOCASE (src/core/store.ts), so 'appendix a to
 *   part 4' hits the same row 'Appendix A to Part 4' does. The REPORTED
 *   citation stays the row's verbatim XML `N` (the corpus form), while the
 *   MATCH folds both sides to lower case.
 */
function findProvision(
  sections: readonly RawSection[],
  target: ParsedCitation,
): RawSection | undefined {
  return sections.find((section) =>
    target.kind === 'appendix'
      ? section.kind === 'appendix' &&
        section.citation.toLowerCase() === target.citation.toLowerCase()
      : section.kind === 'section' && section.citation.toLowerCase() === target.citation,
  );
}

/** parseTitleXml plus the zero-section tripwire diffIssues applies per date. */
function parseDated(xml: string, issueDate: string): RawSection[] {
  const sections = parseTitleXml(xml);
  if (sections.length === 0) {
    throw new SyncError(
      `parsed zero sections for issue date ${issueDate} — eCFR XML format may have changed (see docs/SPEC.md §3)`,
    );
  }
  return sections;
}

/**
 * Read one LCS table cell. All reads are in-range by construction (loop
 * bounds keep `row ≤ rows`, `col ≤ cols`); boundary cells that were never
 * written hold Uint16Array's zero-filled allocation default — which is
 * exactly the LCS base case (an empty suffix matches nothing). The assertion
 * records that fact for `noUncheckedIndexedAccess`, which types every
 * index read as `T | undefined` even for typed arrays.
 */
function cell(table: Uint16Array, row: number, col: number, stride: number): number {
  return table[row * stride + col] as number;
}

/**
 * Read one line of a capped array. Loop bounds keep the index inside
 * `lines`, so the element is always present — same `noUncheckedIndexedAccess`
 * record-keeping as {@link cell}.
 */
function lineAt(lines: readonly string[], index: number): string {
  return lines[index] as string;
}

/**
 * Line-level LCS diff: DP over LINES (identical lines only — no char- or
 * word-diff), then a greedy traceback that emits one hunk per line. The
 * traceback prefers a from-line deletion on ties, so output is deterministic.
 *
 * The caller caps inputs at {@link MAX_REDLINE_LINES} per side first, so the
 * table below is bounded (see the allocation comment).
 */
function lcsHunks(fromLines: readonly string[], toLines: readonly string[]): Hunk[] {
  const rows = fromLines.length;
  const cols = toLines.length;
  const stride = cols + 1;

  // Typed-array choice, at the allocation: capped inputs are ≤ 2000 lines
  // per side, so this table is ≤ 2001 × 2001 = ~4.0M entries and every LCS
  // value is ≤ min(rows, cols) ≤ 2000 — well inside Uint16's 0–65535 range.
  // A flat Uint16Array of exact size (2 bytes/entry, allocated ONCE, row-major
  // index arithmetic `row * stride + col`) covers the worst case at ~8 MB
  // where a Float64Array/number[] of the same length needs ~32 MB, and reads
  // sequentially during the fill — the whole point of capping first.
  const table = new Uint16Array((rows + 1) * stride);

  // Fill bottom-up: table[row][col] = LCS length of from[row..] vs to[col..].
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i * stride + j] =
        lineAt(fromLines, i) === lineAt(toLines, j)
          ? cell(table, i + 1, j + 1, stride) + 1
          : Math.max(cell(table, i + 1, j, stride), cell(table, i, j + 1, stride));
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    const fromLine = lineAt(fromLines, i);
    const toLine = lineAt(toLines, j);
    if (fromLine === toLine) {
      hunks.push({ fromLine: i + 1, toLine: j + 1, type: 'same', text: fromLine });
      i += 1;
      j += 1;
    } else if (cell(table, i + 1, j, stride) >= cell(table, i, j + 1, stride)) {
      hunks.push({ fromLine: i + 1, toLine: null, type: 'del', text: fromLine });
      i += 1;
    } else {
      hunks.push({ fromLine: null, toLine: j + 1, type: 'add', text: toLine });
      j += 1;
    }
  }
  while (i < rows) {
    hunks.push({ fromLine: i + 1, toLine: null, type: 'del', text: lineAt(fromLines, i) });
    i += 1;
  }
  while (j < cols) {
    hunks.push({ fromLine: null, toLine: j + 1, type: 'add', text: lineAt(toLines, j) });
    j += 1;
  }
  return hunks;
}

/**
 * Coarse fallback above the cap: exactly two hunks — the entire from-text as
 * one deletion (anchored at from-line 1) and the entire to-text as one
 * addition (anchored at to-line 1). Each block carries that side's TRUE line
 * count (its text is the whole side), so no per-line identity is claimed.
 */
function coarseHunks(fromText: string, toText: string): Hunk[] {
  return [
    { fromLine: 1, toLine: null, type: 'del', text: fromText },
    { fromLine: null, toLine: 1, type: 'add', text: toText },
  ];
}

/** added/removed: the present side's lines, each with its own 1-based anchor. */
function presenceHunks(lines: readonly string[], presentSide: 'from' | 'to'): Hunk[] {
  return lines.map((text, index): Hunk =>
    presentSide === 'from'
      ? { fromLine: index + 1, toLine: null, type: 'del', text }
      : { fromLine: null, toLine: index + 1, type: 'add', text },
  );
}

/**
 * Derive status + hunks from the two parses: existence first (added/removed,
 * neither → not_found), then text equality via hashText (unchanged before any
 * line work — a large identical provision never reaches the LCS), then the
 * capped line diff itself.
 */
/**
 * The redline WITHOUT the notice, so the notice is attached once, at the
 * single place the redline leaves the core, and cannot be missing from one
 * status.
 */
type RedlineBody = Omit<SectionRedline, 'notice'>;

function deriveRedline(
  fromSections: readonly RawSection[],
  toSections: readonly RawSection[],
  target: ParsedCitation,
  fromDate: string,
  toDate: string,
): RedlineBody {
  const fromRow = findProvision(fromSections, target);
  const toRow = findProvision(toSections, target);

  if (fromRow === undefined) {
    if (toRow === undefined) {
      throw new ServiceError(
        `citation ${target.citation} not found in Title 38 on ${fromDate} or ${toDate}`,
        'not_found',
      );
    }
    return {
      fromIssueDate: fromDate,
      toIssueDate: toDate,
      citation: toRow.citation,
      status: 'added',
      toText: toRow.text,
      hunks: presenceHunks(splitRedlineLines(toRow.text), 'to'),
      coarse: false,
    };
  }
  if (toRow === undefined) {
    return {
      fromIssueDate: fromDate,
      toIssueDate: toDate,
      citation: fromRow.citation,
      status: 'removed',
      fromText: fromRow.text,
      hunks: presenceHunks(splitRedlineLines(fromRow.text), 'from'),
      coarse: false,
    };
  }
  if (hashText(fromRow.text) === hashText(toRow.text)) {
    return {
      fromIssueDate: fromDate,
      toIssueDate: toDate,
      citation: fromRow.citation,
      status: 'unchanged',
      fromText: fromRow.text,
      toText: toRow.text,
      hunks: [],
      coarse: false,
    };
  }

  const fromLines = splitRedlineLines(fromRow.text);
  const toLines = splitRedlineLines(toRow.text);
  const coarse = fromLines.length > MAX_REDLINE_LINES || toLines.length > MAX_REDLINE_LINES;
  return {
    fromIssueDate: fromDate,
    toIssueDate: toDate,
    citation: fromRow.citation,
    status: 'changed',
    fromText: fromRow.text,
    toText: toRow.text,
    hunks: coarse ? coarseHunks(fromRow.text, toRow.text) : lcsHunks(fromLines, toLines),
    coarse,
  };
}

/**
 * Redline one eCFR provision across two issue dates.
 *
 * Pure function of the two dates + citation: no store interaction and no
 * structure fetch — same stance as {@link diffIssues} (a textual diff of two
 * parsed documents does not need the index).
 *
 * @throws {ServiceError} (`invalid_input`) for malformed, impossible
 *   (out-of-range month/day), or identical dates, and for a non-citation —
 *   all before any fetch.
 * @throws {ServiceError} (`not_found`) when the citation is missing from
 *   BOTH dates' parse results (raised after the fetches, naming the citation
 *   and both dates).
 * @throws {SyncError} when either date parses to zero sections.
 */
export async function redlineSection(
  deps: { readonly ecfr: EcfrApi; readonly logger: Logger },
  fromDate: string,
  toDate: string,
  citation: string,
): Promise<SectionRedline> {
  assertIssueDate(fromDate, 'from date');
  assertIssueDate(toDate, 'to date');
  if (fromDate === toDate) {
    throw new ServiceError('from date and to date are the same', 'invalid_input');
  }
  const target = normalizeCitation(citation);
  if (target === null) {
    throw new ServiceError(
      `unrecognized citation: ${JSON.stringify(citation)} (expected e.g. "4.125" or "38 CFR 4.125")`,
      'invalid_input',
    );
  }
  const { ecfr, logger } = deps;

  // Two independent GETs on a stateless HttpClient (http-client.ts keeps all
  // request state function-local), so the fetches run in parallel — the same
  // ~4.7 s two-document cost family as `diff`.
  logger.info('fetching full title XML', { issueDate: fromDate });
  logger.info('fetching full title XML', { issueDate: toDate });
  const [fromXml, toXml] = await Promise.all([
    fetchFullTitleXml(ecfr, fromDate),
    fetchFullTitleXml(ecfr, toDate),
  ]);

  logger.info('parsing and diffing provision text', {
    fromDate,
    toDate,
    citation: target.citation,
  });
  const fromSections = parseDated(fromXml, fromDate);
  const toSections = parseDated(toXml, toDate);

  const redline = deriveRedline(fromSections, toSections, target, fromDate, toDate);
  logger.info('section redline computed', {
    citation: redline.citation,
    status: redline.status,
    hunks: redline.hunks.length,
    coarse: redline.coarse,
  });
  // The notice is attached HERE, at the single place the redline leaves the
  // core, rather than in each of the four branches that build it — so the
  // limit cannot be missing from one status.
  return { ...redline, notice: POINT_IN_TIME_NOTICE };
}
