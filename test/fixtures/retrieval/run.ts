/**
 * The retrieval evaluation runner (M3).
 *
 * Runs a frozen query set against a local index through the SAME service
 * the product uses, and reports per-query ranks plus aggregate metrics
 * with full provenance. It measures the RETRIEVER — a 'provisional'
 * expectation is the orchestrator's working assumption, not legal ground
 * truth — so the numbers say how the search behaves, not what the law is.
 *
 * Human use (run from the repo root, against your own index):
 *   npx tsx test/fixtures/retrieval/run.ts dev
 *   npx tsx test/fixtures/retrieval/run.ts holdout
 *   npx tsx test/fixtures/retrieval/run.ts fresh
 *   CFR_INDEX_PATH=/tmp/some-index.sqlite npx tsx test/fixtures/retrieval/run.ts dev
 *
 * Deterministic: sorted keys, no timestamps in the compared output. The
 * latency numbers are measurements, not part of the pass/fail surface.
 */

import { arch, cpus, platform, release, totalmem } from 'node:os';
import { CFRService } from '../../../src/core/service.js';
import { Store } from '../../../src/core/store.js';
import { DEV_QUERIES, type RetrievalQuery } from './queries.dev.js';
import { HOLDOUT_QUERIES } from './queries.holdout.js';
import { FRESH_QUERIES } from './queries.fresh.js';

export interface QueryOutcome {
  readonly query: string;
  readonly category: string;
  /** The expected provisions for this query (empty = a genuine no-answer case). */
  readonly expected: readonly string[];
  /** 1-based rank of each expected citation in the returned hits. */
  readonly ranks: Record<string, number>;
  /** True when an EXPECTED citation is the pinned/top hit. */
  readonly topHitExpected: boolean;
  /** True when at least one expected citation appears in the top 5. */
  readonly recallAt5: boolean;
  /** Reciprocal rank of the BEST expected citation (0 when none found). */
  readonly reciprocalRank: number;
  /** For no-answer queries: whether the search confidently returned something. */
  readonly noAnswerViolation: boolean;
  /** The top 5 hits as citations. */
  readonly top5: readonly string[];
  /** Warm search latency in milliseconds (median of 3 runs). */
  readonly latencyMs: number;
}

export interface EvaluationReport {
  readonly set: 'dev' | 'holdout' | 'fresh';
  readonly provenance: {
    readonly platform: string;
    readonly arch: string;
    readonly node: string;
    readonly cpus: number;
    readonly totalMemMb: number;
    readonly indexIssueDate: string;
    /**
     * The index's corpus receipt (SPEC §4): sha256 over the whole corpus at
     * rebuild time. Two runs are comparable only when their receipts agree;
     * 'unknown' marks an index built before the receipt existed.
     */
    readonly indexCorpusHash: string;
    readonly adjudicatedExpectations: number;
    readonly provisionalExpectations: number;
  };
  readonly totals: {
    readonly queries: number;
    /** Queries with at least one expected citation (no-answer cases excluded). */
    readonly answerable: number;
    readonly exactCitationSuccess: number;
    readonly recallAt5: number;
    readonly meanReciprocalRank: number;
    readonly noAnswerCases: number;
    readonly noAnswerViolations: number;
  };
  readonly byCategory: Record<string, { readonly queries: number; readonly recallAt5: number }>;
  readonly outcomes: readonly QueryOutcome[];
}

export type EvaluationSet = 'dev' | 'holdout' | 'fresh';

export function queriesFor(set: EvaluationSet): readonly RetrievalQuery[] {
  if (set === 'holdout') return HOLDOUT_QUERIES;
  if (set === 'fresh') return FRESH_QUERIES;
  return DEV_QUERIES;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1] ?? 0;
  const high = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? high : (low + high) / 2;
}

