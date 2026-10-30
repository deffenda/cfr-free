#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config.js';
import { runMcpCommand } from './commands/mcp.js';
import { runServeCommand } from './commands/serve.js';
import { runSyncCommand } from './commands/sync.js';
import { runExportCommand } from './commands/export.js';
import { formatIssueDiff, runDiffCommand } from './commands/diff.js';
import { formatSectionRedline, runRedlineCommand } from './commands/redline.js';
import { formatHistoricalSection, runHistoricalCommand } from './commands/historical.js';
import { formatSearchResults, runSearchCommand } from './commands/search.js';
import { upstreamFailure } from './commands/upstream-guidance.js';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_QUERY_MIN_LENGTH, ServiceError } from './core/service.js';
import { CommandError, EXIT } from './exit-codes.js';
import { createLogger, type Logger } from './logger.js';
import { VERSION } from './version.js';

/** CLI usage text. */
export const USAGE = `cfr-free ${VERSION} — self-hosted Title 38 CFR data service

Usage:
  cfr-free [mcp]          Start the MCP server on stdio (default)
  cfr-free sync           Rebuild the local index from eCFR
  cfr-free diff <from> [to]  Show provision changes between two eCFR issue dates
                             (to defaults to the index's issue date)
  cfr-free redline <from> <to> <citation>  Line-level redline of one provision between
                                           two eCFR issue dates
  cfr-free historical <at> <citation>  One provision as it stood at a date (eCFR's
                                     point-in-time archive, 2017 onward)
  cfr-free search <query>  Ranked provisions from the local index (top 10)
  cfr-free serve          Start the Titan HTTP API (default http://127.0.0.1:8787)
  cfr-free export <path> [jsonl|md]  Snapshot the index (sqlite default;
                                     jsonl/md for pipeline ingestion)
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
  0 success   1 error   2 usage/config   3 index unavailable   4 port in use   5 export refused
`;

/**
 * The sections of the usage text: a heading and the lines under it.
 *
 * The usage text is one block, and the per-command help is DERIVED from it
 * rather than written out a second time — so the two can never disagree
 * about a synopsis, and a change to the block reaches every command's help.
 */
