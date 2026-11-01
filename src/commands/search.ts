import type { AppConfig } from '../config.js';
import { CFRService, type PresentedHit, type SearchResponse } from '../core/service.js';
import { Store } from '../core/store.js';
import type { Logger } from '../logger.js';
import { ensureIndex, createEcfrApi } from './ensure-index.js';

/**
 * `cfr-free search <query>` — ranked provisions from the local index, the
 * same search the MCP and HTTP surfaces run, so a CLI-only user can search.
 */
export async function runSearchCommand(
  config: AppConfig,
  logger: Logger,
  query: string,
): Promise<SearchResponse> {
  const store = Store.open(config.indexPath);
  try {
    await ensureIndex(store, config, logger);
    const service = new CFRService(store, config.maxAgeDays, createEcfrApi(), logger);
    return service.search({ query, perPage: 10 });
  } finally {
    store.close();
  }
}

/**
 * One hit, rendered for a reader.
 *
 * The URL printed is the DATED one — the revision the indexed text actually
 * came from — not the current eCFR URL for the same citation. The two point
 * at different revisions, and a reader who pastes the current URL into a
 * memo has cited text they cannot show they read. This is the same
 * distinction the section read and the UI's copy block make, and it is what
 * the pilot protocol's F1 task asks the participant to state.
 */
function formatHit(hit: PresentedHit, rank: number): string {
  let part = '';
  if (hit.part !== null && hit.part !== undefined) {
    part = ' — part ' + String(hit.part);
    if (hit.partTitle !== null && hit.partTitle !== undefined && String(hit.partTitle) !== '') {
      part = part + ': ' + String(hit.partTitle);
    }
  }
  return [
    `${rank}. ${hit.citationDisplay} — ${hit.heading}${part}`,
    `   ${hit.sourceUrlAtIndexDate}`,
    `   ${hit.snippet}`,
  ].join('\n');
}

/** Render search results for stdout: the hits, then the grounding summary. */
export function formatSearchResults(result: SearchResponse): string {
  const lines: string[] = [];
  if (result.hits.length === 0) {
    lines.push(`No provisions match "${result.query}".`);
  } else {
    result.hits.forEach((hit, index) => lines.push(formatHit(hit, index + 1)));
  }
  lines.push('');
  lines.push(
    `${result.total} candidate provision(s); index issue date ${result.indexIssueDate ?? 'unknown'}` +
      (result.unmatchedTerms.length > 0
        ? `; terms not answered by these hits: ${result.unmatchedTerms.join(', ')}`
        : ''),
  );
  if (result.notice !== null) lines.push(`warning: ${result.notice}`);
  return `${lines.join('\n')}\n`;
}
