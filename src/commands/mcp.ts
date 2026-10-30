import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { CFRService } from '../core/service.js';
import { Store } from '../core/store.js';
import { syncIndex } from '../core/sync.js';
import { createShutdownController } from '../process-utils.js';
import { buildMcpServer } from '../mcp/server.js';
import { ensureIndex, createEcfrApi } from './ensure-index.js';
import { startRefreshScheduler, type RefreshScheduler } from './refresh-scheduler.js';

/**
 * `cfr-free mcp` — serve MCP over stdio.
 *
 * stdout carries JSON-RPC only; all logs go to stderr. The process stays
 * alive on the stdin handle and shuts down cleanly on SIGINT/SIGTERM.
 */
export async function runMcpCommand(config: AppConfig, logger: Logger): Promise<void> {
  const store = Store.open(config.indexPath);
  let closed = false;
  const closeStore = (): void => {
    if (!closed) {
      closed = true;
      store.close();
    }
  };
  let scheduler: RefreshScheduler | null = null;

  try {
    const freshness = await ensureIndex(store, config, logger);
    // One eCFR client — with its own per-process document memo — serves
    // both the diff tool registration and the service's diff facade
    // (batch-7 D2); createEcfrApi() was already imported here for the
    // refresh scheduler.
    const ecfr = createEcfrApi();
    const service = new CFRService(store, config.maxAgeDays, ecfr, logger);
    const server = buildMcpServer(service, logger, { ecfr });

    // Opt-in background refresh (CFR_REFRESH_HOURS); disposed on every
    // shutdown path below so no timer outlives the process lifecycle.
    if (config.refreshHours > 0) {
      scheduler = startRefreshScheduler({
        refreshHours: config.refreshHours,
        logger,
        refresh: async () => {
          await syncIndex({ ecfr: createEcfrApi(), store, logger });
        },
      });
      scheduler.schedule();
    }

    const shutdown = createShutdownController(
      async () => {
        scheduler?.dispose();
        await server.close();
        closeStore();
      },
      { exit: (code) => process.exit(code), logger },
    );
    process.once('SIGINT', () => void shutdown.handle('SIGINT'));
    process.once('SIGTERM', () => void shutdown.handle('SIGTERM'));
    process.once('exit', closeStore);

    await server.connect(new StdioServerTransport());
    logger.info('mcp server ready', { index: config.indexPath, freshness });
  } catch (error) {
    scheduler?.dispose();
    closeStore();
    throw error;
  }
}
