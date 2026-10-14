import { createHash } from 'node:crypto';

/**
 * What changed between the previous sync and the current one, computed from
 * per-citation content hashes. eCFR amends Title 38 continuously; an
 * adjudicator tracking a provision needs "what did the last sync actually
 * change?" without diffing the whole title by hand. No schema changes: old
 * hashes are captured from the live table before the wholesale rebuild, new
 * hashes come from the freshly parsed sections.
 */

/** Citations listed per category; counts always reflect the full diff. */
export const CHANGE_LIST_CAP = 100;

export interface SyncChanges {
  /** Issue date of the previous index (null on the very first sync). */
  readonly fromIssueDate: string | null;
  readonly toIssueDate: string;
  readonly changed: number;
  readonly added: number;
  readonly removed: number;
  readonly changedCitations: readonly string[];
  readonly addedCitations: readonly string[];
  readonly removedCitations: readonly string[];
  /** True when there was no previous index to compare against. */
  readonly baseline: boolean;
  /** True when the parser version moved — text re-extraction can fake a full-title diff. */
  readonly parserChanged: boolean;
  readonly recordedAt: string;
}

/** sha256 of a section's text — the unit of "did this provision change?". */
export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Citation-level diff of two hash snapshots; result lists are sorted. */
export function diffHashes(
  oldHashes: ReadonlyMap<string, string>,
  newHashes: ReadonlyMap<string, string>,
): { changed: string[]; added: string[]; removed: string[] } {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [citation, hash] of newHashes) {
    const previous = oldHashes.get(citation);
    if (previous === undefined) added.push(citation);
    else if (previous !== hash) changed.push(citation);
  }
  for (const citation of oldHashes.keys()) {
    if (!newHashes.has(citation)) removed.push(citation);
  }
  changed.sort();
  added.sort();
  removed.sort();
  return { changed, added, removed };
}
