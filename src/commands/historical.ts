import { historicalSection, type HistoricalSection } from '../core/historical.js';
import { POINT_IN_TIME_NOTICE_SECTION } from '../core/point-in-time.js';
import type { Logger } from '../logger.js';
import { createEcfrApi } from './ensure-index.js';

/**
 * `cfr-free historical <at> <citation>` — one provision as it stood at a
 * requested date.
 *
 * Stateless: the revision in force on the requested date is fetched from
 * eCFR and the provision is read out of it. Nothing is read from the local
 * index, and nothing is cached.
 *
 * The output NAMES THE REQUESTED DATE and the revision in force on it —
 * eCFR does not report which issue date it served, so no "served revision"
 * is claimed.
 */
export async function runHistoricalCommand(
  logger: Logger,
  atDate: string,
  citation: string,
): Promise<HistoricalSection> {
  return await historicalSection({ ecfr: createEcfrApi(), logger }, atDate, citation);
}

/**
 * Render a historical read for stdout: a provenance banner first (so a
 * reader never mistakes the text for today's), then the heading and the
 * text.
 */
export function formatHistoricalSection(section: HistoricalSection): string {
  const lines: string[] = [];
  lines.push(
    `Section ${section.citation} as of ${section.requestedDate} ` +
      `(${POINT_IN_TIME_NOTICE_SECTION})`,
  );
  lines.push(`Heading: ${section.heading}`);
  lines.push('');
  lines.push(section.text);
  return `${lines.join('\n')}\n`;
}
