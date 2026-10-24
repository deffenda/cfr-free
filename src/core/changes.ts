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

/**
 * sha256 of a section's TEXT — the unit of "did this provision change?".
 *
 * Kept for callers that compare text alone (the redline's line-level
 * contract). The change-detection surfaces use {@link hashContent}, which
 * also covers the heading.
 */
export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * sha256 of a provision's CONTENT — its text AND its heading.
 *
 * A heading is part of the provision's meaning: Title 38 § 3.17 was
 * retitled from "Disability and death pension" to "Disability and
 * survivors pension" with no change to the body, and a text-only hash
 * reported that amendment as "no change" — in the sync report, in
 * `cfr-free diff`, and in the MCP diff tool alike. Measured on the live
 * corpus: exactly one such heading-only amendment per ~2,921 provisions
 * per year, and it is invisible to a text-only comparison.
 *
 * The separator keeps the two fields unambiguous (no collision between a
 * text/heading pair and a different pair with the same concatenation).
 */
export function hashContent(text: string, heading: string): string {
  return createHash('sha256')
    .update(text, 'utf8')
    .update('\u0000', 'utf8')
    .update(heading, 'utf8')
    .digest('hex');
}

/**
 * sha256 over the corpus's per-provision (citation, content-hash) pairs —
 * the corpus receipt.
 *
 * The pairs are sorted by citation and hashed as `citation\0hash\n`, so the
 * ONE value identifies the provisions a rebuild produced AND binds each
 * content hash to its citation — independent of the order the parser emitted
 * the provisions, the sync time, and the machine. Two rebuilds of the same
 * corpus therefore carry the same receipt; one amended text or heading
 * character (or a citation renamed) changes it.
 *
 * Each per-provision hash is the same content hash the change diff uses
 * (text + heading), so the receipt moves whenever a provision amendment does.
 */
export function corpusHash(hashes: ReadonlyMap<string, string>): string {
  const digest = createHash('sha256');
  // Sorted by citation, then hashed as `citation\0hash\n` pairs. The pairs
  // are taken from the map's own entries, so a key always carries its hash
  // (no lookup that could miss).
  const pairs = [...hashes.entries()].sort(([left], [right]) => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
  for (const [citation, hash] of pairs) {
    digest.update(`${citation}\0${hash}\n`, 'utf8');
  }
  return digest.digest('hex');
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
