import { CHANGE_LIST_CAP, diffHashes, hashText, type SyncChanges } from './changes.js';
import type { Logger } from '../logger.js';
import type { EcfrApi } from './ecfr.js';
import { countNodes, parseStructure, type StructureNode } from './structure.js';
import type { Store } from './store.js';
import { parseTitleXml, type RawSection } from './xml.js';

/**
 * Full index build: resolve the issue date, pull structure + full-title XML,
 * parse, then atomically replace the store contents in one transaction.
 */

/** Bump when the parsing contract changes (recorded in `meta`).
 *  v2: numeric character references (`&#xA7;` → §) are now decoded. */
export const PARSER_VERSION = '2';

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
  /** Provision-level delta versus the previous index (counts only). */
  readonly changes: { readonly changed: number; readonly added: number; readonly removed: number };
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

  // Snapshot the outgoing index so the rebuild can report what actually
  // changed at the provision level (roadmap: sync-change report).
  const previousIssueDate = store.getMeta('issue_date');
  const previousParser = store.getMeta('parser_version');
  const oldHashes =
    store.countSections() > 0 ? store.captureTextHashes() : new Map<string, string>();

  const counts = countKinds(sections);

  // Build the change report BEFORE the rebuild so it rides the SAME
  // transaction as the new index: a crash between the two writes used to
  // leave a fresh index presenting the PREVIOUS sync's report (scout #3).
  // Every input here (oldHashes/previousIssueDate/previousParser above) is
  // captured pre-commit — nothing is read after the wipe.
  const newHashes = new Map<string, string>();
  for (const section of sections) newHashes.set(section.citation, hashText(section.text));
  const baseline = oldHashes.size === 0;
  const diff = diffHashes(oldHashes, newHashes);
  const changes: SyncChanges = baseline
    ? {
        fromIssueDate: null,
        toIssueDate: issueDate,
        changed: 0,
        added: 0,
        removed: 0,
        changedCitations: [],
        addedCitations: [],
        removedCitations: [],
        baseline: true,
        parserChanged: false,
        recordedAt: new Date().toISOString(),
      }
    : {
        fromIssueDate: previousIssueDate,
        toIssueDate: issueDate,
        changed: diff.changed.length,
        added: diff.added.length,
        removed: diff.removed.length,
        changedCitations: diff.changed.slice(0, CHANGE_LIST_CAP),
        addedCitations: diff.added.slice(0, CHANGE_LIST_CAP),
        removedCitations: diff.removed.slice(0, CHANGE_LIST_CAP),
        baseline: false,
        parserChanged: previousParser !== PARSER_VERSION,
        recordedAt: new Date().toISOString(),
      };

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
    // The report commits atomically with the index it describes.
    last_changes: JSON.stringify(changes),
  });

  const report: SyncReport = {
    issueDate,
    sections: counts.sections,
    appendices: counts.appendices,
    durationMs: Date.now() - startedAt,
    changes: { changed: changes.changed, added: changes.added, removed: changes.removed },
  };
  logger.info('index rebuilt', { ...report });
  return report;
}
