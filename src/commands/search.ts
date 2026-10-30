import type { AppConfig } from '../config.js';
import { CFRService, type PresentedHit, type SearchResponse } from '../core/service.js';
import { Store } from '../core/store.js';
import type { Logger } from '../logger.js';
import { ensureIndex, createEcfrApi } from './ensure-index.js';

/**
 * The search parameters the CLI accepts, mirroring the HTTP query
 * parameters: `--page`, `--per-page`, `--part`, `--kind`, `--chapter`.
 */
export interface SearchOptions {
  readonly page?: number | undefined;
  readonly perPage?: number | undefined;
  readonly part?: string | undefined;
  readonly kind?: 'section' | 'appendix' | undefined;
  readonly chapter?: string | undefined;
}

/**
 * `cfr-free search <query>` — ranked provisions from the local index, the
 * same search the MCP and HTTP surfaces run, so a CLI-only user can search.
 *
 * The page size is the reader's to choose: the ten results the command used
 * to print were a dead end for anyone who narrowed by the wrong wording,
 * because there was no route to the rest.
 */
export async function runSearchCommand(
  config: AppConfig,
  logger: Logger,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const store = Store.open(config.indexPath);
  try {
    await ensureIndex(store, config, logger);
    const service = new CFRService(store, config.maxAgeDays, createEcfrApi(), logger);
    return service.search({ query, ...options });
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
  return [
    `${rank}. ${hit.citationDisplay} — ${hit.heading}`,
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
      // Say so when there is more than one page: the ten results the command
      // used to print were a dead end, and the reader cannot see the rest
      // unless they know the rest exists.
      (pageCount(result) > 1 ? `; page ${result.page} of ${pageCount(result)}` : '') +
      (result.unmatchedTerms.length > 0
        ? `; terms not answered by these hits: ${result.unmatchedTerms.join(', ')}`
        : ''),
  );
  if (result.notice !== null) lines.push(`warning: ${result.notice}`);
  return `${lines.join('\n')}\n`;
}

/** How many pages the results span. */
function pageCount(result: SearchResponse): number {
  return Math.max(1, Math.ceil(result.total / result.perPage));
}

/**
 * Render search results as JSON, for a script to read.
 *
 * The payload is the `SearchResponse` verbatim — the same object the HTTP
 * API returns — so a script consumes it without having to parse the CLI's
 * prose. The prose is for a reader; a script should never have to.
 */
export function formatSearchResultsJson(result: SearchResponse): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
