import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { Store } from '../core/store.js';
import type { SyncReport } from '../core/sync.js';
import { createEcfrApi, syncWithGuidance } from './ensure-index.js';

/** `cfr-free sync` — force a full rebuild of the local index. */
export async function runSyncCommand(config: AppConfig, logger: Logger): Promise<SyncReport> {
  // allowSchemaUpgrade: sync's whole job is a wholesale rebuild, so it may
  // adopt an older on-disk schema version (syncIndex repopulates every row,
  // including the section_references edges) instead of refusing to open the
  // very file it exists to rebuild. Downgrades still fail inside open().
  const store = Store.open(config.indexPath, { allowSchemaUpgrade: true });
  try {
    return await syncWithGuidance({ ecfr: createEcfrApi(), store, logger }, logger);
  } finally {
    store.close();
  }
}
