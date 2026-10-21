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

function formatHit(hit: PresentedHit, rank: number): string {
  return [
    `${rank}. ${hit.citationDisplay} — ${hit.heading}`,
    `   ${hit.sourceUrl}`,
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
  return `${lines.join('\n')}\n`;
}
