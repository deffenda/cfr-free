import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runExportCommand } from '../src/commands/export.js';
import { Store } from '../src/core/store.js';
import { CommandError } from '../src/exit-codes.js';
import type { RawSection } from '../src/core/xml.js';
import { createTestLogger, makeSection, openTempStore } from './helpers.js';

/** Exact key order of every jsonl line (wire SectionDetail field names). */
const JSONL_FIELDS = [
  'citation',
  'kind',
  'heading',
  'chapter',
  'subchapter',
  'part',
  'subpart',
  'subjectGroup',
  'path',
  'issueDate',
  'text',
  'markdown',
] as const;

/** CRLF + newlines + unicode in `text`; must survive both formats verbatim. */
const TRICKY_TEXT = 'Line one.\r\nLine two — ünïcødé §4.125 ✓\nLine three.';

/** 4 rows in citation order: `4.125` < `4.130` < `9.100` < `Appendix A…`. */
const EXPORT_SECTIONS: RawSection[] = [
  makeSection({
    citation: '4.125',
    heading: 'Diagnosis of mental disorders.',
    text: 'If the diagnosis does not conform to DSM-5 the rating agency shall return the report.',
    markdown: '## Diagnosis of mental disorders.',
  }),
  // Ends with a newline: pins that the md writer normalizes the separator
  // without touching the text itself.
  makeSection({
    citation: '4.130',
    heading: 'Evaluation of residual functional capacity.',
    text: 'Residual functional capacity evaluation.\n',
    markdown: '## Evaluation of residual functional capacity.',
  }),
  makeSection({ citation: '9.100', text: TRICKY_TEXT, markdown: '## 9.100 heading.' }),
  makeSection({
    citation: 'Appendix A to Part 4',
    kind: 'appendix',
    heading: 'Table of Amendments and Effective Dates Since 1946.',
    path: '/title:38/chapter:I/part:4',
    text: 'Table of amendments and effective dates since 1946.',
    markdown: '## Table of Amendments.',
  }),
];

const EXPORT_CITATIONS = EXPORT_SECTIONS.map((section) => section.citation);

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
      // Format-less call still selects the sqlite writer, now labeled.
      expect(report.format).toBe('sqlite');
      expect(report.provisions).toBe(temp.store.countSections());

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

  it('exports jsonl: one compact line per provision, citation order, exact fields', () => {
    const temp = openTempStore({ sections: EXPORT_SECTIONS, issueDate: '2026-10-09' });
    const target = path.join(temp.dir, 'dump.jsonl');
    try {
      const config = loadConfig({ CFR_INDEX_PATH: temp.indexPath });
      const report = runExportCommand(config, target, createTestLogger(), 'jsonl');
      expect(report.path).toBe(target);
      expect(report.format).toBe('jsonl');
      expect(report.provisions).toBe(EXPORT_SECTIONS.length);
      expect(report.bytes).toBe(statSync(target).size);

      const content = readFileSync(target, 'utf8');
      expect(content.endsWith('\n')).toBe(true); // trailing newline at EOF
      const lines = content.slice(0, -1).split('\n');
      expect(lines).toHaveLength(EXPORT_SECTIONS.length);

      const rows = lines.map((line) => {
        const parsed: unknown = JSON.parse(line); // every line parses standalone
        expect(line).toBe(JSON.stringify(parsed)); // compact — no pretty-printing
        return parsed as Record<string, unknown>;
      });
      expect(rows.map((row) => row['citation'])).toEqual(EXPORT_CITATIONS);
      expect(Object.keys(rows[0] ?? {})).toEqual([...JSONL_FIELDS]);
      expect(rows.every((row) => row['issueDate'] === '2026-10-09')).toBe(true);

      const tricky = rows.find((row) => row['citation'] === '9.100');
      expect(tricky?.['text']).toBe(TRICKY_TEXT); // CRLF/newlines/unicode verbatim
      expect(tricky?.['markdown']).toBe('## 9.100 heading.');
      const appendix = rows.find((row) => row['citation'] === 'Appendix A to Part 4');
      expect(appendix?.['kind']).toBe('appendix');
    } finally {
      temp.cleanup();
    }
  });

  it('exports md: header with issue date, per-provision headings, verbatim text', () => {
    const temp = openTempStore({ sections: EXPORT_SECTIONS, issueDate: '2026-10-09' });
    const target = path.join(temp.dir, 'dump.md');
    try {
      const config = loadConfig({ CFR_INDEX_PATH: temp.indexPath });
      const report = runExportCommand(config, target, createTestLogger(), 'md');
      expect(report.path).toBe(target);
      expect(report.format).toBe('md');
      expect(report.provisions).toBe(EXPORT_SECTIONS.length);
      expect(report.bytes).toBe(statSync(target).size);

      const content = readFileSync(target, 'utf8');
      const lines = content.split('\n');
      expect(lines[0]).toBe('# Code of Federal Regulations — Title 38 (issue date: 2026-10-09)');
      expect(content.endsWith('---\n')).toBe(true);

      // Every provision gets one `## {citation} — {heading}` heading and one `---`.
      const headings = lines.filter((line) => line.startsWith('## '));
      expect(headings).toEqual(EXPORT_SECTIONS.map((s) => `## ${s.citation} — ${s.heading}`));
      expect(lines.filter((line) => line === '---')).toHaveLength(EXPORT_SECTIONS.length);
      // Blank line before every heading, blank line before every separator.
      expect(content.match(/\n\n## /g)).toHaveLength(EXPORT_SECTIONS.length);
      expect(content.match(/\n\n---\n/g)).toHaveLength(EXPORT_SECTIONS.length);

      // Regulatory text stays verbatim: exact strings (CRLF/unicode included),
      // never fenced.
      expect(content).toContain(TRICKY_TEXT);
      expect(content).toContain('Residual functional capacity evaluation.\n\n---');
      expect(content).not.toContain('```');
    } finally {
      temp.cleanup();
    }
  });

  it('md export falls back to "unknown" when the index carries no issue date', () => {
    const temp = openTempStore({ seed: false });
    const target = path.join(temp.dir, 'empty.md');
    try {
      const config = loadConfig({ CFR_INDEX_PATH: temp.indexPath });
      const report = runExportCommand(config, target, createTestLogger(), 'md');
      expect(report.format).toBe('md');
      expect(report.provisions).toBe(0);
      expect(readFileSync(target, 'utf8')).toBe(
        '# Code of Federal Regulations — Title 38 (issue date: unknown)\n',
      );
    } finally {
      temp.cleanup();
    }
  });
});
