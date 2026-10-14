import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { CommandError, EXIT } from '../exit-codes.js';
import { CFRService } from '../core/service.js';
import { Store } from '../core/store.js';
import { createShutdownController } from '../process-utils.js';
import { createHttpServer } from '../titan/http-server.js';
import { ensureIndex } from './ensure-index.js';

function listenErrorMessage(error: unknown, config: AppConfig): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'EADDRINUSE') return `port ${config.port} is already in use`;
  if (code === 'EACCES') return `permission denied for ${config.host}:${config.port}`;
  return error instanceof Error ? error.message : String(error);
}

/** Bind failures are environment issues: exit 4 so scripts can react. */
function listenExitCode(error: unknown): number {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return code === 'EADDRINUSE' || code === 'EACCES' ? EXIT.ADDRESS_IN_USE : EXIT.ERROR;
}

/**
 * `cfr-free serve` — run the Titan HTTP API until SIGINT/SIGTERM.
 *
 * @returns the process exit code to use after shutdown completes.
 */
export async function runServeCommand(config: AppConfig, logger: Logger): Promise<number> {
  const store = Store.open(config.indexPath);
  try {
    const freshness = await ensureIndex(store, config, logger);
    const service = new CFRService(store, config.maxAgeDays);
    const server = createHttpServer(service, logger, {
      // A per-peer budget only for deliberately exposed deployments: the
      // unauthenticated API needs a coarse DoS guard when it leaves
      // loopback, while local tooling must never throttle itself.
      ...(config.allowRemote ? { rateLimit: { capacity: 60, refillPerSec: 10 } } : {}),
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', (error) =>
        reject(new CommandError(listenErrorMessage(error, config), listenExitCode(error))),
      );
      server.listen(config.port, config.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    logger.info('http api listening', { url: `http://${config.host}:${config.port}`, freshness });

    return await new Promise<number>((resolve) => {
      const shutdown = createShutdownController(
        () =>
          new Promise<void>((done) => {
            server.close(() => {
              store.close();
              done();
            });
            server.closeAllConnections();
          }),
        { exit: (code) => resolve(code), logger },
      );
      process.once('SIGINT', () => void shutdown.handle('SIGINT'));
      process.once('SIGTERM', () => void shutdown.handle('SIGTERM'));
    });
  } catch (error) {
    store.close();
    throw error;
  }
}
