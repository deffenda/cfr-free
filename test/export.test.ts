import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runExportCommand } from '../src/commands/export.js';
import { Store } from '../src/core/store.js';
import { CommandError } from '../src/exit-codes.js';
import { createTestLogger, openTempStore } from './helpers.js';

describe('export command', () => {
  it('exports a consistent, reopenable snapshot', () => {
    const temp = openTempStore();
    const target = path.join(temp.dir, 'backup.sqlite');
    try {
      const config = loadConfig({ CFR_INDEX_PATH: temp.indexPath });
      const report = runExportCommand(config, target, createTestLogger());
      expect(existsSync(target)).toBe(true);
      expect(report.bytes).toBeGreaterThan(0);
      expect(report.path).toBe(target);

      // The snapshot is a full index: reopen it and compare row counts.
      const copy = Store.open(target);
      try {
        expect(copy.countSections()).toBe(temp.store.countSections());
        expect(copy.getMeta('issue_date')).toBe(temp.store.getMeta('issue_date'));
      } finally {
        copy.close();
      }
    } finally {
      temp.cleanup();
    }
  });

  it('fails with exit code 3 when there is no index', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-export-'));
    try {
      const config = loadConfig({ CFR_INDEX_PATH: path.join(dir, 'missing.sqlite') });
      let caught: unknown;
      try {
        runExportCommand(config, path.join(dir, 'out.sqlite'), createTestLogger());
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CommandError);
      expect((caught as CommandError).exitCode).toBe(3);
      expect(existsSync(path.join(dir, 'out.sqlite'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an existing file', () => {
    const temp = openTempStore();
    const target = path.join(temp.dir, 'existing.sqlite');
    writeFileSync(target, 'keep me');
    try {
      const config = loadConfig({ CFR_INDEX_PATH: temp.indexPath });
      let caught: unknown;
      try {
        runExportCommand(config, target, createTestLogger());
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CommandError);
      expect((caught as CommandError).exitCode).toBe(2);
      expect((caught as Error).message).toMatch(/refusing to overwrite/);
    } finally {
      temp.cleanup();
    }
  });
});
