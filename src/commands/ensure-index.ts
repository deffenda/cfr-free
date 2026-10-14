import type { AppConfig } from '../config.js';
import { HttpClient } from '../core/http-client.js';
import { EcfrApi } from '../core/ecfr.js';
import { CommandError, EXIT } from '../exit-codes.js';
import type { Logger } from '../logger.js';
import type { Store } from '../core/store.js';
import { syncIndex } from '../core/sync.js';
import { CFRService } from '../core/service.js';
import { VERSION } from '../version.js';

/** Create the eCFR client with a versioned User-Agent. */
export function createEcfrApi(): EcfrApi {
  return new EcfrApi(new HttpClient({ userAgent: `cfr-free/${VERSION}` }));
}

export type Freshness = 'fresh' | 'synced' | 'stale';

/** Injectable dependencies (tests supply an offline eCFR client). */
export interface EnsureIndexDeps {
  readonly createEcfr?: () => EcfrApi;
}

/**
 * Guarantee a usable index before serving.
 *
 * Policy (SPEC §10 #2): sync before serving; if a refresh fails but rows
 * exist, serve the stale index with a warning; if there are no rows at all,
 * fail with an actionable error.
 *
 * @throws {CommandError} (exit 3) when the index is empty and auto-sync is
 *   off; `SyncError` when a sync attempt itself fails.
 */
export async function ensureIndex(
  store: Store,
  config: AppConfig,
  logger: Logger,
  deps: EnsureIndexDeps = {},
): Promise<Freshness> {
  const createEcfr = deps.createEcfr ?? createEcfrApi;
  const service = new CFRService(store, config.maxAgeDays);
  const status = service.status();

  if (status.sections === 0) {
    if (!config.autoSync) {
      throw new CommandError(
        `index at ${config.indexPath} is empty — run \`cfr-free sync\` first`,
        EXIT.INDEX_UNAVAILABLE,
      );
    }
    logger.info('index empty, running initial sync', { index: config.indexPath });
    await syncIndex({ ecfr: createEcfr(), store, logger });
    return 'synced';
  }

  if (status.stale && config.autoSync) {
    logger.info('index is stale, refreshing', {
      syncedAt: status.syncedAt,
      maxAgeDays: config.maxAgeDays,
    });
    try {
      await syncIndex({ ecfr: createEcfr(), store, logger });
      return 'synced';
    } catch (error) {
      logger.warn('refresh failed, serving existing index', {
        message: error instanceof Error ? error.message : String(error),
      });
      return 'stale';
    }
  }

  return 'fresh';
}
