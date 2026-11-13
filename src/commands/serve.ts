import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { CommandError, EXIT } from '../exit-codes.js';
import { CFRService } from '../core/service.js';
import { Store } from '../core/store.js';
import { createShutdownController } from '../process-utils.js';
import { createHttpServer, type DiskSnapshot } from '../titan/http-server.js';
import { syncIndex } from '../core/sync.js';
import { ensureIndex, createEcfrApi } from './ensure-index.js';
import { startRefreshScheduler } from './refresh-scheduler.js';

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
    // ONE eCFR client serves the whole process — the startup sync, the
    // diff facade, /api/v1/diff and the background refresh scheduler all
    // use it — so the document memo and the upstream-fetch semaphore bound
    // THIS process, not each caller separately. The diff facade and
    // /api/v1/diff need a live client; it is the same one.
    const ecfr = createEcfrApi();
    const freshness = await ensureIndex(store, config, logger, { createEcfr: () => ecfr });
    const service = new CFRService(store, config.maxAgeDays, ecfr, logger);

    // Disk capacity for /health and /metrics (SPEC §13 #22): probed once at
    // boot and re-probed after every refresh attempt — success or failure,
    // because the capacity signal must not depend on sync health. The HTTP
    // layer reads this cell per request through an accessor, so it never
    // serves a value older than the last probe. A failed probe keeps the
    // last known snapshot (null only if none was ever captured): an honest
    // stale reading beats an erased one.
    let diskSnapshot: DiskSnapshot | null = null;
    const probeDisk = async (): Promise<void> => {
      try {
        const stats = await fs.statfs(path.dirname(config.indexPath));
        diskSnapshot = {
          freeBytes: stats.bavail * stats.bsize,
          totalBytes: stats.blocks * stats.bsize,
        };
      } catch {
        // Keep whatever was last captured — see the note above.
      }
    };
    await probeDisk();

    const server = createHttpServer(service, logger, {
      // A per-peer budget only for deliberately exposed deployments: the
      // unauthenticated API needs a coarse DoS guard when it leaves
      // loopback, while local tooling must never throttle itself.
      ...(config.allowRemote ? { rateLimit: { capacity: 60, refillPerSec: 10 } } : {}),
      disk: () => diskSnapshot,
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

    // Opt-in background refresh (CFR_REFRESH_HOURS): armed only after a
    // successful bind, so a failed listen exits with no timer left behind.
    const scheduler =
      config.refreshHours > 0
        ? startRefreshScheduler({
            refreshHours: config.refreshHours,
            logger,
            refresh: async () => {
              try {
                await syncIndex({ ecfr, store, logger });
              } finally {
                // Re-stat the volume regardless of the sync outcome: capacity
                // visibility must not hinge on sync success. probeDisk never
                // rejects, so the original sync error still propagates.
                await probeDisk();
              }
            },
          })
        : null;
    scheduler?.schedule();

    return await new Promise<number>((resolve) => {
      const shutdown = createShutdownController(
        () =>
          new Promise<void>((done) => {
            scheduler?.dispose();
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
