import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { CFRService } from '../core/service.js';
import { Store } from '../core/store.js';
import { createShutdownController } from '../process-utils.js';
import { buildMcpServer } from '../mcp/server.js';
import { ensureIndex } from './ensure-index.js';

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

  try {
    const freshness = await ensureIndex(store, config, logger);
    const service = new CFRService(store, config.maxAgeDays);
    const server = buildMcpServer(service, logger);

    const shutdown = createShutdownController(
      async () => {
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
    closeStore();
    throw error;
  }
}
