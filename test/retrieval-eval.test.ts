import { describe, expect, it } from 'vitest';
import { CFRService } from '../src/core/service.js';
import type { RawSection } from '../src/core/xml.js';
import { openTempStore } from './helpers.js';
import {
  evaluateQuery,
  evaluateSet,
  queriesFor,
  renderReport,
  type EvaluationSet,
} from './fixtures/retrieval/run.js';
import { DEV_QUERIES, type RetrievalQuery } from './fixtures/retrieval/queries.dev.js';
import { HOLDOUT_QUERIES } from './fixtures/retrieval/queries.holdout.js';
import { FRESH_QUERIES } from './fixtures/retrieval/queries.fresh.js';

/**
 * The runner's own correctness, against a SEEDED temporary index — the
 * suite stays offline and hermetic: it never touches the operator's
 * index, never the network, and never the real query set's expectations
 * (those are measured by running the runner, not asserted here).
 */

/** A two-provision corpus: one findable by body text, one by heading. */
const CORPUS: RawSection[] = [
  {
    citation: '1.100',
    kind: 'section',
    heading: 'Alpha widget rating.',
    chapter: 'I',
    subchapter: null,
    part: '1',
    subpart: null,
    subjectGroup: null,
    path: '/title:38/chapter:I/part:1/subpart:A',
    text: 'This section describes the alpha widget rating criteria in detail.',
    markdown: 'This section describes the alpha widget rating criteria in detail.',
  },
  {
    citation: '2.200',
    kind: 'section',
    heading: 'Beta gadget schedule.',
    chapter: 'I',
    subchapter: null,
    part: '2',
    subpart: null,
    subjectGroup: null,
    path: '/title:38/chapter:I/part:2',
    text: 'The beta gadget schedule lists every payable condition.',
    markdown: 'The beta gadget schedule lists every payable condition.',
  },
];

function withService(body: (service: CFRService) => void, sections = CORPUS): void {
  const temp = openTempStore({ sections, issueDate: '2026-10-16' });
  try {
    body(new CFRService(temp.store, 7));
  } finally {
    temp.cleanup();
  }
}

const EXPECT_HIT: RetrievalQuery = {
  query: 'alpha widget',
  category: 'natural-phrasing',
  expected: ['1.100'],
  rationale: 'the seeded corpus contains it',
  sourceDate: '2026-10-16',
  adjudication: 'provisional',
};
const EXPECT_MISS: RetrievalQuery = {
  query: 'alpha widget',
  category: 'natural-phrasing',
  expected: ['9.999'],
  rationale: 'not in the seeded corpus',
  sourceDate: '2026-10-16',
  adjudication: 'provisional',
};
const NO_ANSWER: RetrievalQuery = {
  query: 'zzzz nonexistent',
  category: 'no-answer',
  expected: [],
  rationale: 'nothing in the seeded corpus matches',
  sourceDate: '2026-10-16',
  adjudication: 'provisional',
};