function usageSections(): readonly {
  readonly heading: string;
  readonly lines: readonly string[];
}[] {
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of USAGE.split('\n')) {
    if (line !== '' && !line.startsWith(' ')) {
      current = { heading: line, lines: [] };
      sections.push(current);
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  return sections;
}

/**
 * The usage entry for one command: its line, and the continuation lines
 * that belong to it (they are indented deeper than the entry itself).
 */
function usageEntry(lines: readonly string[], wanted: string): readonly string[] {
  const entry: string[] = [];
  let collecting = false;
  for (const line of lines) {
    if (line.trim() === '') break;
    if (line.startsWith(`  ${wanted}`)) {
      collecting = true;
      entry.push(line);
      continue;
    }
    if (!collecting) continue;
    if (!line.startsWith('   ')) break;
    entry.push(line);
  }
  return entry;
}

/**
 * The usage text for one command: its own entry, plus the sections every
 * command shares (the environment variables and the exit codes).
 *
 * `cfr-free search --help` used to be an error ("unknown option for
 * search: --help"): the only usage text was the global block, so the one
 * thing a user asks for when they have got a command wrong was the one
 * thing the tool refused to say.
 */
export function commandUsage(command: string): string {
  const wanted = command === 'mcp' ? 'cfr-free [mcp]' : `cfr-free ${command}`;
  const picked: string[] = [];
  for (const section of usageSections()) {
    if (section.heading === 'Usage:') {
      const entry = usageEntry(section.lines, wanted);
      if (entry.length > 0) picked.push('Usage:', ...entry);
      continue;
    }
    if (section.heading === 'Environment:' || section.heading === 'Exit codes:') {
      picked.push('', section.heading, ...section.lines.filter((line) => line.trim() !== ''));
    }
  }
  return `${picked.join('\n')}\n`;
}

/** `--help` or `-h` among the arguments: the user is asking about the command. */
function asksForHelp(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--help' || arg === '-h');
}

/** The commands that have their own usage text. */
const KNOWN_COMMANDS = new Set([
  'mcp',
  'sync',
  'diff',
  'redline',
  'historical',
  'search',
  'serve',
  'export',
  'help',
  'version',
]);

/** Raised for bad CLI usage (exit code 2). */
export class CliError extends CommandError {
  override readonly name = 'CliError';
  constructor(message: string) {
    super(message, EXIT.USAGE);
  }
}

export type Command =
  | 'mcp'
  | 'sync'
  | 'diff'
  | 'redline'
  | 'historical'
  | 'search'
  | 'serve'
  | 'export'
  | 'help'
  | 'version';

/** Parsed argv: `export`, `diff` and `redline` carry their positional arguments. */
export type ParsedCommand =
  | {
      readonly command: 'export';
      readonly exportPath: string;
      readonly exportFormat?: 'jsonl' | 'md';
    }
  | { readonly command: 'diff'; readonly fromDate: string; readonly toDate?: string }
  | { readonly command: 'historical'; readonly atDate: string; readonly citation: string }
  | {
      readonly command: 'redline';
      readonly fromDate: string;
      readonly toDate: string;
      readonly citation: string;
    }
  | { readonly command: 'search'; readonly query: string }
  | { readonly command: 'help'; readonly topic?: string }
  | {
      readonly command: Exclude<
        Command,
        'export' | 'diff' | 'redline' | 'historical' | 'search' | 'help'
      >;
    };

/** Validate `export`'s required target path and optional output format. */
function parseExportTarget(rest: readonly string[]): ParsedCommand {
  const target = rest[0];
  const format = rest[1];
  if (rest.length < 1 || rest.length > 2 || target === undefined || target.startsWith('-')) {
    throw new CliError(
      'export requires exactly one target path (e.g. `cfr-free export ./backup.sqlite`)',
    );
  }
  if (format !== undefined && format !== 'jsonl' && format !== 'md') {
    throw new CliError(
      'export format must be `jsonl` or `md` (e.g. `cfr-free export ./backup.sqlite jsonl`)',
    );
  }
  return format === undefined
    ? { command: 'export', exportPath: target }
    : { command: 'export', exportPath: target, exportFormat: format };
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

/** Parse `redline`'s three required positionals: from-date, to-date, citation. */
function parseRedlineArgs(rest: readonly string[]): ParsedCommand {
  const [from, to, citation] = rest;
  if (
    rest.length !== 3 ||
    from === undefined ||
    to === undefined ||
    citation === undefined ||
    from.startsWith('-') ||
    to.startsWith('-') ||
    citation.startsWith('-')
  ) {
    throw new CliError(
      'redline requires a from-date, a to-date and a citation ' +
        '(usage: `cfr-free redline <from> <to> <citation>`)',
    );
  }
  return { command: 'redline', fromDate: from, toDate: to, citation };
}

/**
 * `historical <at> <citation>` — exactly two positionals; a dash-prefixed
 * or wrong-arity invocation is a usage error.
 */
function parseHistoricalArgs(rest: readonly string[]): ParsedCommand {
  const [atDate, citation] = rest;
  if (
    rest.length !== 2 ||
    atDate === undefined ||
    citation === undefined ||
    atDate.startsWith('-') ||
    citation.startsWith('-')
  ) {
    throw new CliError(
      'historical requires a date and a citation (e.g. `cfr-free historical <at> <citation>`)',
    );
  }
  return { command: 'historical', atDate, citation };
}

/**
 * `search <query…>` — the words are the query; a dash-prefixed word is
 * refused.
 *
 * The query is checked HERE, before the index is opened. The service
 * enforces the same rule, but it runs after `ensureIndex`, which may pull
 * a 2-3 MB sync — a rejected query must not cost the user a download.
 */
function parseSearchArgs(rest: readonly string[]): ParsedCommand {
  const dashed = rest.find((arg) => arg.startsWith('-'));
  if (dashed !== undefined) throw new CliError(`unknown option for search: ${dashed}`);
  const query = rest.join(' ').trim();
  if (query.length === 0)
    throw new CliError('search requires a query (e.g. `cfr-free search PTSD`)');
  if (query.length < SEARCH_QUERY_MIN_LENGTH)
    throw new CliError(
      `the search query needs at least ${SEARCH_QUERY_MIN_LENGTH} characters ` +
        '(e.g. `cfr-free search PTSD`)',
    );
  if (query.length > SEARCH_QUERY_MAX_LENGTH)
    throw new CliError(`the search query may be at most ${SEARCH_QUERY_MAX_LENGTH} characters`);
  return { command: 'search', query };
}

/**
 * The words and flags that select a command on their own.
 *
 * A Map, not a plain object: `parseArgs(['toString'])` must still fall
 * through to "unknown command" — object literals inherit prototype keys,
 * Maps don't.
 */
const GLOBAL_COMMANDS = new Map<string, ParsedCommand>([
  ['help', { command: 'help' }],
  ['-h', { command: 'help' }],
  ['--help', { command: 'help' }],
  ['version', { command: 'version' }],
  ['-v', { command: 'version' }],
  ['--version', { command: 'version' }],
]);

/**
 * Commands that carry positional arguments, mapped to their parser. A Map
 * (not a plain object): `parseArgs(['toString'])` must still fall through to
 * "unknown command" — object literals inherit prototype keys, Maps don't.
 */
const ARG_PARSERS = new Map<string, (rest: readonly string[]) => ParsedCommand>([
  ['export', parseExportTarget],
  ['diff', parseDiffArgs],
  ['redline', parseRedlineArgs],
  ['historical', parseHistoricalArgs],
  ['search', parseSearchArgs],
]);

/** Parse argv (without node/script) into a command. Default: `mcp`. */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  const [first, ...rest] = argv;
  if (first === undefined) return { command: 'mcp' };
  const global = GLOBAL_COMMANDS.get(first);
  if (global !== undefined) return { ...global };
  // A help flag among the arguments is a request for the command's usage,
  // and it is answered BEFORE the command's own parser: a command that
  // takes arguments used to refuse to explain itself ("unknown option for
  // search: --help"), which is the one thing a user asks for when they have
  // got a command wrong.
  if (asksForHelp(rest) && KNOWN_COMMANDS.has(first)) return { command: 'help', topic: first };
  const parseArgv = ARG_PARSERS.get(first);
  if (parseArgv !== undefined) return parseArgv(rest);
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
  /**
   * Where the structured log goes.
   *
   * Defaults to stderr (the CLI's own log sink). Tests inject a capture so
   * they can assert that a failure's developer-facing detail reaches the
   * log without letting it near the user's line.
   */
  logger?: Logger;
  /**
   * Stops a long-running command. `serve` waits for a process signal by
   * default; a caller that is not a process (a test, an embedder) aborts
   * this instead.
   */
  stop?: AbortSignal;
}

/** Commands that read one provision across eCFR revisions (`historical`, `redline`). */
const PROVISION_READ_COMMANDS: ReadonlySet<Command> = new Set<Command>(['historical', 'redline']);

async function runProvisionRead(
  parsed: ParsedCommand,
  logger: Logger,
  io: MainIO,
): Promise<number> {
  if (parsed.command === 'historical') {
    // A historical read that succeeds is a success (exit 0) whatever the
    // text says; a bad date, an unknown citation or a date outside
    // eCFR's archive surfaces as a throw.
    const section = await runHistoricalCommand(logger, parsed.atDate, parsed.citation);
    io.out(formatHistoricalSection(section));
    return 0;
  }
  if (parsed.command === 'redline') {
    // A redline WITH changes is a success: exit 0 regardless of content
    // (same policy as `diff`). Validation/lookup errors surface as throws.
    const report = await runRedlineCommand(logger, parsed.fromDate, parsed.toDate, parsed.citation);
    io.out(formatSectionRedline(report));
    return 0;
  }
  return EXIT.ERROR;
}

/**
 * What a failure says to the user.
 *
 * An upstream failure is rewritten: the raw message names the endpoint
 * that failed, which no user action depends on, and the advice names the
 * thing the user can fix. The detail stays in the structured log.
 *
 * The advice is status-aware: eCFR answering at all means the request got
 * through, so a status-bearing failure is never blamed on the reader's
 * network.
 */
export function failureMessage(error: unknown): string {
  const failure = upstreamFailure(error);
  if (failure !== null) {
    return failure.advice === '' ? failure.reason : `${failure.reason} — ${failure.advice}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The exit code a failure maps to.
 *
 * An invalid input is a usage mistake, not a service failure. The README's
 * exit-code table gives code 2 to usage errors, and a script that retries
 * on 1 would otherwise retry a typo forever.
 */
function exitCodeFor(error: unknown): number {
  if (error instanceof CommandError) return error.exitCode;
  if (error instanceof ServiceError && error.code === 'invalid_input') return EXIT.USAGE;
  return error instanceof ConfigError ? EXIT.USAGE : EXIT.ERROR;
}

/** CLI entry point. Returns the process exit code. */
export async function main(argv: readonly string[], io: MainIO): Promise<number> {
  // The logger is created from the config, which is loaded inside the try: a
  // config error must still reach the catch with its own exit code. The
  // handle is hoisted so the catch can record an upstream failure's detail.
  let logger = io.logger;
  try {
    const parsed = parseArgs(argv);
    const command = parsed.command;
    if (command === 'help') {
      io.out(parsed.topic === undefined ? USAGE : commandUsage(parsed.topic));
      return 0;
    }
    if (command === 'version') {
      io.out(`${VERSION}\n`);
      return 0;
    }

    const config = loadConfig(io.env);
    logger ??= createLogger(config.logLevel);

    if (command === 'sync') {
      const report = await runSyncCommand(config, logger);
      const { changed, added, removed } = report.changes;
      const changes =
        changed + added + removed > 0
          ? `${changed} changed, ${added} added, ${removed} removed`
          : 'no provision changes';
      // Provisions with eCFR graphics (the rating tables) are NOT textually
      // complete — the count is stated so a matching section count never
      // reads as complete coverage (review finding P1-01).
      const images =
        report.imageContentSections > 0
          ? `; ${report.imageContentSections} provisions contain image content not included`
          : '';
      io.out(
        `synced ${report.sections} sections + ${report.appendices} appendices ` +
          `(issue date ${report.issueDate}; ${changes}${images}; ${report.durationMs} ms; ` +
          `corpus hash ${report.corpusHash})\n`,
      );
      return 0;
    }
    if (command === 'export') {
      const report = runExportCommand(config, parsed.exportPath, logger, parsed.exportFormat);
      io.out(
        `exported ${report.provisions} provisions as ${report.format} ` +
          `(${report.bytes} bytes) to ${report.path}\n`,
      );
      return 0;
    }
    if (command === 'diff') {
      // A diff WITH results is a success: exit 0 regardless of size. Errors
      // (bad dates, missing index for the default `to`) surface as throws.
      const report = await runDiffCommand(config, logger, parsed.fromDate, parsed.toDate);
      io.out(formatIssueDiff(report));
      return 0;
    }
    if (command === 'search') {
      const result = await runSearchCommand(config, logger, parsed.query);
      io.out(formatSearchResults(result));
      return 0;
    }
    if (PROVISION_READ_COMMANDS.has(command)) {
      return await runProvisionRead(parsed, logger, io);
    }
    if (command === 'serve') {
      // The URL in plain language: the structured log carries it too, but a
      // log line is not what a human reads to find out where the server is.
      return await runServeCommand(config, logger, {
        onListening: (url) => io.out(`Serving on ${url}\n`),
        ...(io.stop === undefined ? {} : { stop: io.stop }),
      });
    }
    await runMcpCommand(config, logger);
    return 0;
  } catch (error) {
    return reportFailure(error, logger, io);
  }
}

/**
 * Report a failure: to the reader, to the log, and as an exit code.
 *
 * An upstream failure carries the endpoint and the status: both are
 * developer-facing, so neither belongs on the reader's line, but neither may
 * vanish either — the structured log is where they belong. Without that
 * record the raw detail the reader used to see is simply gone.
 */
function reportFailure(error: unknown, logger: Logger | undefined, io: MainIO): number {
  const failure = upstreamFailure(error);
  if (failure !== null) {
    (logger ?? createLogger('error')).error('eCFR request failed', {
      url: failure.url,
      status: failure.status ?? null,
      kind: failure.kind,
      message: failure.detail,
    });
  }
  io.err(`cfr-free: ${failureMessage(error)}\n`);
  return exitCodeFor(error);
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
