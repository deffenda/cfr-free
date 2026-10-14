import { existsSync, statSync } from 'node:fs';
import type { AppConfig } from '../config.js';
import { CommandError, EXIT } from '../exit-codes.js';
import type { Logger } from '../logger.js';
import { Store } from '../core/store.js';

export interface ExportReport {
  readonly path: string;
  readonly bytes: number;
}

/**
 * `cfr-free export <path>` — write a consistent snapshot of the local index.
 *
 * Uses SQLite `VACUUM INTO`, which includes WAL content, so the copy is a
 * point-in-time image safe to copy elsewhere. Never overwrites: the target
 * must not exist, and the source index must.
 *
 * @throws {CommandError} exit 3 when there is no index; exit 2 when the
 *   target already exists.
 */
export function runExportCommand(config: AppConfig, target: string, logger: Logger): ExportReport {
  if (!existsSync(config.indexPath)) {
    throw new CommandError(
      `no index at ${config.indexPath} — run \`cfr-free sync\` first`,
      EXIT.INDEX_UNAVAILABLE,
    );
  }
  if (existsSync(target)) {
    throw new CommandError(
      `refusing to overwrite existing file: ${target} — remove it first`,
      EXIT.USAGE,
    );
  }

  const store = Store.open(config.indexPath);
  try {
    store.backupTo(target);
  } finally {
    store.close();
  }
  const bytes = statSync(target).size;
  logger.info('index exported', { target, bytes });
  return { path: target, bytes };
}
