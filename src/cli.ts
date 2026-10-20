#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config.js';
import { runMcpCommand } from './commands/mcp.js';
import { runServeCommand } from './commands/serve.js';
import { runSyncCommand } from './commands/sync.js';
import { runExportCommand } from './commands/export.js';
import { formatIssueDiff, runDiffCommand } from './commands/diff.js';
import { CommandError, EXIT } from './exit-codes.js';
import { createLogger } from './logger.js';
import { VERSION } from './version.js';

/** CLI usage text. */
export const USAGE = `cfr-free ${VERSION} — self-hosted Title 38 CFR data service

Usage:
  cfr-free [mcp]          Start the MCP server on stdio (default)
  cfr-free sync           Rebuild the local index from eCFR
  cfr-free diff <from> [to]  Show provision changes between two eCFR issue dates
                             (to defaults to the index's issue date)
  cfr-free serve          Start the Titan HTTP API (default http://127.0.0.1:8787)
  cfr-free export <path>  Save a consistent snapshot of the local index
  cfr-free help           Show this help
  cfr-free version        Show the version

Environment:
  CFR_INDEX_PATH     SQLite index path      (default ~/.cfr-free/index.sqlite)
  CFR_MAX_AGE_DAYS   Staleness threshold    (default 7)
  CFR_AUTO_SYNC      Sync at startup: 1|0   (default 1)
  CFR_REFRESH_HOURS  Hours between background refreshes while serving (default 0 = off)
  CFR_HOST/CFR_PORT  HTTP bind              (default 127.0.0.1:8787)
  CFR_ALLOW_REMOTE   Permit non-loopback: 1 (no auth built in)
  CFR_LOG_LEVEL      debug|info|warn|error  (default info)

Exit codes:
  0 success   1 error   2 usage/config   3 index unavailable   4 port in use
`;

/** Raised for bad CLI usage (exit code 2). */
export class CliError extends CommandError {
  override readonly name = 'CliError';
  constructor(message: string) {
    super(message, EXIT.USAGE);
  }
}

export type Command = 'mcp' | 'sync' | 'diff' | 'serve' | 'export' | 'help' | 'version';

/** Parsed argv: `export` and `diff` carry their positional arguments. */
export type ParsedCommand =
  | { readonly command: 'export'; readonly exportPath: string }
  | { readonly command: 'diff'; readonly fromDate: string; readonly toDate?: string }
  | { readonly command: Exclude<Command, 'export' | 'diff'> };

/** Validate `export`'s required single target path. */
function parseExportTarget(rest: readonly string[]): ParsedCommand {
  const target = rest[0];
  if (rest.length !== 1 || target === undefined || target.startsWith('-')) {
    throw new CliError(
      'export requires exactly one target path (e.g. `cfr-free export ./backup.sqlite`)',
    );
  }
  return { command: 'export', exportPath: target };
}

/** Validate `diff`'s required from-date and optional to-date. */
function parseDiffArgs(rest: readonly string[]): ParsedCommand {
  const [from, to] = rest;
  if (
    rest.length < 1 ||
    rest.length > 2 ||
    from === undefined ||
    from.startsWith('-') ||
    (to !== undefined && to.startsWith('-'))
  ) {
    throw new CliError(
      'diff requires a from-date and an optional to-date (e.g. `cfr-free diff 2026-01-01 2026-06-01`)',
    );
  }
  return to === undefined
    ? { command: 'diff', fromDate: from }
    : { command: 'diff', fromDate: from, toDate: to };
}

/** Parse argv (without node/script) into a command. Default: `mcp`. */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  const [first, ...rest] = argv;
  if (first === undefined) return { command: 'mcp' };
  if (first === '-h' || first === '--help' || first === 'help') return { command: 'help' };
  if (first === '-v' || first === '--version' || first === 'version') return { command: 'version' };
  if (first === 'export') return parseExportTarget(rest);
  if (first === 'diff') return parseDiffArgs(rest);
  if (first === 'mcp' || first === 'sync' || first === 'serve') {
    if (rest.length > 0)
      throw new CliError(`unexpected arguments after '${first}': ${rest.join(' ')}`);
    return { command: first };
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
    const parsed = parseArgs(argv);
    const command = parsed.command;
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
      const { changed, added, removed } = report.changes;
      const changes =
        changed + added + removed > 0
          ? `${changed} changed, ${added} added, ${removed} removed`
          : 'no provision changes';
      io.out(
        `synced ${report.sections} sections + ${report.appendices} appendices ` +
          `(issue date ${report.issueDate}; ${changes}; ${report.durationMs} ms)\n`,
      );
      return 0;
    }
    if (command === 'export') {
      const report = runExportCommand(config, parsed.exportPath, logger);
      io.out(`exported ${report.bytes} bytes to ${report.path}\n`);
      return 0;
    }
    if (command === 'diff') {
      // A diff WITH results is a success: exit 0 regardless of size. Errors
      // (bad dates, missing index for the default `to`) surface as throws.
      const report = await runDiffCommand(config, logger, parsed.fromDate, parsed.toDate);
      io.out(formatIssueDiff(report));
      return 0;
    }
    if (command === 'serve') return await runServeCommand(config, logger);
    await runMcpCommand(config, logger);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`cfr-free: ${message}\n`);
    if (error instanceof CommandError) return error.exitCode;
    return error instanceof ConfigError ? EXIT.USAGE : EXIT.ERROR;
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