describe('retrieval evaluation runner (M3)', () => {
  it('finds a present provision and reports its rank', () => {
    withService((service) => {
      const outcome = evaluateQuery(service, EXPECT_HIT);
      expect(outcome.ranks['1.100']).toBe(1);
      expect(outcome.topHitExpected).toBe(true);
      expect(outcome.recallAt5).toBe(true);
      expect(outcome.reciprocalRank).toBe(1);
    });
  });

  it('reports an absent provision as not found, with no fabricated rank', () => {
    withService((service) => {
      const outcome = evaluateQuery(service, EXPECT_MISS);
      expect(outcome.ranks['9.999']).toBeUndefined();
      expect(outcome.recallAt5).toBe(false);
      expect(outcome.reciprocalRank).toBe(0);
      expect(outcome.topHitExpected).toBe(false);
    });
  });

  it('flags a no-answer query that confidently returns something', () => {
    withService((service) => {
      // The seeded corpus has no match for this query, so a confident hit
      // would be a violation; the runner must decide from the RESULT, not
      // from the query text.
      const outcome = evaluateQuery(service, { ...NO_ANSWER, query: 'beta gadget' });
      expect(outcome.noAnswerViolation).toBe(true);
      const clean = evaluateQuery(service, NO_ANSWER);
      expect(clean.noAnswerViolation).toBe(false);
    });
  });

  it('keeps the aggregates arithmetically consistent with the per-query rows', () => {
    withService((service) => {
      // A tiny local set: the aggregates must equal what the rows say.
      const set = queriesFor('dev').slice(0, 2);
      const report = evaluateSet(service, 'dev');
      expect(report.outcomes).toHaveLength(set.length + (queriesFor('dev').length - set.length));
      const answerable = report.outcomes.filter((o) => o.category !== 'no-answer');
      const successes = report.outcomes.filter((o) => o.topHitExpected).length;
      const recalls = report.outcomes.filter((o) => o.recallAt5).length;
      expect(report.totals.exactCitationSuccess).toBe(successes);
      expect(report.totals.recallAt5).toBe(recalls);
      expect(report.totals.answerable).toBe(answerable.length);
      expect(report.byCategory).toBeTruthy();
    });
  });

  it('renders a deterministic report', () => {
    withService((service) => {
      const a = renderReport(evaluateSet(service, 'dev'));
      const b = renderReport(evaluateSet(service, 'dev'));
      // The report text is deterministic EXCEPT the latency figures,
      // which are measurements; compare the non-latency lines.
      const strip = (text: string): string =>
        text
          .split('\n')
          .filter((line) => !line.includes('ms'))
          .join('\n');
      expect(strip(a)).toBe(strip(b));
      expect(a).toContain('retrieval evaluation — dev set');
      // The report's own provenance line must carry the frozen set's REAL
      // adjudication counts. Asserting only that the word "provisional"
      // appears passed whatever the report said — the legend always
      // contains it — so a miscount (or a report that quietly dropped the
      // adjudication status) would have gone unnoticed.
      const dev = queriesFor('dev');
      const adjudicated = dev.filter((query) => query.adjudication === 'adjudicated').length;
      expect(a).toContain(
        `expectations: ${adjudicated} adjudicated, ${dev.length - adjudicated} provisional`,
      );
    });
  });

  it('exposes the frozen sets with their provenance and adjudication status', () => {
    const dev = queriesFor('dev');
    const holdout = queriesFor('holdout');
    expect(dev).toBe(DEV_QUERIES);
    expect(holdout).toBe(HOLDOUT_QUERIES);
    expect(dev.length).toBe(30);
    expect(holdout.length).toBe(20);
    // The two sets must be distinct queries.
    const devQueries = new Set(dev.map((q) => q.query));
    for (const query of holdout) expect(devQueries.has(query.query)).toBe(false);
    // Every entry carries a rationale, a source date, and an adjudication.
    for (const query of [...dev, ...holdout]) {
      expect(query.rationale.length).toBeGreaterThan(0);
      expect(query.sourceDate).toBe('2026-10-16');
      expect(['provisional', 'adjudicated']).toContain(query.adjudication);
    }
    // The roadmap's categories are all represented.
    const categories = new Set([...dev, ...holdout].map((q) => q.category));
    for (const required of [
      'bare-citation',
      'display-citation',
      'abbreviation',
      'natural-phrasing',
      'quoted-phrase',
      'ambiguous',
      'appendix',
      'no-answer',
    ] as const) {
      expect([...categories]).toContain(required);
    }
  });

  it('gates the fresh set structurally, with no numeric threshold', () => {
    const fresh = queriesFor('fresh');
    expect(fresh).toBe(FRESH_QUERIES);
    expect(fresh.length).toBe(41);
    const frozen = new Set([...DEV_QUERIES, ...HOLDOUT_QUERIES].map((q) => q.query));
    const freshQueries = new Set(fresh.map((q) => q.query));
    expect(freshQueries.size).toBe(fresh.length);
    for (const query of fresh) {
      expect(frozen.has(query.query)).toBe(false);
      expect(query.rationale.length).toBeGreaterThan(0);
      expect(query.sourceDate).toBe('2026-10-16');
      expect(query.adjudication).toBe('adjudicated');
    }
    expect(fresh.filter((query) => query.expected.length > 0)).toHaveLength(33);
    expect(fresh.filter((query) => query.expected.length === 0)).toHaveLength(8);
  });

  it('selects a set by name', () => {
    expect(queriesFor('dev' as EvaluationSet)).toHaveLength(30);
    expect(queriesFor('holdout' as EvaluationSet)).toHaveLength(20);
  });

  it('classifies by the expectation, not by the category label', () => {
    // A no-answer case is one whose EXPECTATION is empty. An entry whose
    // category says 'no-answer' but whose expectation was corrected (three
    // subjects the committee found ARE in Title 38) must count as
    // answerable — otherwise the report miscounts the corpus coverage.
    withService((service) => {
      const report = evaluateSet(service, 'dev');
      const noAnswer = report.outcomes.filter((outcome) => outcome.expected.length === 0);
      expect(noAnswer).toHaveLength(1);
      expect(report.totals.noAnswerCases).toBe(1);
      expect(report.totals.answerable).toBe(report.outcomes.length - 1);
      // The classification follows the expectation, whatever the label says.
      const mislabelled = report.outcomes.find(
        (outcome) => outcome.category === 'natural-phrasing' && outcome.expected.length === 0,
      );
      expect(mislabelled).toBeUndefined();
    });
  });
});
