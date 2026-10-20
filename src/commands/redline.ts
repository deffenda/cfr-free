import { redlineSection, type SectionRedline } from '../core/redline.js';
import type { Logger } from '../logger.js';
import { createEcfrApi } from './ensure-index.js';

/**
 * `cfr-free redline <from> <to> <citation>` — line-level redline of one
 * provision between two eCFR issue dates.
 *
 * Stateless like `diff`: both dates' full-title XML is fetched and the one
 * provision extracted from each — no index interaction at all, which is why
 * this command takes no config (every argument is required; unlike `diff`'s
 * default `to`, a redline cannot guess its dates).
 *
 * @throws {ServiceError} (`invalid_input`) for bad dates/citations,
 *   (`not_found`) when the citation is in neither date's parse.
 * @throws {SyncError} when either date parses to zero sections.
 */
export async function runRedlineCommand(
  logger: Logger,
  fromDate: string,
  toDate: string,
  citation: string,
): Promise<SectionRedline> {
  return await redlineSection({ ecfr: createEcfrApi(), logger }, fromDate, toDate, citation);
}

/**
 * Render a redline for stdout: the summary line, then — when there are hunks
 * — a legend header and one line per hunk in the orchestrator-pinned format
 * `L{from} | L{to} | {prefix}{text}`:
 *
 * - anchors are the hunk's 1-based line numbers, `L-` when that side has no
 *   counterpart line (additions have no from-line, deletions no to-line);
 * - prefix is `-` for a deletion, `+` for an addition, and a single space
 *   for an unchanged line, so the content column reads as the redline itself;
 * - coarse-fallback hunks render through the same fields — their anchors
 *   point at the two whole-text blocks.
 *
 * Exit-code policy lives in the CLI: a redline WITH changes is a success (0),
 * exactly like `diff`.
 */
export function formatSectionRedline(report: SectionRedline): string {
  const lines = [
    `Section ${report.citation}: ${report.status} between ${report.fromIssueDate} and ${report.toIssueDate}`,
  ];
  if (report.hunks.length > 0) {
    lines.push(`        | ${report.fromIssueDate} | ${report.toIssueDate} | text`);
    for (const hunk of report.hunks) {
      const prefix = hunk.type === 'del' ? '-' : hunk.type === 'add' ? '+' : ' ';
      lines.push(`L${hunk.fromLine ?? '-'} | L${hunk.toLine ?? '-'} | ${prefix}${hunk.text}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
