import type { Logger } from './logger.js';

/**
 * Idempotent shutdown handling shared by `serve` and `mcp`.
 *
 * Cleanup runs once; a second signal forces exit. SQLite writes are
 * transactional, so an interrupted sync rolls back on its own.
 */

export interface ShutdownIO {
  readonly exit: (code: number) => void;
  readonly logger: Logger;
}

export interface ShutdownController {
  /**
   * Invoke from `SIGINT`/`SIGTERM` handlers — or from an abort, which is
   * why the reason is a string and not a signal: the log line names WHY
   * the shutdown started, and "abort" is a reason a signal is not.
   */
  handle(reason: string): Promise<void>;
  readonly shuttingDown: boolean;
}

export function createShutdownController(
  cleanup: () => void | Promise<void>,
  io: ShutdownIO,
): ShutdownController {
  let started = false;

  return {
    get shuttingDown(): boolean {
      return started;
    },
    async handle(reason: string): Promise<void> {
      if (started) {
        io.logger.warn('second signal received, forcing exit', { reason });
        io.exit(1);
        return;
      }
      started = true;
      io.logger.info('shutting down', { reason });
      try {
        await cleanup();
        io.exit(0);
      } catch (error) {
        io.logger.error('shutdown failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        io.exit(1);
      }
    },
  };
}
