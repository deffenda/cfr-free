#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config.js';
import { runMcpCommand } from './commands/mcp.js';
import { runMcpInstallCommand } from './commands/mcp-install.js';
import { runServeCommand } from './commands/serve.js';
import { runSyncCommand } from './commands/sync.js';
import { runExportCommand } from './commands/export.js';
import { formatIssueDiff, runDiffCommand } from './commands/diff.js';
import { formatSectionRedline, runRedlineCommand } from './commands/redline.js';
import { formatHistoricalSection, runHistoricalCommand } from './commands/historical.js';
import { generateVibePrompt, generateVibeRules } from './commands/vibe.js';
import { runVibeUiCommand } from './commands/vibe-ui.js';
import { calculateCombinedRating, formatCombineResult } from './core/va-math.js';
import {
  formatSearchResults,
  formatSearchResultsJson,
  runSearchCommand,
} from './commands/search.js';
import { upstreamFailure } from './commands/upstream-guidance.js';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  validateSearchInput,
} from './core/service.js';
import { ServiceError } from './core/errors.js';
import { CommandError, EXIT } from './exit-codes.js';
import { createLogger, type Logger } from './logger.js';
import { VERSION } from './version.js';

/** CLI usage text. */
export const USAGE = `cfr-free ${VERSION} — self-hosted Title 38 CFR data service

Usage:
  cfr-free [mcp]          Start the MCP server on stdio (default)
  cfr-free mcp install    Configure MCP server in Cursor, Claude Desktop, Windsurf or VS Code
                            Options: --client <cursor|claude|windsurf|vscode|all>, --workspace, --print
  cfr-free vibe <subcommand> Developer & agent tooling suite (rules, prompt, ui, combine, playground)
                            Subcommands:
                              rules [--format cursor|claude|markdown] [--write]
                              prompt <adjudicator|researcher|ratings>
                              ui <rating-card|search-bar|citation-badge|evaluator> [--framework react|html] [--write] [--list]
                              combine <ratings...> (38 C.F.R. § 4.25 VA math)
                              playground (launch instant visual developer sandbox)
  cfr-free sync           Rebuild the local index from eCFR
  cfr-free diff <from> [to]  Show provision changes between two eCFR issue dates
                             (to defaults to the index's issue date)
  cfr-free redline <from> <to> <citation>  Line-level redline of one provision between
                                           two eCFR issue dates
  cfr-free historical <at> <citation>  One provision as it stood at a date (eCFR's
                                     point-in-time archive, 2017 onward)
  cfr-free search <query>  Ranked provisions from the local index
                             Options: --json, --page N, --per-page N,
                             --part P, --kind section|appendix, --chapter C, --demo, --semantic
  cfr-free serve          Start the Titan HTTP API (default http://127.0.0.1:8787; --demo for sample data)
  cfr-free demo           Instant offline demo server with core rating schedules
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
  'mcp-install',
  'vibe',
  'demo',
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
  | 'mcp-install'
  | 'vibe-rules'
  | 'vibe-prompt'
  | 'vibe-ui'
  | 'vibe-combine'
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
      readonly command: 'mcp-install';
      readonly client?: string | undefined;
      readonly workspace?: boolean | undefined;
      readonly print?: boolean | undefined;
    }
  | {
      readonly command: 'vibe-rules';
      readonly format?: 'cursor' | 'claude' | 'markdown' | undefined;
      readonly write?: boolean | undefined;
    }
  | {
      readonly command: 'vibe-prompt';
      readonly preset: 'adjudicator' | 'researcher' | 'ratings';
    }
  | {
      readonly command: 'vibe-ui';
      readonly component?: string | undefined;
      readonly framework?: 'react' | 'html' | undefined;
      readonly write?: string | undefined;
      readonly list?: boolean | undefined;
    }
  | {
      readonly command: 'vibe-combine';
      readonly ratings: readonly number[];
    }
  | {
      readonly command: 'serve';
      readonly demo?: boolean | undefined;
    }
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
  | {
      readonly command: 'search';
      readonly query: string;
      /** Emit the response as JSON, for a script to read. */
      readonly json: boolean;
      readonly page?: number | undefined;
      readonly perPage?: number | undefined;
      readonly part?: string | undefined;
      readonly kind?: 'section' | 'appendix' | undefined;
      readonly chapter?: string | undefined;
      readonly demo?: boolean | undefined;
      readonly semantic?: boolean | undefined;
    }
  | { readonly command: 'help'; readonly topic?: string }
  | {
      readonly command: Exclude<
        Command,
        | 'export'
        | 'diff'
        | 'redline'
        | 'historical'
        | 'search'
        | 'help'
        | 'mcp-install'
        | 'vibe-rules'
        | 'vibe-prompt'
        | 'vibe-ui'
        | 'vibe-combine'
        | 'serve'
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

/** Parse `mcp install` arguments. */
function parseMcpInstallArgs(rest: readonly string[]): ParsedCommand {
  let client: string | undefined;
  let workspace: boolean | undefined;
  let print = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (arg === '--print') {
      print = true;
    } else if (arg === '--workspace') {
      workspace = true;
    } else if (arg.startsWith('--client=')) {
      const val = arg.slice(9).toLowerCase();
      const allowed = ['cursor', 'claude', 'windsurf', 'vscode', 'all'];
      if (!allowed.includes(val)) {
        throw new CliError(`client must be one of: ${allowed.join(', ')}`);
      }
      client = val;
    } else if (arg === '--client') {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new CliError(
          '--client requires a client name (e.g. cursor, claude, windsurf, vscode, all)',
        );
      }
      const val = next.toLowerCase();
      const allowed = ['cursor', 'claude', 'windsurf', 'vscode', 'all'];
      if (!allowed.includes(val)) {
        throw new CliError(`client must be one of: ${allowed.join(', ')}`);
      }
      client = val;
      i += 1;
    } else {
      throw new CliError(`unknown option for mcp install: ${arg}`);
    }
  }
  return { command: 'mcp-install', client, workspace, print };
}

function parseVibeRulesArgs(args: readonly string[]): ParsedCommand {
  let format: 'cursor' | 'claude' | 'markdown' | undefined;
  let write = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--write') {
      write = true;
    } else if (arg.startsWith('--format=')) {
      const val = arg.slice(9);
      if (val !== 'cursor' && val !== 'claude' && val !== 'markdown') {
        throw new CliError(`format must be cursor, claude, or markdown, got: ${val}`);
      }
      format = val;
    } else if (arg === '--format') {
      const val = args[i + 1];
      if (val !== 'cursor' && val !== 'claude' && val !== 'markdown') {
        throw new CliError(`format must be cursor, claude, or markdown, got: ${val ?? 'missing'}`);
      }
      format = val;
      i += 1;
    } else {
      throw new CliError(`unknown option for vibe rules: ${arg}`);
    }
  }
  return { command: 'vibe-rules', format, write };
}

function parseVibePromptArgs(args: readonly string[]): ParsedCommand {
  const preset = args[0];
  if (preset !== 'adjudicator' && preset !== 'researcher' && preset !== 'ratings') {
    throw new CliError(
      `vibe prompt requires a valid preset (adjudicator, researcher, ratings), got: ${preset ?? 'none'}`,
    );
  }
  if (args.length > 1) {
    throw new CliError(
      `unexpected arguments after 'vibe prompt ${preset}': ${args.slice(1).join(' ')}`,
    );
  }
  return { command: 'vibe-prompt', preset };
}

function parseFrameworkOption(val: string | undefined): 'react' | 'html' {
  const lower = val?.toLowerCase();
  if (lower !== 'react' && lower !== 'html') {
    throw new CliError(`framework must be react or html, got: ${val ?? 'missing'}`);
  }
  return lower;
}

function parseVibeUiArgs(args: readonly string[]): ParsedCommand {
  let component: string | undefined;
  let framework: 'react' | 'html' | undefined;
  let write: string | undefined;
  let list = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--list') {
      list = true;
    } else if (arg.startsWith('--framework=')) {
      framework = parseFrameworkOption(arg.slice(12));
    } else if (arg === '--framework') {
      framework = parseFrameworkOption(args[i + 1]);
      i += 1;
    } else if (arg.startsWith('--write=')) {
      write = arg.slice(8);
    } else if (arg === '--write') {
      const next = args[i + 1];
      if (!next || next.startsWith('-')) throw new CliError('--write requires a file path');
      write = next;
      i += 1;
    } else if (!arg.startsWith('-') && !component) {
      component = arg;
    } else {
      throw new CliError(`unknown option for vibe ui: ${arg}`);
    }
  }

  return { command: 'vibe-ui', component, framework, write, list };
}

function parseVibeCombineArgs(args: readonly string[]): ParsedCommand {
  const ratings: number[] = [];
  for (const arg of args) {
    const n = Number(arg);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      throw new CliError(`rating must be a number between 0 and 100, got: ${arg}`);
    }
    ratings.push(n);
  }
  if (ratings.length === 0) {
    throw new CliError(
      'vibe combine requires at least one rating percentage (e.g. `cfr-free vibe combine 50 30 10`)',
    );
  }
  return { command: 'vibe-combine', ratings };
}

/** Parse `vibe` arguments: `vibe rules`, `vibe prompt`, `vibe ui`, `vibe combine`, or `vibe playground`. */
function parseVibeArgs(rest: readonly string[]): ParsedCommand {
  const sub = rest[0];
  if (sub === 'rules') return parseVibeRulesArgs(rest.slice(1));
  if (sub === 'prompt') return parseVibePromptArgs(rest.slice(1));
  if (sub === 'ui') return parseVibeUiArgs(rest.slice(1));
  if (sub === 'combine') return parseVibeCombineArgs(rest.slice(1));
  if (sub === 'playground') return { command: 'serve', demo: true };
  throw new CliError(
    `vibe requires a subcommand: 'rules', 'prompt', 'ui', 'combine', or 'playground'`,
  );
}

/**
 * The `search` flags, and whether each takes a value.
 *
 * The names mirror the HTTP query parameters, so the CLI and the API cannot
 * drift: `--per-page` is `per_page`, `--kind` is `kind`.
 */
const SEARCH_FLAGS: Readonly<Record<string, boolean>> = {
  '--json': false,
  '--page': true,
  '--per-page': true,
  '--part': true,
  '--kind': true,
  '--chapter': true,
  '--demo': false,
  '--semantic': false,
};

/** The search arguments, split into query words, value flags and switches. */
interface SearchArgs {
  readonly words: readonly string[];
  /** The flags that take a value, by name. */
  readonly values: Readonly<Record<string, string>>;
  /** The flags that take no value, by name. */
  readonly switches: ReadonlySet<string>;
}

/**
 * Split the search arguments into query words and flags.
 *
 * A flag may carry its value with `=` or take the next argument, and a flag
 * may sit before or after the query words. An unknown option is refused
 * rather than ignored: a typo that silently searched for the wrong thing
 * is worse than a refusal.
 */
function splitSearchArgs(rest: readonly string[]): SearchArgs {
  const words: string[] = [];
  const values: Record<string, string> = {};
  const switches = new Set<string>();
  let index = 0;
  while (index < rest.length) {
    const arg = rest[index] as string;
    if (!arg.startsWith('-')) {
      words.push(arg);
      index += 1;
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const attached = equals === -1 ? undefined : arg.slice(equals + 1);
    const takesValue = SEARCH_FLAGS[name];
    if (takesValue === undefined) throw new CliError(`unknown option for search: ${name}`);
    if (!takesValue) {
      if (attached !== undefined) throw new CliError(`${name} takes no value`);
      switches.add(name);
      index += 1;
      continue;
    }
    const value = attached ?? rest[index + 1];
    if (value === undefined) throw new CliError(`${name} needs a value`);
    values[name] = value;
    index += attached === undefined ? 2 : 1;
  }
  return { words, values, switches };
}

/**
 * A page number or a page size, as a number.
 *
 * The schema owns the RANGE; the CLI owns the TYPE, because a value that is
 * not a number at all cannot be handed to the schema, and the schema's range
 * hint would then answer a question nobody asked.
 */
function wholeNumber(name: string, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new CliError(`${name} must be a whole number, got: ${raw}`);
  return Number(raw);
}

/**
 * `search <query…>` — the words are the query, the flags are the HTTP
 * query parameters.
 *
 * The query is checked HERE, before the index is opened. The service
 * enforces the same rule, but it runs after `ensureIndex`, which may pull
 * a 2-3 MB sync — a rejected query must not cost the user a download.
 *
 * The flags are checked here for the same reason: a rejected flag is the
 * reader's mistake, and it must not cost a download either. The service's
 * own validator owns the wording, so the CLI and the API cannot drift in
 * what they say about a rejected search.
 */
function parseSearchArgs(rest: readonly string[]): ParsedCommand {
  const { words, values, switches } = splitSearchArgs(rest);
  const query = words.join(' ').trim();
  if (query.length === 0) {
    // A flag that takes a value swallows the word after it, so
    // `--page PTSD` leaves no query behind. The usual advice then
    // reproduces the command that just failed and points at the wrong
    // thing, so it says what happened instead.
    const takers = Object.keys(values);
    throw new CliError(
      takers.length === 0
        ? 'search requires a query (e.g. `cfr-free search PTSD`)'
        : `search requires a query — ${takers.join(' and ')} took the word; ` +
            'put the query first, or write the flag as --flag=value',
    );
  }
  if (query.length < SEARCH_QUERY_MIN_LENGTH)
    throw new CliError(
      `the search query needs at least ${SEARCH_QUERY_MIN_LENGTH} characters ` +
        '(e.g. `cfr-free search PTSD`)',
    );
  if (query.length > SEARCH_QUERY_MAX_LENGTH)
    throw new CliError(`the search query may be at most ${SEARCH_QUERY_MAX_LENGTH} characters`);

  const page = values['--page'];
  const perPage = values['--per-page'];
  const part = values['--part'];
  const chapter = values['--chapter'];
  const kind = values['--kind'];

  const input = validateSearchInput({
    query,
    ...(page === undefined ? {} : { page: wholeNumber('--page', page) }),
    ...(perPage === undefined ? {} : { perPage: wholeNumber('--per-page', perPage) }),
    ...(part === undefined ? {} : { part }),
    // The kind is handed over as it was typed. The SERVICE owns the rule
    // and the wording — it rejects what it does not accept, and says so in
    // its own words — so the cast only says "this is the shape the service
    // checks", and the service is what decides.
    ...(kind === undefined ? {} : { kind: kind as 'section' | 'appendix' }),
    ...(chapter === undefined ? {} : { chapter }),
  });

  return {
    command: 'search',
    query: input.query,
    json: switches.has('--json'),
    page: input.page,
    perPage: input.perPage,
    part: input.part,
    kind: input.kind,
    chapter: input.chapter,
    ...(switches.has('--demo') ? { demo: true } : {}),
    ...(switches.has('--semantic') ? { semantic: true } : {}),
  };
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

function parseMcpCommandArgs(rest: readonly string[]): ParsedCommand {
  if (rest.length > 0) {
    if (rest[0] === 'install') return parseMcpInstallArgs(rest.slice(1));
    throw new CliError(`unexpected arguments after 'mcp': ${rest.join(' ')}`);
  }
  return { command: 'mcp' };
}

function parseServeCommandArgs(rest: readonly string[]): ParsedCommand {
  if (rest.length === 0) return { command: 'serve' };
  if (rest.length === 1 && rest[0] === '--demo') return { command: 'serve', demo: true };
  throw new CliError(`unexpected arguments after 'serve': ${rest.join(' ')}`);
}

function parseSyncCommandArgs(rest: readonly string[]): ParsedCommand {
  if (rest.length > 0) throw new CliError(`unexpected arguments after 'sync': ${rest.join(' ')}`);
  return { command: 'sync' };
}

function parseDemoCommandArgs(rest: readonly string[]): ParsedCommand {
  if (rest.length > 0) throw new CliError(`unexpected arguments after 'demo': ${rest.join(' ')}`);
  return { command: 'serve', demo: true };
}

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
  ['mcp', parseMcpCommandArgs],
  ['mcp-install', parseMcpInstallArgs],
  ['vibe', parseVibeArgs],
  ['vibe-rules', (rest) => parseVibeArgs(['rules', ...rest])],
  ['vibe-prompt', (rest) => parseVibeArgs(['prompt', ...rest])],
  ['serve', parseServeCommandArgs],
  ['sync', parseSyncCommandArgs],
  ['demo', parseDemoCommandArgs],
]);

/** Parse argv (without node/script) into a command. Default: `mcp`. */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  const [first, ...rest] = argv;
  if (first === undefined) return { command: 'mcp' };
  const global = GLOBAL_COMMANDS.get(first);
  if (global !== undefined) return { ...global };
  if (asksForHelp(rest) && KNOWN_COMMANDS.has(first)) return { command: 'help', topic: first };
  const parseArgv = ARG_PARSERS.get(first);
  if (parseArgv !== undefined) return parseArgv(rest);
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
 *
 * Only `invalid_input` is a usage mistake. `unavailable` is a DEPLOYMENT
 * fault — the service was wired without the client it needs — so it exits 1
 * with every other service failure: a script must not retry a misconfigured
 * server as if the reader had made a typo.
 *
 * Exported so the mapping can be pinned on its own; `main()` only reaches
 * it through a throw.
 */
export function exitCodeFor(error: unknown): number {
  if (error instanceof CommandError) return error.exitCode;
  if (error instanceof ServiceError && error.code === 'invalid_input') return EXIT.USAGE;
  return error instanceof ConfigError ? EXIT.USAGE : EXIT.ERROR;
}

/**
 * The answer a USAGE command gives: the general usage, the usage of one
 * command, or the version. Undefined for every other command.
 *
 * It is its own function so the entry point keeps room for the commands
 * that DO work: the complexity limit is the repo's own, and a command
 * dispatch that answers `--help` inline spends the budget it needs for
 * the commands that read the index.
 */
function usageAnswer(parsed: ParsedCommand): string | undefined {
  if (parsed.command === 'help') {
    return parsed.topic === undefined ? USAGE : commandUsage(parsed.topic);
  }
  if (parsed.command === 'version') return `${VERSION}\n`;
  return undefined;
}

function runVibeCoderCommand(parsed: ParsedCommand, io: MainIO): boolean {
  if (parsed.command === 'mcp-install') {
    const report = runMcpInstallCommand({
      client: parsed.client,
      workspace: parsed.workspace,
      print: parsed.print,
    });
    io.out(report.output);
    return true;
  }
  if (parsed.command === 'vibe-rules') {
    const report = generateVibeRules({
      format: parsed.format,
      write: parsed.write,
    });
    if (report.writtenPath) {
      io.out(`✓ Wrote agent rules to ${report.writtenPath}\n`);
    } else {
      io.out(report.content + '\n');
    }
    return true;
  }
  if (parsed.command === 'vibe-prompt') {
    const prompt = generateVibePrompt(parsed.preset);
    io.out(prompt + '\n');
    return true;
  }
  if (parsed.command === 'vibe-ui') {
    const report = runVibeUiCommand({
      component: parsed.component,
      framework: parsed.framework,
      write: parsed.write,
      list: parsed.list,
    });
    io.out(report.output);
    return true;
  }
  if (parsed.command === 'vibe-combine') {
    const result = calculateCombinedRating(parsed.ratings);
    io.out(formatCombineResult(result));
    return true;
  }
  return false;
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
    const usage = usageAnswer(parsed);
    if (usage !== undefined) {
      io.out(usage);
      return 0;
    }

    if (runVibeCoderCommand(parsed, io)) return 0;

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
      const result = await runSearchCommand(config, logger, parsed.query, {
        page: parsed.page,
        perPage: parsed.perPage,
        part: parsed.part,
        kind: parsed.kind,
        chapter: parsed.chapter,
        demo: parsed.demo,
        semantic: parsed.semantic,
      });
      io.out(parsed.json ? formatSearchResultsJson(result) : formatSearchResults(result));
      return 0;
    }
    if (PROVISION_READ_COMMANDS.has(command)) {
      return await runProvisionRead(parsed, logger, io);
    }
    if (command === 'serve') {
      // The URL in plain language: the structured log carries it too, but a
      // log line is not what a human reads to find out where the server is.
      return await runServeCommand(config, logger, {
        demo: parsed.demo,
        onListening: (url) => {
          const mode = parsed.demo ? ' (demo mode)' : '';
          io.out(`Serving on ${url}${mode}\n`);
        },
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
