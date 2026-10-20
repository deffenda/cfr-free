import { existsSync } from 'node:fs';
import type { AppConfig } from '../config.js';
import { CHANGE_LIST_CAP } from '../core/changes.js';
import { diffIssues, type IssueDiff } from '../core/diff.js';
import { Store } from '../core/store.js';
import { CommandError, EXIT } from '../exit-codes.js';
import type { Logger } from '../logger.js';
import { createEcfrApi } from './ensure-index.js';

/**
 * `cfr-free diff <from> [to]` — provision-level diff of two eCFR issue dates.
 *
 * Stateless: both dates' full-title XML is fetched from eCFR and diffed on
 * the fly. When `to` is omitted it defaults to the issue date recorded by
 * the last sync ("what changed since my index was built?").
 *
 * @throws {CommandError} (exit 3) when `to` is omitted and there is no index
 *   (or the index carries no issue date) to resolve it from.
 */
export async function runDiffCommand(
  config: AppConfig,
  logger: Logger,
  fromDate: string,
  toDate?: string,
): Promise<IssueDiff> {
  let resolvedTo = toDate;
  if (resolvedTo === undefined) {
    // Store.open creates the file (DatabaseSync opens/creates), so a
    // missing path must be reported before opening — otherwise the first
    // `diff <from>` without an index would fabricate an empty index and read
    // no issue date from it, producing a confusing error instead of this one.
    if (!existsSync(config.indexPath)) {
      throw new CommandError(
        `no index at ${config.indexPath} — run \`cfr-free sync\` first`,
        EXIT.INDEX_UNAVAILABLE,
      );
    }
    // STRICT open (no allowSchemaUpgrade): diff only reads `issue_date` and
    // must not adopt an index sync itself would refuse to keep.
    const store = Store.open(config.indexPath);
    try {
      resolvedTo = store.getMeta('issue_date') ?? undefined;
    } finally {
      store.close();
    }
    if (resolvedTo === undefined) {
      throw new CommandError(
        `index at ${config.indexPath} has no issue date — run \`cfr-free sync\` first`,
        EXIT.INDEX_UNAVAILABLE,
      );
    }
  }
  return await diffIssues({ ecfr: createEcfrApi(), logger }, fromDate, resolvedTo);
}

/**
 * Render an issue diff for stdout: one summary line, then the changed,
 * added and removed citations capped at {@link CHANGE_LIST_CAP} per list
 * (counts always reflect the full diff) with an ellipsis note when cut.
 */
export function formatIssueDiff(diff: IssueDiff): string {
  const { changed, added, removed } = diff;
  const total = changed.length + added.length + removed.length;
  const lines: string[] = [
    total > 0
      ? `${changed.length} changed, ${added.length} added, ${removed.length} removed ` +
        `between ${diff.fromIssueDate} and ${diff.toIssueDate}`
      : `no provision changes between ${diff.fromIssueDate} and ${diff.toIssueDate}`,
  ];
  for (const [label, citations] of [
    ['changed', changed],
    ['added', added],
    ['removed', removed],
  ] as const) {
    if (citations.length === 0) continue;
    lines.push(`${label} (${citations.length}):`);
    for (const citation of citations.slice(0, CHANGE_LIST_CAP)) lines.push(`  ${citation}`);
    if (citations.length > CHANGE_LIST_CAP) {
      lines.push(`  … ${citations.length - CHANGE_LIST_CAP} more not shown`);
    }
  }
  return `${lines.join('\n')}\n`;
}
