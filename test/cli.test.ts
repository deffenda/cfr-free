import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CliError, main, parseArgs } from '../src/cli.js';
import type { FetchLike } from '../src/core/http-client.js';
import { VERSION } from '../src/version.js';
import { FIXTURE_STRUCTURE } from './helpers.js';

function makeIo(env: NodeJS.ProcessEnv = {}): {
  out: string[];
  err: string[];
  io: { out(c: string): void; err(c: string): void; env: NodeJS.ProcessEnv };
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

  it('rejects unknown commands and options', () => {
    expect(() => parseArgs(['bogus'])).toThrow(CliError);
    expect(() => parseArgs(['--frobnicate'])).toThrow(CliError);
    expect(() => parseArgs(['sync', 'extra'])).toThrow(/unexpected arguments/);
  });

  it('rejects export without exactly one target', () => {
    expect(() => parseArgs(['export'])).toThrow(/exactly one target path/);
    expect(() => parseArgs(['export', 'a', 'b'])).toThrow(/exactly one target path/);
    expect(() => parseArgs(['export', '-o'])).toThrow(/exactly one target path/);
  });
});

describe('main', () => {
  it('prints usage for --help', async () => {
    const { out, io, err } = makeIo();
    const code = await main(['--help'], io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('Usage:');
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
      expect(out.join('')).toMatch(/; no provision changes; \d+ ms\)\n$/);
      expect(await main(['sync'], io)).toBe(0);
      expect(out.join('')).toMatch(/; no provision changes; \d+ ms\)\n$/);
      // Amended upstream: 4.125 changed, 4.130 added, Appendix A removed.
      xml = SYNC_XML_V2;
      expect(await main(['sync'], io)).toBe(0);
      expect(out.join('')).toMatch(
        /synced 2 sections \+ 0 appendices \(issue date 2026-10-09; 1 changed, 1 added, 1 removed; \d+ ms\)\n$/,
      );
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
