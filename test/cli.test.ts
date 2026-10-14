import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError, main, parseArgs } from '../src/cli.js';
import { VERSION } from '../src/version.js';

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