/** Evaluate one query against the service (one warm-up call is discarded). */
export function evaluateQuery(service: CFRService, entry: RetrievalQuery): QueryOutcome {
  service.search({ query: entry.query, perPage: 5 }); // warm-up, discarded
  const timings: number[] = [];
  let result = service.search({ query: entry.query, perPage: 5 });
  for (let i = 0; i < 2; i += 1) {
    const started = process.hrtime.bigint();
    result = service.search({ query: entry.query, perPage: 5 });
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  const top5 = result.hits.slice(0, 5).map((hit) => hit.citation);
  const ranks: Record<string, number> = {};
  for (const citation of entry.expected) {
    const index = top5.indexOf(citation);
    if (index >= 0) ranks[citation] = index + 1;
  }
  const bestRank = Math.min(...Object.values(ranks).filter((r) => r > 0), Number.POSITIVE_INFINITY);
  const isNoAnswer = entry.expected.length === 0;
  return {
    query: entry.query,
    category: entry.category,
    expected: entry.expected,
    ranks,
    topHitExpected: entry.expected.includes(top5[0] ?? ''),
    recallAt5: !isNoAnswer && Number.isFinite(bestRank),
    reciprocalRank: Number.isFinite(bestRank) ? 1 / bestRank : 0,
    noAnswerViolation: isNoAnswer && top5.length > 0 && result.total > 0,
    top5,
    latencyMs: median(timings),
  };
}

/** Evaluate a whole set and aggregate it. Deterministic (sorted keys). */
export function evaluateSet(service: CFRService, set: EvaluationSet): EvaluationReport {
  const entries = queriesFor(set);
  const outcomes = entries.map((entry) => evaluateQuery(service, entry));
  // A query is a NO-ANSWER case when its EXPECTATION is empty — not when its
  // category label says so. (A category is a label; the expectation is the
  // ground truth, and an entry whose expectation was corrected must stop
  // being counted as a no-answer case.)
  const answerable = outcomes.filter((o) => o.expected.length > 0);
  const noAnswerCases = outcomes.filter((o) => o.expected.length === 0);
  const byCategory: EvaluationReport['byCategory'] = {};
  for (const outcome of outcomes) {
    const existing = byCategory[outcome.category];
    const bucket = {
      queries: (existing?.queries ?? 0) + 1,
      recallAt5: (existing?.recallAt5 ?? 0) + (outcome.recallAt5 ? 1 : 0),
    };
    byCategory[outcome.category] = bucket;
  }
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
  // One status read: the issue date and the corpus receipt come from the
  // same snapshot of the index.
  const status = service.status();
  return {
    set,
    provenance: {
      platform: `${platform()} ${release()}`,
      arch: arch(),
      node: process.version,
      cpus: cpus().length,
      totalMemMb: Math.round(totalmem() / 1024 / 1024),
      indexIssueDate: status.issueDate ?? 'unknown',
      indexCorpusHash: status.corpusHash ?? 'unknown',
      adjudicatedExpectations: entries.filter((e) => e.adjudication === 'adjudicated').length,
      provisionalExpectations: entries.filter((e) => e.adjudication === 'provisional').length,
    },
    totals: {
      queries: outcomes.length,
      answerable: answerable.length,
      exactCitationSuccess: sum(answerable.map((o) => (o.topHitExpected ? 1 : 0))),
      recallAt5: sum(answerable.map((o) => (o.recallAt5 ? 1 : 0))),
      meanReciprocalRank:
        answerable.length === 0
          ? 0
          : Number((sum(answerable.map((o) => o.reciprocalRank)) / answerable.length).toFixed(4)),
      noAnswerCases: noAnswerCases.length,
      noAnswerViolations: sum(noAnswerCases.map((o) => (o.noAnswerViolation ? 1 : 0))),
    },
    byCategory,
    outcomes,
  };
}

/** Render a report as deterministic text. */
export function renderReport(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push(`retrieval evaluation — ${report.set} set`);
  lines.push(
    `  provenance: ${report.provenance.platform} ${report.provenance.arch}, node ${report.provenance.node}, ` +
      `${report.provenance.cpus} cpus, ${report.provenance.totalMemMb} MB, index issue date ${report.provenance.indexIssueDate}, ` +
      `corpus hash ${report.provenance.indexCorpusHash}`,
  );
  lines.push(
    `  expectations: ${report.provenance.adjudicatedExpectations} adjudicated, ` +
      `${report.provenance.provisionalExpectations} provisional (provisional = orchestrator's assumption, not legal ground truth)`,
  );
  const t = report.totals;
  lines.push('');
  lines.push(`  queries ${t.queries} (answerable ${t.answerable}, no-answer ${t.noAnswerCases})`);
  lines.push(`  exact-citation success ${t.exactCitationSuccess}/${t.answerable}`);
  lines.push(`  recall@5 ${t.recallAt5}/${t.answerable}`);
  lines.push(`  mean reciprocal rank ${t.meanReciprocalRank}`);
  lines.push(`  no-answer violations ${t.noAnswerViolations}/${t.noAnswerCases}`);
  lines.push('');
  lines.push('  by category:');
  for (const category of Object.keys(report.byCategory).sort()) {
    const bucket = report.byCategory[category];
    if (bucket === undefined) continue;
    lines.push(`    ${category.padEnd(18)} ${bucket.recallAt5}/${bucket.queries}`);
  }
  lines.push('');
  lines.push('  per query:');
  for (const outcome of report.outcomes) {
    const ranks = Object.entries(outcome.ranks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([citation, rank]) => `${citation}@${rank}`)
      .join(' ');
    lines.push(
      `    [${outcome.category}] ${JSON.stringify(outcome.query)} -> ${outcome.top5.join(', ')}` +
        ` ${ranks === '' ? '' : `(${ranks})`} ${outcome.latencyMs.toFixed(1)}ms`,
    );
  }
  return `${lines.join('\n')}\n`;
}

// Human entry point: run a set against the index at CFR_INDEX_PATH.
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  const requestedSet = process.argv[2];
  const set = (
    requestedSet === 'holdout' || requestedSet === 'fresh' ? requestedSet : 'dev'
  ) as EvaluationSet;
  const indexPath = process.env['CFR_INDEX_PATH'];
  if (indexPath === undefined) {
    console.error(
      'set CFR_INDEX_PATH to the index you want evaluated (e.g. ~/.cfr-free/index.sqlite)',
    );
    process.exitCode = 2;
  } else {
    const store = Store.open(indexPath, { allowSchemaUpgrade: true });
    try {
      process.stdout.write(renderReport(evaluateSet(new CFRService(store, 7), set)));
    } finally {
      store.close();
    }
  }
}
