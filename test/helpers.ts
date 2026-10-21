import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import type { RawSection } from '../src/core/xml.js';
import type { LogFields, Logger, LogLevel } from '../src/logger.js';

/** Logger that records everything for assertions. */
export interface TestLogger extends Logger {
  readonly records: Array<{ level: LogLevel; message: string; fields: LogFields | undefined }>;
}

export function createTestLogger(): TestLogger {
  const records: Array<{ level: LogLevel; message: string; fields: LogFields | undefined }> = [];
  const push =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      records.push({ level, message, fields });
    };
  return {
    records,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}

/** Build a RawSection with sensible defaults for tests. */
export function makeSection(overrides: Partial<RawSection> & { citation: string }): RawSection {
  const citation = overrides.citation;
  const heading = overrides.heading ?? `Section ${citation} heading.`;
  return {
    kind: 'section',
    heading,
    chapter: 'I',
    subchapter: null,
    part: '4',
    subpart: 'B',
    subjectGroup: null,
    path: '/title:38/chapter:I/part:4/subpart:B',
    text: `${heading} Body text about ${citation} with searchable terms.`,
    markdown: `## ${heading}\n\nBody text about ${citation} with searchable terms.`,
    ...overrides,
  };
}

export const FIXTURE_SECTIONS: RawSection[] = [
  makeSection({
    citation: '4.125',
    heading: 'Diagnosis of mental disorders.',
    text: 'If the diagnosis of a mental disorder does not conform to DSM-5 the rating agency shall return the report.',
    markdown:
      '## Diagnosis of mental disorders.\n\nIf the diagnosis of a mental disorder does not conform to DSM-5.',
  }),
  makeSection({
    citation: '4.130',
    heading: 'Evaluation of residual functional capacity.',
    text: 'Residual functional capacity evaluation for mental disorder claims under the rating schedule.',
    markdown: '## Evaluation of residual functional capacity.',
  }),
  makeSection({
    citation: '17.15',
    part: '17',
    subpart: null,
    heading: 'Prosthetic and similar appliances.',
    path: '/title:38/chapter:I/part:17',
    text: 'Prosthetic and similar appliances are supplied under the provisions of this part.',
    markdown: '## Prosthetic and similar appliances.',
  }),
  makeSection({
    citation: 'Appendix A to Part 4',
    kind: 'appendix',
    heading: 'Table of Amendments and Effective Dates Since 1946.',
    path: '/title:38/chapter:I/part:4',
    text: 'Table of amendments and effective dates since 1946 for the rating schedule.',
    markdown: '## Table of Amendments and Effective Dates Since 1946.',
  }),
];

/** Minimal but realistic Title 38 structure tree for browse tests. */
export const FIXTURE_STRUCTURE: unknown = {
  type: 'title',
  identifier: '38',
  label: 'Title 38—Pensions, Bonuses, and Veterans\u2019 Relief',
  children: [
    {
      type: 'chapter',
      identifier: 'I',
      label: 'Chapter I—Department of Veterans Affairs',
      children: [
        {
          type: 'part',
          identifier: '4',
          label: 'Part 4—Schedule for Rating Disabilities',
          children: [
            { type: 'subpart', identifier: 'A', label: 'Subpart A—General', children: [] },
            {
              type: 'subpart',
              identifier: 'B',
              label: 'Subpart B—Mental Disorders',
              children: [{ type: 'section', identifier: '4.125', label: '§ 4.125', children: [] }],
            },
            {
              type: 'appendix',
              identifier: 'Appendix A to Part 4',
              label: 'Appendix A to Part 4',
              children: [],
            },
          ],
        },
        {
          type: 'part',
          identifier: '17',
          label: 'Part 17—Medical Care',
          // The real corpus hangs subject groups off parts AND subparts; a
          // group holds the sections of one regulatory subject.
          children: [
            {
              type: 'subject_group',
              identifier: 'ECFRfixturegroup0001',
              label: 'Subgroup—Hospitalization and Emergency Care',
              children: [{ type: 'section', identifier: '17.15', label: '§ 17.15', children: [] }],
            },
          ],
        },
      ],
    },
    {
      type: 'chapter',
      identifier: 'II',
      label: 'Chapter II—Armed Forces Retirement Home',
      children: [],
    },
  ],
};

export interface TempStore {
  readonly store: Store;
  readonly dir: string;
  readonly indexPath: string;
  cleanup(): void;
}

export interface TempStoreOptions {
  /** Seed with fixture data + structure metadata (default: true). */
  readonly seed?: boolean;
  /** Sections to seed (default: FIXTURE_SECTIONS). */
  readonly sections?: RawSection[];
  readonly issueDate?: string;
}

/** Open a store in a fresh temp directory. */
export function openTempStore(options: TempStoreOptions = {}): TempStore {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cfr-free-test-'));
  const indexPath = path.join(dir, 'nested', 'index.sqlite');
  const store = Store.open(indexPath);
  const seed = options.seed ?? true;
  if (seed) {
    const sections = options.sections ?? FIXTURE_SECTIONS;
    const issueDate = options.issueDate ?? '2026-10-09';
    store.replaceAll(sections, issueDate, {
      issue_date: issueDate,
      synced_at: new Date().toISOString(),
      appendices_count: String(sections.filter((s) => s.kind === 'appendix').length),
      structure_json: JSON.stringify(FIXTURE_STRUCTURE),
      parser_version: '1',
    });
  }
  return {
    store,
    dir,
    indexPath,
    cleanup: () => {
      try {
        store.close();
      } catch {
        // Already closed by the test.
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
