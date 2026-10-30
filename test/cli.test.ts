import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CliError, failureMessage, main, parseArgs } from '../src/cli.js';
import { HttpError } from '../src/core/http-client.js';
import { formatIssueDiff } from '../src/commands/diff.js';
import { POINT_IN_TIME_NOTICE } from '../src/core/point-in-time.js';
import { formatSearchResults } from '../src/commands/search.js';
import { Store } from '../src/core/store.js';
import type { FetchLike } from '../src/core/http-client.js';
import { VERSION } from '../src/version.js';
import type { Logger } from '../src/logger.js';
import { createTestLogger, FIXTURE_STRUCTURE } from './helpers.js';

function makeIo(
  env: NodeJS.ProcessEnv = {},
  logger?: Logger,
): {
  out: string[];
  err: string[];
  io: {
    out(c: string): void;
    err(c: string): void;
    env: NodeJS.ProcessEnv;
    logger?: Logger;
  };
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (chunk) => out.push(chunk),
      err: (chunk) => err.push(chunk),
      env,
      // `exactOptionalPropertyTypes`: the property is absent, not undefined.
      ...(logger === undefined ? {} : { logger }),
    },
  };
}

describe('parseArgs', () => {
  it('defaults to mcp', () => {
    expect(parseArgs([])).toEqual({ command: 'mcp' });
  });

  it.each([
    [['help'], 'help'],
    [['-h'], 'help'],
    [['--help'], 'help'],
    [['version'], 'version'],
    [['-v'], 'version'],
    [['--version'], 'version'],
    [['mcp'], 'mcp'],
    [['sync'], 'sync'],
    [['serve'], 'serve'],
  ])('parses %j', (argv, expected) => {
    expect(parseArgs(argv)).toEqual({ command: expected });
  });

  it('parses export with its target path', () => {
    expect(parseArgs(['export', './backup.sqlite'])).toEqual({
      command: 'export',
      exportPath: './backup.sqlite',
    });
  });

  it('parses export with an optional jsonl|md format', () => {
    expect(parseArgs(['export', './a', 'jsonl'])).toEqual({
      command: 'export',
      exportPath: './a',
      exportFormat: 'jsonl',
    });
    expect(parseArgs(['export', './a', 'md'])).toEqual({
      command: 'export',
      exportPath: './a',
      exportFormat: 'md',
    });
  });

  it('rejects unknown commands and options', () => {
    expect(() => parseArgs(['bogus'])).toThrow(CliError);
    expect(() => parseArgs(['--frobnicate'])).toThrow(CliError);
    expect(() => parseArgs(['sync', 'extra'])).toThrow(/unexpected arguments/);
  });

  it('rejects export without exactly one target', () => {
    expect(() => parseArgs(['export'])).toThrow(/exactly one target path/);
    expect(() => parseArgs(['export', '-o'])).toThrow(/exactly one target path/);
    expect(() => parseArgs(['export', '-o', 'jsonl'])).toThrow(/exactly one target path/);
  });

  it('rejects export with an invalid format, a flag, or extra args', () => {
    expect(() => parseArgs(['export', './a', 'xml'])).toThrow(CliError);
    expect(() => parseArgs(['export', './a', 'xml'])).toThrow(/export format must be/);
    // Dash-prefixed 2nd arg is an invalid format, not a flag.
    expect(() => parseArgs(['export', './a', '--flag'])).toThrow(CliError);
    expect(() => parseArgs(['export', './a', 'b', 'c'])).toThrow(/exactly one target path/);
    // Two positionals: target + a non-format 2nd arg (was the old arity error).
    expect(() => parseArgs(['export', 'a', 'b'])).toThrow(/export format must be/);
  });

  it('parses diff with one or two dates', () => {
    expect(parseArgs(['diff', '2026-01-01'])).toEqual({
      command: 'diff',
      fromDate: '2026-01-01',
    });
    expect(parseArgs(['diff', '2026-01-01', '2026-06-01'])).toEqual({
      command: 'diff',
      fromDate: '2026-01-01',
      toDate: '2026-06-01',
    });
  });

  it('rejects diff without dates, with extra dates, or with options', () => {
    expect(() => parseArgs(['diff'])).toThrow(/from-date and an optional to-date/);
    expect(() => parseArgs(['diff', '2026-01-01', '2026-06-01', '2026-12-01'])).toThrow(CliError);
    expect(() => parseArgs(['diff', '--flag'])).toThrow(CliError);
    expect(() => parseArgs(['diff', '2026-01-01', '-v'])).toThrow(CliError);
  });
});

