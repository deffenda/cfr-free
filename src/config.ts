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
  /** Hours between background index refreshes while serving; 0 disables background refresh. */
  readonly refreshHours: number;
  /**
   * The enabled CFR titles, sorted ascending, deduplicated. Sync refreshes
   * these titles (38 first, then ascending); every read surface defaults to
   * Title 38. Parsed from `CFR_TITLES`; defaults to [38].
   */
  readonly titles: readonly number[];
  /** Bind address for the HTTP API. */
  readonly host: string;
  /** Bind port for the HTTP API. */
  readonly port: number;
  /**
   * Extra host names a loopback bind answers to, for a reverse proxy on this
   * machine that forwards the public `Host` (lower-case, no port).
   */
  readonly allowedHosts: readonly string[];
  /** Explicit opt-in required for non-loopback binds. */
  readonly allowRemote: boolean;
  /** Log verbosity (stderr only). */
  readonly logLevel: LogLevel;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

/** Whether a bind address is loopback: reachable only from this machine. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

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
  CFR_REFRESH_HOURS: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  CFR_HOST: z.string().min(1).optional(),
  CFR_PORT: z
    .string()
    .regex(/^\d{2,5}$/)
    .optional(),
  CFR_ALLOW_REMOTE: z.enum(['0', '1']).optional(),
  CFR_TITLES: z
    .string()
    .max(200)
    .refine((value) => value.split(',').every((entry) => /^\s*\d{0,2}\s*$/.test(entry)), {
      message: 'must be comma-separated CFR title numbers (1-50)',
    })
    .optional(),
  CFR_ALLOWED_HOSTS: z
    .string()
    .max(500)
    .refine((value) => hostNames(value).every((name) => /^[A-Za-z0-9.-]+$/.test(name)), {
      message: 'must be comma-separated host names',
    })
    .optional(),
  CFR_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

/**
 * The names in a comma-separated list, blanks dropped. An empty value, a
 * trailing comma or a space after a comma (`CFR_ALLOWED_HOSTS=` from a
 * compose file's `${X:-}`) means "no name there", not a startup failure.
 */
function hostNames(list: string): string[] {
  return list
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/**
 * The titles in a comma-separated list: blanks dropped (a trailing comma or
 * `${X:-}` expansion means "no title there"), each parsed and bounds-checked
 * against the live eCFR's 1-50 range, deduplicated, sorted ascending. An
 * explicitly-set variable that names no valid title is a startup failure,
 * not a silent fallback to 38.
 */
function parseTitles(raw: string | undefined): readonly number[] {
  if (raw === undefined) return [38];
  const titles = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const title = Number.parseInt(entry, 10);
      if (title < 1 || title > 50) {
        throw new ConfigError(
          `CFR_TITLES entries must be CFR title numbers between 1 and 50, got "${entry}"`,
        );
      }
      return title;
    });
  if (titles.length === 0) {
    throw new ConfigError('CFR_TITLES is set but names no titles');
  }
  return [...new Set(titles)].sort((a, b) => a - b);
}

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
    refreshHours: parseBoundedInt(e.CFR_REFRESH_HOURS, 0, 0, 168, 'CFR_REFRESH_HOURS'),
    titles: parseTitles(e.CFR_TITLES),
    host,
    port: parseBoundedInt(e.CFR_PORT, DEFAULT_PORT, 1, 65_535, 'CFR_PORT'),
    allowedHosts: hostNames(e.CFR_ALLOWED_HOSTS ?? '').map((name) => name.toLowerCase()),
    allowRemote,
    logLevel: e.CFR_LOG_LEVEL ?? 'info',
  };
}
