import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { Store } from '../core/store.js';
import { syncIndex, type SyncReport } from '../core/sync.js';
import { createEcfrApi } from './ensure-index.js';

/** `cfr-free sync` — force a full rebuild of the local index. */
export async function runSyncCommand(config: AppConfig, logger: Logger): Promise<SyncReport> {
  const store = Store.open(config.indexPath);
  try {
    return await syncIndex({ ecfr: createEcfrApi(), store, logger });
  } finally {
    store.close();
  }
}