describe('main', () => {
  it('prints usage for --help', async () => {
    const { out, io, err } = makeIo();
    const code = await main(['--help'], io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('Usage:');
    expect(out.join('')).toContain('cfr-free diff <from> [to]');
    expect(out.join('')).toContain('cfr-free export <path> [jsonl|md]');
    expect(err.join('')).toBe('');
  });

  it('prints the package version', async () => {
    const { out, io } = makeIo();
    const code = await main(['version'], io);
    expect(code).toBe(0);
    expect(out.join('').trim()).toBe(VERSION);
  });

  it('returns exit code 2 for unknown commands', async () => {
    const { err, io } = makeIo();
    const code = await main(['bogus'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('unknown command');
  });

  it('returns exit code 2 for configuration errors', async () => {
    const { err, io } = makeIo({ CFR_HOST: '0.0.0.0' });
    const code = await main(['serve'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('CFR_ALLOW_REMOTE=1');
  });

  it('reports usage errors from commands with extra args', async () => {
    const { err, io } = makeIo();
    const code = await main(['sync', '--force'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('unexpected arguments');
  });

  it('returns exit code 3 when the index is unavailable', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-'));
    const { err, io } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'),
      CFR_AUTO_SYNC: '0',
      CFR_LOG_LEVEL: 'error',
    });
    try {
      const code = await main(['mcp'], io);
      expect(code).toBe(3);
      expect(err.join('')).toContain('cfr-free sync');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns exit code 2 for an invalid input, not 1', async () => {
    // The README's exit-code table gives code 2 to usage errors, and a
    // script that retries on 1 would otherwise retry a typo forever. A
    // malformed citation is a usage mistake: it is refused before any
    // fetch, so nothing here touches the network.
    const { err, io } = makeIo({ CFR_LOG_LEVEL: 'error' });
    const code = await main(['historical', '2026-01-01', 'not a citation'], io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('not a citation');
  });

  it('explains an upstream failure without the endpoint path', () => {
    // `historical`, `diff` and `redline` reach eCFR directly, so their
    // failures arrive as a raw HttpError. The user needs to know they are
    // offline, not which endpoint failed: no user action depends on the
    // path, and the raw message is developer-facing.
    const failure = new HttpError(
      'request failed for /api/versioner/v1/full/2026-01-01/title-38.xml: fetch failed',
      '/api/versioner/v1/full/2026-01-01/title-38.xml',
    );
    const message = failureMessage(failure);
    expect(message).toContain('eCFR could not be reached');
    expect(message).toContain('network connection');
    expect(message).not.toContain('/api/versioner');

    const serverSide = new HttpError('request failed for /api/versioner/v1/titles.json', '/x', 503);
    expect(failureMessage(serverSide)).toContain('eCFR answered HTTP 503');
    // eCFR answered, so the reader's network is not the suspect: advising a
    // network check would send them after the wrong thing.
    expect(failureMessage(serverSide)).not.toContain('network connection');
    expect(failureMessage(serverSide)).toContain('try again later');

    // A refusal is not a failure to reach: there is nothing the reader can
    // do but change the request, so no advice is offered at all.
    const refused = new HttpError('request failed for /api/versioner/v1/titles.json', '/x', 404);
    expect(failureMessage(refused)).toBe('eCFR answered HTTP 404');

    // An ordinary failure keeps its own message.
    expect(failureMessage(new Error('the index has no structure data'))).toBe(
      'the index has no structure data',
    );
  });

  it("records the upstream detail in the log, not on the reader's line", async () => {
    // The endpoint and the upstream's own words are developer-facing: they
    // stay off the reader's line, but they must not vanish either. The
    // structured log is where they belong.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-diff-'));
    vi.stubGlobal('fetch', async () => new Response('upstream said no', { status: 400 }));
    const logger = createTestLogger();
    const { err, io } = makeIo(
      { CFR_INDEX_PATH: path.join(dir, 'index.sqlite'), CFR_LOG_LEVEL: 'error' },
      logger,
    );
    try {
      const code = await main(['diff', '2026-01-01', '2026-06-01'], io);
      expect(code).toBe(1);
      // The reader's line says what happened, and no endpoint.
      expect(err.join('')).toContain('eCFR answered HTTP 400');
      expect(err.join('')).not.toContain('/api/versioner');
      // The detail reaches the log.
      const errors = logger.records.filter((record) => record.level === 'error');
      expect(errors.length).toBeGreaterThan(0);
      const fields = errors[errors.length - 1]?.fields as Record<string, unknown> | undefined;
      expect(String(fields?.['url'])).toContain('/api/versioner');
      expect(String(fields?.['message'])).toContain('upstream said no');
      expect(fields?.['status']).toBe(400);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not tell the reader to run `cfr-free sync` when they ARE running it', async () => {
    // The reader invoked `cfr-free sync`; advice to run `cfr-free sync`
    // again is circular and sends them nowhere.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-sync-'));
    vi.stubGlobal('fetch', async () => new Response('upstream said no', { status: 400 }));
    const { err, io } = makeIo(
      { CFR_INDEX_PATH: path.join(dir, 'index.sqlite'), CFR_LOG_LEVEL: 'error' },
      createTestLogger(),
    );
    try {
      const code = await main(['sync'], io);
      expect(code).toBe(1);
      expect(err.join('')).toContain('could not build the index from eCFR');
      expect(err.join('')).toContain('eCFR answered HTTP 400');
      expect(err.join('')).not.toContain('cfr-free sync');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const SYNC_XML_V1 = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Body text.</P></DIV8><DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix text.</P></DIV9></DIV5></DIV3></ECFR>`;
const SYNC_XML_V2 = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Amended body text.</P></DIV8><DIV8 N="4.130" TYPE="SECTION"><HEAD>§ 4.130 Evaluation of residual functional capacity.</HEAD><P>New section text.</P></DIV8></DIV5></DIV3></ECFR>`;

function makeSyncFetch(getXml: () => string): FetchLike {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/titles.json'))
      return Response.json({
        titles: [
          {
            number: 38,
            name: 'Title 38',
            latest_issue_date: '2026-08-27',
            up_to_date_as_of: '2026-10-09',
            latest_amended_on: '2026-08-27',
          },
        ],
      });
    if (url.pathname.includes('/structure/')) return Response.json(FIXTURE_STRUCTURE);
    if (url.pathname.includes('/full/'))
      return new Response(getXml(), {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    return new Response('not found', { status: 404 });
  };
}

describe('main: sync output', () => {
  it('reports the provision-level change counts', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-sync-'));
    let xml = SYNC_XML_V1;
    const fetchFn = makeSyncFetch(() => xml);
    vi.stubGlobal('fetch', fetchFn);
    const { out, io } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'),
      CFR_LOG_LEVEL: 'error',
    });
    try {
      // Baseline (no previous index) and identical re-sync: 0/0/0 by design.
      expect(await main(['sync'], io)).toBe(0);
      expect(out.join('')).toMatch(/; no provision changes; \d+ ms; corpus hash [0-9a-f]{64}\)\n$/);
      expect(await main(['sync'], io)).toBe(0);
      expect(out.join('')).toMatch(/; no provision changes; \d+ ms; corpus hash [0-9a-f]{64}\)\n$/);
      // Amended upstream: 4.125 changed, 4.130 added, Appendix A removed.
      xml = SYNC_XML_V2;
      expect(await main(['sync'], io)).toBe(0);
      expect(out.join('')).toMatch(
        /synced 2 sections \+ 0 appendices \(issue date 2026-10-09; 1 changed, 1 added, 1 removed; \d+ ms; corpus hash [0-9a-f]{64}\)\n$/,
      );
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const DIFF_FROM = '2026-01-01';
const DIFF_TO = '2026-06-09'; // also the synced index's issue date in the default-to test
const DIFF_FROM_XML = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Body text.</P></DIV8><DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix text.</P></DIV9></DIV5></DIV3></ECFR>`;
const DIFF_TO_XML = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Amended body text.</P></DIV8><DIV8 N="4.130" TYPE="SECTION"><HEAD>§ 4.130 Evaluation of residual functional capacity.</HEAD><P>New section text.</P></DIV8><DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix text.</P></DIV9></DIV5></DIV3></ECFR>`;

/** Versioner stub routing full-title XML per date (diff never hits titles.json). */
function makeDiffFetch(xmlByDate: Readonly<Record<string, string>>): FetchLike {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/titles.json'))
      return Response.json({
        titles: [
          {
            number: 38,
            name: 'Title 38',
            latest_issue_date: '2026-05-20',
            up_to_date_as_of: DIFF_TO,
            latest_amended_on: '2026-05-20',
          },
        ],
      });
    if (url.pathname.includes('/structure/')) return Response.json(FIXTURE_STRUCTURE);
    const match = /\/full\/(\d{4}-\d{2}-\d{2})\/title-38\.xml$/.exec(url.pathname);
    if (match) {
      const xml = xmlByDate[match[1] as string];
      if (xml === undefined) return new Response('no such date', { status: 404 });
      return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    return new Response('not found', { status: 404 });
  };
}

describe('formatIssueDiff', () => {
  it('renders the no-changes summary with no citation lists', () => {
    const text = formatIssueDiff({
      fromIssueDate: DIFF_FROM,
      toIssueDate: DIFF_TO,
      changed: [],
      added: [],
      removed: [],
      notice: POINT_IN_TIME_NOTICE,
    });
    expect(text).toContain(`no provision changes between ${DIFF_FROM} and ${DIFF_TO}`);
    expect(text).toContain(POINT_IN_TIME_NOTICE);
  });

  it('caps long lists at CHANGE_LIST_CAP with an ellipsis note', () => {
    const citations = Array.from({ length: 101 }, (_, i) => `4.${String(i + 1).padStart(3, '0')}`);
    const text = formatIssueDiff({
      fromIssueDate: DIFF_FROM,
      toIssueDate: DIFF_TO,
      changed: ['4.125'],
      added: [],
      removed: citations,
      notice: POINT_IN_TIME_NOTICE,
    });
    expect(text).toContain(`0 added`);
    expect(text).toContain('changed (1):\n  4.125\n');
    expect(text).toContain('removed (101):');
    // 100 shown (4.001 … 4.100), the 101st only via the ellipsis note.
    expect(text).toContain('  4.100\n');
    expect(text).toContain('… 1 more not shown\n');
    expect(text).not.toContain('  4.101');
  });
});

describe('main: diff output', () => {
  it('prints the summary and lists, exiting 0 with no index present', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-diff-'));
    vi.stubGlobal('fetch', makeDiffFetch({ [DIFF_FROM]: DIFF_FROM_XML, [DIFF_TO]: DIFF_TO_XML }));
    const { out, io, err } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'), // never synced: no index on disk
      CFR_LOG_LEVEL: 'error',
    });
    try {
      const code = await main(['diff', DIFF_FROM, DIFF_TO], io);
      expect(code).toBe(0);
      expect(out.join('')).toContain(
        `1 changed, 1 added, 0 removed between ${DIFF_FROM} and ${DIFF_TO}`,
      );
      expect(out.join('')).toContain('changed (1):\n  4.125\n');
      expect(out.join('')).toContain('added (1):\n  4.130\n');
      expect(err.join('')).toBe('');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports no provision changes for identical content and still exits 0', async () => {
    vi.stubGlobal('fetch', makeDiffFetch({ [DIFF_FROM]: DIFF_TO_XML, [DIFF_TO]: DIFF_TO_XML }));
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-diff-'));
    const { out, io } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'),
      CFR_LOG_LEVEL: 'error',
    });
    try {
      expect(await main(['diff', DIFF_FROM, DIFF_TO], io)).toBe(0);
      const text = out.join('');
      expect(text).toContain(`no provision changes between ${DIFF_FROM} and ${DIFF_TO}`);
      // The change view states the limit on what the dates mean, on the
      // surface that shows the comparison.
      expect(text).toContain(POINT_IN_TIME_NOTICE);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults the to-date to the issue date of the local index', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-diff-'));
    vi.stubGlobal('fetch', makeDiffFetch({ [DIFF_FROM]: DIFF_FROM_XML, [DIFF_TO]: DIFF_TO_XML }));
    const { out, io } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'),
      CFR_LOG_LEVEL: 'error',
    });
    try {
      // Sync first: the index records issue date 2026-06-09 (up_to_date_as_of).
      expect(await main(['sync'], io)).toBe(0);
      out.length = 0;
      // Single-date diff: `to` resolves from the index's issue_date meta.
      expect(await main(['diff', DIFF_FROM], io)).toBe(0);
      expect(out.join('')).toContain(
        `1 changed, 1 added, 0 removed between ${DIFF_FROM} and ${DIFF_TO}`,
      );
      expect(out.join('')).toContain('added (1):\n  4.130\n');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns exit code 3 when the to-date must come from a missing index', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-diff-'));
    const { err, io } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'),
      CFR_LOG_LEVEL: 'error',
    });
    try {
      const code = await main(['diff', DIFF_FROM], io);
      expect(code).toBe(3);
      expect(err.join('')).toContain('cfr-free sync');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns exit code 3 when the index carries no issue date', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-diff-'));
    const indexPath = path.join(dir, 'index.sqlite');
    const store = Store.open(indexPath); // schema present, but never synced
    store.close();
    const { err, io } = makeIo({ CFR_INDEX_PATH: indexPath, CFR_LOG_LEVEL: 'error' });
    try {
      const code = await main(['diff', DIFF_FROM], io);
      expect(code).toBe(3);
      expect(err.join('')).toContain('has no issue date');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseArgs: historical', () => {
  it('parses historical with exactly two positionals', () => {
    expect(parseArgs(['historical', '2024-03-10', '4.130'])).toEqual({
      command: 'historical',
      atDate: '2024-03-10',
      citation: '4.130',
    });
  });

  it('rejects historical with too few, too many, or dash-prefixed arguments', () => {
    const usage = /cfr-free historical <at> <citation>/;
    expect(() => parseArgs(['historical'])).toThrow(CliError);
    expect(() => parseArgs(['historical', '2024-03-10'])).toThrow(usage);
    expect(() => parseArgs(['historical', '2024-03-10', '4.130', 'extra'])).toThrow(usage);
    expect(() => parseArgs(['historical', '--at', '4.130'])).toThrow(usage);
    expect(() => parseArgs(['historical', '2024-03-10', '--citation'])).toThrow(usage);
  });
});

describe('parseArgs: redline', () => {
  it('parses redline with exactly three positionals', () => {
    expect(parseArgs(['redline', '2026-01-01', '2026-06-01', '4.125'])).toEqual({
      command: 'redline',
      fromDate: '2026-01-01',
      toDate: '2026-06-01',
      citation: '4.125',
    });
  });

  it('rejects redline with too few, too many, or dash-prefixed arguments', () => {
    const usage = /cfr-free redline <from> <to> <citation>/;
    expect(() => parseArgs(['redline'])).toThrow(CliError);
    expect(() => parseArgs(['redline', '2026-01-01', '2026-06-01'])).toThrow(usage);
    expect(() => parseArgs(['redline', '2026-01-01', '2026-06-01', '4.125', 'extra'])).toThrow(
      usage,
    );
    expect(() => parseArgs(['redline', '--flag', '2026-06-01', '4.125'])).toThrow(CliError);
  });

  it('mentions the redline command in the help output', async () => {
    const { out, io, err } = makeIo();
    const code = await main(['--help'], io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('cfr-free redline <from> <to> <citation>');
    expect(err.join('')).toBe('');
  });
});

// Tiny known seed for redline: 4.125 amends its second paragraph, 4.130 is
// byte-identical on both dates.
const REDLINE_FROM_XML = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Line one.</P><P>Line two.</P></DIV8><DIV8 N="4.130" TYPE="SECTION"><HEAD>§ 4.130 Evaluation of residual functional capacity.</HEAD><P>RFC text.</P></DIV8></DIV5></DIV3></ECFR>`;
const REDLINE_TO_XML = `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Line one.</P><P>Line two amended.</P></DIV8><DIV8 N="4.130" TYPE="SECTION"><HEAD>§ 4.130 Evaluation of residual functional capacity.</HEAD><P>RFC text.</P></DIV8></DIV5></DIV3></ECFR>`;

describe('main: redline output', () => {
  it('pins the summary, legend and per-hunk lines on a small seed, exiting 0', async () => {
    vi.stubGlobal(
      'fetch',
      makeDiffFetch({ [DIFF_FROM]: REDLINE_FROM_XML, [DIFF_TO]: REDLINE_TO_XML }),
    );
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-redline-'));
    const { out, io, err } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'), // redline never opens the index
      CFR_LOG_LEVEL: 'error',
    });
    try {
      const code = await main(['redline', DIFF_FROM, DIFF_TO, '4.125'], io);
      expect(code).toBe(0);
      expect(out.join('')).toBe(
        [
          `Section 4.125: changed between ${DIFF_FROM} and ${DIFF_TO}`,
          `        | ${DIFF_FROM} | ${DIFF_TO} | text`,
          // prefix: '-' delete, '+' insert, ' ' unchanged — the empty same-line
          // renders as its prefix space (trailing space intentional).
          'L1 | L1 |  Line one.',
          'L2 | L2 |  ',
          'L3 | L- | -Line two.',
          'L- | L3 | +Line two amended.',
          '',
          `Note: ${POINT_IN_TIME_NOTICE}`,
          '',
        ].join('\n'),
      );
      expect(err.join('')).toBe('');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints only the summary line for an unchanged provision, still exit 0', async () => {
    vi.stubGlobal(
      'fetch',
      makeDiffFetch({ [DIFF_FROM]: REDLINE_FROM_XML, [DIFF_TO]: REDLINE_TO_XML }),
    );
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-redline-'));
    const { out, io, err } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'),
      CFR_LOG_LEVEL: 'error',
    });
    try {
      const code = await main(['redline', DIFF_FROM, DIFF_TO, '4.130'], io);
      expect(code).toBe(0);
      expect(out.join('')).toBe(
        [
          `Section 4.130: unchanged between ${DIFF_FROM} and ${DIFF_TO}`,
          '',
          `Note: ${POINT_IN_TIME_NOTICE}`,
          '',
        ].join('\n'),
      );
      expect(err.join('')).toBe('');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns exit code 1 for a citation missing from both dates', async () => {
    vi.stubGlobal(
      'fetch',
      makeDiffFetch({ [DIFF_FROM]: REDLINE_FROM_XML, [DIFF_TO]: REDLINE_TO_XML }),
    );
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-redline-'));
    const { out, io, err } = makeIo({
      CFR_INDEX_PATH: path.join(dir, 'index.sqlite'),
      CFR_LOG_LEVEL: 'error',
    });
    try {
      const code = await main(['redline', DIFF_FROM, DIFF_TO, '4.999'], io);
      expect(code).toBe(1);
      expect(out.join('')).toBe('');
      expect(err.join('')).toContain('4.999');
      expect(err.join('')).toContain(DIFF_FROM);
      expect(err.join('')).toContain(DIFF_TO);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cfr-free search', () => {
  it('parses the words after the command as one query', () => {
    expect(parseArgs(['search', 'PTSD', 'diagnosis'])).toEqual({
      command: 'search',
      query: 'PTSD diagnosis',
    });
  });

  it('refuses a search with no query, and a dash-prefixed option', () => {
    expect(() => parseArgs(['search'])).toThrow(CliError);
    expect(() => parseArgs(['search', '--limit', '5'])).toThrow(/unknown option for search/);
  });

  it('refuses a query the index could never match, before opening it', async () => {
    // The service enforces the same rule, but it runs after the index is
    // built — and building it may pull a 2-3 MB sync. A rejected query
    // must not cost the user a download: the index is never opened, and
    // the exit code is 2 (usage), not 1 (service failure).
    expect(() => parseArgs(['search', 'ab'])).toThrow(/at least 3 characters/);
    expect(() => parseArgs(['search', 'x'.repeat(201)])).toThrow(/at most 200 characters/);

    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-cli-'));
    const indexPath = path.join(dir, 'index.sqlite');
    const { err, io } = makeIo({ CFR_INDEX_PATH: indexPath, CFR_LOG_LEVEL: 'error' });
    try {
      const code = await main(['search', 'ab'], io);
      expect(code).toBe(2);
      expect(err.join('')).toContain('at least 3 characters');
      expect(existsSync(indexPath), 'the index must not be opened for a rejected query').toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the stale-index notice when the index is past its freshness limit', () => {
    const out = formatSearchResults({
      query: 'PTSD',
      page: 1,
      perPage: 10,
      total: 0,
      tier: 'or',
      indexIssueDate: '2026-08-22',
      indexStale: true,
      notice: 'local index is stale (issue date 2026-08-22) — verify against the current eCFR',
      matchedTerms: [],
      unmatchedTerms: [],
      hits: [],
    } as unknown as Parameters<typeof formatSearchResults>[0]);
    expect(out).toContain('warning: local index is stale');
  });

  it('prints the DATED verification URL for each hit, not the current one', () => {
    // A reader who pastes the CURRENT url into a memo has cited text they
    // cannot show they read: the /current/ form drops the revision. The
    // dated form is the one that proves which revision the indexed text
    // came from, and it is the same link the section read and the UI's copy
    // block use.
    const out = formatSearchResults({
      query: '4.130',
      page: 1,
      perPage: 10,
      total: 1,
      tier: 'or',
      indexIssueDate: '2026-10-16',
      indexStale: false,
      notice: null,
      matchedTerms: ['4.130'],
      unmatchedTerms: [],
      hits: [
        {
          citation: '4.130',
          citationDisplay: '38 C.F.R. § 4.130',
          heading: 'Schedule of ratings—Mental disorders.',
          snippet: '…',
          sourceUrl: 'https://www.ecfr.gov/current/title-38/section-4.130',
          sourceUrlAtIndexDate: 'https://www.ecfr.gov/on/2026-10-16/title-38/section-4.130',
          direct: true,
          inResults: true,
          partTitle: 'Evaluation of General Rating Principles',
        },
      ],
    } as unknown as Parameters<typeof formatSearchResults>[0]);
    expect(out).toContain('https://www.ecfr.gov/on/2026-10-16/title-38/section-4.130');
    expect(out).not.toContain('https://www.ecfr.gov/current/title-38/section-4.130');
  });

  it('says so when nothing matches, and states the issue date', () => {
    const out = formatSearchResults({
      query: 'zzz',
      page: 1,
      perPage: 10,
      total: 0,
      tier: 'or',
      indexIssueDate: '2026-10-16',
      indexStale: false,
      notice: null,
      matchedTerms: [],
      unmatchedTerms: ['zzz'],
      hits: [],
    } as unknown as Parameters<typeof formatSearchResults>[0]);
    expect(out).toContain('No provisions match "zzz".');
    expect(out).toContain('index issue date 2026-10-16');
    expect(out).toContain('terms not answered by these hits: zzz');
  });
});
