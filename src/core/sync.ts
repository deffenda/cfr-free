import type { Logger } from '../logger.js';
import type { EcfrApi } from './ecfr.js';
import { countNodes, parseStructure, type StructureNode } from './structure.js';
import type { Store } from './store.js';
import { parseTitleXml, type RawSection } from './xml.js';

/**
 * Full index build: resolve the issue date, pull structure + full-title XML,
 * parse, then atomically replace the store contents in one transaction.
 */

/** Bump when the parsing contract changes (recorded in `meta`). */
export const PARSER_VERSION = '1';

/** Raised when a sync cannot produce a usable index. */
export class SyncError extends Error {
  override readonly name = 'SyncError';
}

export interface SyncDeps {
  readonly ecfr: EcfrApi;
  readonly store: Store;
  readonly logger: Logger;
}

export interface SyncReport {
  readonly issueDate: string;
  readonly sections: number;
  readonly appendices: number;
  readonly durationMs: number;
}

function countKinds(sections: readonly RawSection[]): { sections: number; appendices: number } {
  let sectionCount = 0;
  let appendixCount = 0;
  for (const section of sections) {
    if (section.kind === 'appendix') appendixCount += 1;
    else sectionCount += 1;
  }
  return { sections: sectionCount, appendices: appendixCount };
}

function verifyAgainstStructure(
  sections: readonly RawSection[],
  structure: StructureNode,
  logger: Logger,
): { expectedSections: number; expectedAppendices: number } {
  const expectedSections = countNodes(structure, 'section');
  const expectedAppendices = countNodes(structure, 'appendix');
  const actual = countKinds(sections);
  if (actual.sections !== expectedSections || actual.appendices !== expectedAppendices) {
    logger.warn('parsed counts differ from structure tree', {
      expectedSections,
      actualSections: actual.sections,
      expectedAppendices,
      actualAppendices: actual.appendices,
    });
  }
  // Expected counts are persisted so later readers can detect drift (SPEC §13).
  return { expectedSections, expectedAppendices };
}

/** Build (or rebuild) the local index from live eCFR data. */
export async function syncIndex(deps: SyncDeps): Promise<SyncReport> {
  const startedAt = Date.now();
  const { ecfr, store, logger } = deps;

  logger.info('resolving eCFR issue date for title 38');
  const schedule = await ecfr.getTitleSchedule();
  const issueDate = schedule.upToDateAsOf;

  logger.info('fetching title structure', { issueDate });
  const structureRaw = await ecfr.getStructureJson(issueDate);
  const structure = parseStructure(structureRaw);

  logger.info('fetching full title XML', { issueDate });
  const xml = await ecfr.getFullTitleXml(issueDate);

  const sections = parseTitleXml(xml);
  if (sections.length === 0) {
    throw new SyncError(
      'parsed zero sections — eCFR XML format may have changed (see docs/SPEC.md §3)',
    );
  }
  const expected = verifyAgainstStructure(sections, structure, logger);

  const counts = countKinds(sections);
  store.replaceAll(sections, issueDate, {
    issue_date: issueDate,
    up_to_date_as_of: schedule.upToDateAsOf,
    title_name: schedule.name,
    synced_at: new Date().toISOString(),
    sections_count: String(counts.sections),
    appendices_count: String(counts.appendices),
    structure_expected_sections: String(expected.expectedSections),
    structure_expected_appendices: String(expected.expectedAppendices),
    structure_json: JSON.stringify(structureRaw),
    parser_version: PARSER_VERSION,
    source: 'ecfr.gov',
  });

  const report: SyncReport = {
    issueDate,
    sections: counts.sections,
    appendices: counts.appendices,
    durationMs: Date.now() - startedAt,
  };
  logger.info('index rebuilt', { ...report });
  return report;
}
