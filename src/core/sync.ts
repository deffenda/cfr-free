import {
  CHANGE_LIST_CAP,
  corpusHash,
  diffHashes,
  hashContent,
  type SyncChanges,
} from './changes.js';
import type { Logger } from '../logger.js';
import type { EcfrApi } from './ecfr.js';
import { countNodes, parseStructure, type StructureNode } from './structure.js';
import type { Store } from './store.js';
import { IMAGE_MARKER_PREFIX, parseTitleXml, type RawSection } from './xml.js';

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
  /**
   * Provisions whose text carries at least one "image content not included"
   * marker (review finding P1-01). These provisions are NOT textually
   * complete: their eCFR graphics (the rating tables) are absent and are
   * flagged in place, so a matching section count never implies complete
   * textual coverage.
   */
  readonly imageContentSections: number;
  /**
   * The corpus receipt: sha256 over every provision's (citation,
   * content-hash) pair — content = text + heading, the change-diff unit
   * (SPEC §4). Together with the issue date it identifies the provisions
   * the index was rebuilt from, so two retrieval runs are comparable only
   * when their receipts agree.
   */
  readonly corpusHash: string;
}

/**
 * Count the provisions that carry at least one image marker. The marker is
 * emitted by the parser, so the count is derived from the parsed corpus —
 * never guessed.
 */
function countImageContentSections(sections: readonly RawSection[]): number {
  let count = 0;
  for (const section of sections) {
    if (section.text.includes(IMAGE_MARKER_PREFIX)) count += 1;
  }
  return count;
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

/**
 * Derive the provision-level change report from the baseline snapshot.
 *
 * Runs INSIDE the rebuild transaction (see `Store.replaceAllWithBaseline`):
 * every input here must come from that in-transaction snapshot or from OUR
 * own freshly parsed sections — nothing may be read before BEGIN IMMEDIATE,
 * or a concurrent sync could commit its own index in between and the report
 * would describe a baseline this sync never replaced.
 */
function buildChanges(input: {
  readonly previousIssueDate: string | null;
  readonly previousParser: string | null;
  readonly oldHashes: ReadonlyMap<string, string>;
  readonly newHashes: ReadonlyMap<string, string>;
  readonly issueDate: string;
}): SyncChanges {
  const { previousIssueDate, previousParser, oldHashes, newHashes, issueDate } = input;
  const baseline = oldHashes.size === 0;
  const diff = diffHashes(oldHashes, newHashes);
  return baseline
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
  const imageContentSections = countImageContentSections(sections);

  // newHashes for the diff: computed from OUR own parsed XML, so it is safe
  // to do outside the transaction (~2 970 sha256 hashes — real CPU time we
  // must not hold the write lock for). The rebuild transaction below then
  // only snapshots the outgoing index and swaps rows.
  const newHashes = new Map<string, string>();
  for (const section of sections) {
    // Text AND heading — a retitled provision with an unchanged body is a
    // change (see hashContent).
    newHashes.set(section.citation, hashContent(section.text, section.heading));
  }

  const meta: Record<string, string> = {
    issue_date: issueDate,
    synced_at: new Date().toISOString(),
    appendices_count: String(counts.appendices),
    // Provisions whose eCFR graphics are NOT included (P1-01): persisted so
    // a later reader can tell the index is not textually complete.
    image_content_sections: String(imageContentSections),
    structure_expected_sections: String(expected.expectedSections),
    structure_expected_appendices: String(expected.expectedAppendices),
    structure_json: JSON.stringify(structureRaw),
    parser_version: PARSER_VERSION,
    // The report commits atomically with the index it describes (batch-4
    // R4): filled from the in-transaction snapshot below, BEFORE the meta
    // upserts run — so it still rides the SAME rebuild COMMIT.
  };

  // The corpus receipt (SPEC §4): a sha256 over the whole corpus's
  // per-provision content hashes. It is set on the SAME meta object the
  // rebuild upserts, so the receipt rides the rebuild's COMMIT — this
  // rebuild path cannot commit rows without the receipt that describes
  // them. Residual risk outside this path: meta keys it does not write
  // are left as they are, so a rebuild performed by a binary that
  // predates the receipt would leave a stale one behind, undetected.
  meta.corpus_hash = corpusHash(newHashes);

  // The baseline snapshot (previous issue date, previous parser, outgoing
  // text hashes) is taken INSIDE the rebuild transaction by the callback:
  // between a pre-transaction snapshot and BEGIN IMMEDIATE a second
  // `cfr-free sync` could commit its own index, making this report describe
  // a baseline we never actually replaced (scout #3 / batch-5 R3).
  const changes: SyncChanges = store.replaceAllWithBaseline(
    sections,
    issueDate,
    meta,
    (snapshot) => {
      const built = buildChanges({
        previousIssueDate: snapshot.getMeta('issue_date'),
        previousParser: snapshot.getMeta('parser_version'),
        oldHashes:
          snapshot.countSections() > 0 ? snapshot.captureTextHashes() : new Map<string, string>(),
        newHashes,
        issueDate,
      });
      meta.last_changes = JSON.stringify(built);
      return built;
    },
  );

  const report: SyncReport = {
    issueDate,
    sections: counts.sections,
    appendices: counts.appendices,
    durationMs: Date.now() - startedAt,
    changes: { changed: changes.changed, added: changes.added, removed: changes.removed },
    imageContentSections,
    corpusHash: meta.corpus_hash,
  };
  logger.info('index rebuilt', { ...report });
  return report;
}
