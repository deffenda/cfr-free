#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config.js';
import { runMcpCommand } from './commands/mcp.js';
import { runServeCommand } from './commands/serve.js';
import { runSyncCommand } from './commands/sync.js';
import { createLogger } from './logger.js';
import { VERSION } from './version.js';

/** CLI usage text. */
export const USAGE = `cfr-free ${VERSION} — self-hosted Title 38 CFR data service

Usage:
  cfr-free [mcp]        Start the MCP server on stdio (default)
  cfr-free sync         Rebuild the local index from eCFR
  cfr-free serve        Start the Titan HTTP API (default http://127.0.0.1:8787)
  cfr-free help         Show this help
  cfr-free version      Show the version

Environment:
  CFR_INDEX_PATH     SQLite index path      (default ~/.cfr-free/index.sqlite)
  CFR_MAX_AGE_DAYS   Staleness threshold    (default 7)
  CFR_AUTO_SYNC      Sync at startup: 1|0   (default 1)
  CFR_HOST/CFR_PORT  HTTP bind              (default 127.0.0.1:8787)
  CFR_ALLOW_REMOTE   Permit non-loopback: 1 (no auth built in)
  CFR_LOG_LEVEL      debug|info|warn|error  (default info)
`;

/** Raised for bad CLI usage (exit code 2). */
export class CliError extends Error {
  override readonly name = 'CliError';
}

export type Command = 'mcp' | 'sync' | 'serve' | 'help' | 'version';

/** Parse argv (without node/script) into a command. Default: `mcp`. */
export function parseArgs(argv: readonly string[]): Command {
  const [first, ...rest] = argv;
  if (first === undefined) return 'mcp';
  if (first === '-h' || first === '--help' || first === 'help') return 'help';
  if (first === '-v' || first === '--version' || first === 'version') return 'version';
  if (first === 'mcp' || first === 'sync' || first === 'serve') {
    if (rest.length > 0)
      throw new CliError(`unexpected arguments after '${first}': ${rest.join(' ')}`);
    return first;
  }
  if (first.startsWith('-')) throw new CliError(`unknown option: ${first} (try --help)`);
  throw new CliError(`unknown command: ${first} (try --help)`);
}

export interface MainIO {
  out(chunk: string): void;
  err(chunk: string): void;
  env: NodeJS.ProcessEnv;
}

/** CLI entry point. Returns the process exit code. */
export async function main(argv: readonly string[], io: MainIO): Promise<number> {
  try {
    const command = parseArgs(argv);
    if (command === 'help') {
      io.out(USAGE);
      return 0;
    }
    if (command === 'version') {
      io.out(`${VERSION}\n`);
      return 0;
    }

    const config = loadConfig(io.env);
    const logger = createLogger(config.logLevel);

    if (command === 'sync') {
      const report = await runSyncCommand(config, logger);
      io.out(
        `synced ${report.sections} sections + ${report.appendices} appendices ` +
          `(issue date ${report.issueDate}, ${report.durationMs} ms)\n`,
      );
      return 0;
    }
    if (command === 'serve') return await runServeCommand(config, logger);
    await runMcpCommand(config, logger);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`cfr-free: ${message}\n`);
    return error instanceof ConfigError || error instanceof CliError ? 2 : 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const io: MainIO = {
    out: (chunk) => void process.stdout.write(chunk),
    err: (chunk) => void process.stderr.write(chunk),
    env: process.env,
  };
  main(process.argv.slice(2), io).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `cfr-free: fatal: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
