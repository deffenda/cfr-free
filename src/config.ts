import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { LogLevel } from './logger.js';

/** Raised when the process environment fails validation. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Runtime configuration, validated from environment variables. */
export interface AppConfig {
  /** Absolute path of the SQLite index. */
  readonly indexPath: string;
  /** Index older than this many days is considered stale. */
  readonly maxAgeDays: number;
  /** Sync automatically at startup when the index is missing or stale. */
  readonly autoSync: boolean;
  /** Bind address for the HTTP API. */
  readonly host: string;
  /** Bind port for the HTTP API. */
  readonly port: number;
  /** Explicit opt-in required for non-loopback binds. */
  readonly allowRemote: boolean;
  /** Log verbosity (stderr only). */
  readonly logLevel: LogLevel;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);
const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_PORT = 8787;

/** String-only schema; numeric fields are converted and bounds-checked below. */
const envSchema = z.object({
  CFR_INDEX_PATH: z.string().min(1).optional(),
  CFR_MAX_AGE_DAYS: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  CFR_AUTO_SYNC: z.enum(['0', '1']).optional(),
  CFR_HOST: z.string().min(1).optional(),
  CFR_PORT: z
    .string()
    .regex(/^\d{2,5}$/)
    .optional(),
  CFR_ALLOW_REMOTE: z.enum(['0', '1']).optional(),
  CFR_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}, got ${raw}`);
  }
  return value;
}

/**
 * Load and validate configuration from environment variables.
 *
 * Non-loopback binds are rejected unless `CFR_ALLOW_REMOTE=1`: the HTTP API
 * intentionally ships without authentication.
 *
 * @throws {ConfigError} when any value is invalid or unsafe.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`,
    );
    throw new ConfigError(`invalid environment configuration: ${details.join('; ')}`);
  }
  const e = parsed.data;
  const host = e.CFR_HOST ?? '127.0.0.1';
  const allowRemote = e.CFR_ALLOW_REMOTE === '1';
  if (!LOOPBACK_HOSTS.has(host) && !allowRemote) {
    throw new ConfigError(
      `CFR_HOST=${host} is not loopback; set CFR_ALLOW_REMOTE=1 to expose the unauthenticated HTTP API`,
    );
  }
  return {
    indexPath: e.CFR_INDEX_PATH ?? path.join(os.homedir(), '.cfr-free', 'index.sqlite'),
    maxAgeDays: parseBoundedInt(
      e.CFR_MAX_AGE_DAYS,
      DEFAULT_MAX_AGE_DAYS,
      0,
      365,
      'CFR_MAX_AGE_DAYS',
    ),
    autoSync: e.CFR_AUTO_SYNC !== '0',
    host,
    port: parseBoundedInt(e.CFR_PORT, DEFAULT_PORT, 1, 65_535, 'CFR_PORT'),
    allowRemote,
    logLevel: e.CFR_LOG_LEVEL ?? 'info',
  };
}
