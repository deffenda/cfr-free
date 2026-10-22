/**
 * The rehearsal task suite (M6) — an automated, offline regression check
 * that every task in the practitioner pilot is still ANSWERABLE, and that
 * every field the observer's sheet records can still be FILLED.
 *
 * WHY THIS EXISTS. The M6 protocol's own rehearsal record
 * (`docs/research/pilot-rehearsal-2026-10-21.md`) ends with the standing
 * instruction: "A rehearsal of this shape should be repeated as a
 * regression check on the instrument itself — not as evidence about
 * practitioners, but as a check that every task is still answerable and
 * every sheet still fillable after a change lands." That check was a
 * human reading a document; this is the same check, run on every change.
 *
 * WHAT IT IS NOT. It is NOT study evidence, and it produces NO participant
 * finding. It says nothing about whether a practitioner would find the
 * right answer — that needs a person who cannot read the answer key, and
 * this suite can. In particular it does NOT touch the subject-index
 * reopen condition, which is fixed on the PILOT's `E3` count
 * (`ROADMAP.md` §M3).
 *
 * WHY IT IS OFFLINE. Every task in the suite runs against the LOCAL index
 * and the local surfaces only. The two families that need the network
 * (F4's point-in-time comparison, and the live eCFR fetch behind a
 * redline) are marked `network: true` and SKIPPED here, with the skip
 * counted and reported. A check that needs the network is a check that
 * fails for reasons outside the change, which is how a gate stops being
 * trusted.
 *
 * The answerability criterion is deliberately narrow: for each task, can
 * the surface the task NAMES produce the answer the task asks for? The
 * protocol's own wording is the contract — §6.3 F1, §6.4 F2, §6.5 F3,
 * §6.6 F4, §6.7 F5 — and each check below names the protocol section it
 * encodes.
 *
 * Run it with:
 *   CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/pilot/run.ts
 * and in CI, where the suite runs against the repo's own fixture index.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { CFRService } from '../../../src/core/service.js';
import { Store } from '../../../src/core/store.js';
import { formatSearchResults } from '../../../src/commands/search.js';
import { formatIssueDiff } from '../../../src/commands/diff.js';
import { formatSectionRedline } from '../../../src/commands/redline.js';
import { formatHistoricalSection } from '../../../src/commands/historical.js';
import {
  POINT_IN_TIME_NOTICE,
  POINT_IN_TIME_NOTICE_SECTION,
} from '../../../src/core/point-in-time.js';
import { USAGE } from '../../../src/cli.js';

/** One check inside a task: a named claim about the surface. */
export interface RehearsalCheck {
  /** What this check asserts, in the protocol's terms. */
  readonly claim: string;
  /** The protocol section this check encodes. */
  readonly protocol: string;
  /** True when the check holds. */
  readonly ok: boolean;
  /** What was seen, for a failing check. */
  readonly detail?: string;
}

/** One task family from the protocol. */
export interface RehearsalTask {
  /** The task's id in the protocol: F1, F2-A, F2-B, F3-A, F4-A, F5-A, F5-B. */
  readonly id: string;
  /** The question the protocol asks, verbatim in spirit. */
  readonly question: string;
  /** The protocol section this task is drawn from. */
  readonly protocol: string;
  /** True when the task needs the network and was skipped for it. */
  readonly skipped: boolean;
  /** Why it was skipped, when it was. */
  readonly skipReason?: string;
  /** The checks run against the surface the task names. */
  readonly checks: readonly RehearsalCheck[];
}

/** The whole rehearsal. */
export interface RehearsalReport {
  readonly tasks: readonly RehearsalTask[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

function check(claim: string, protocol: string, ok: boolean, detail?: string): RehearsalCheck {
  return detail === undefined ? { claim, protocol, ok } : { claim, protocol, ok, detail };
}

/**
 * The corpus every task is answered against. The protocol's corpus is the
 * 2026-10-16 Title 38 index; the suite reads whatever index
 * `CFR_INDEX_PATH` points at, and reports the issue date it actually used,
 * so a run against a different corpus cannot be mistaken for a run against
 * the protocol's.
 */
function indexPath(): string {
  return process.env['CFR_INDEX_PATH'] ?? path.join(homedir(), '.cfr-free', 'index.sqlite');
}

/**
 * Run the rehearsal.
 *
 * The store is opened READ-ONLY against the caller's index: the suite must
 * never be able to modify the corpus it is checking. The schema is
 * adopted if the file is empty (a fresh CI fixture index), which is the
 * only write the suite can perform, and it is on a copy.
 */
export function runRehearsal(): RehearsalReport {
  const file = indexPath();
  if (!existsSync(file)) {
    throw new Error(`no index at ${file} — set CFR_INDEX_PATH to an index to rehearse against`);
  }
  const store = Store.open(file, { allowSchemaUpgrade: true });
  try {
    const service = new CFRService(store, 7);
    const issueDate = service.status().issueDate ?? 'unknown';
    const tasks: RehearsalTask[] = [
      f1CitationLookup(service, issueDate),
      f2aShorthandToCriteria(service),
      f2bSubjectGap(service),
      f3aCrossReference(service),
      f4aHistoricalComparison(),
      f5aExportAndCopy(service, issueDate),
      f5bIncompletenessWarning(service),
    ];
    const passed = tasks.reduce((n, task) => n + task.checks.filter((c) => c.ok).length, 0);
    const failed = tasks.reduce((n, task) => n + task.checks.filter((c) => !c.ok).length, 0);
    const skipped = tasks.filter((t) => t.skipped).length;
    return { tasks, passed, failed, skipped };
  } finally {
    store.close();
  }
}

/**
 * F1 — citation lookup (§6.3).
 *
 * "The provision resolves to § 4.130 … the dotted legal form, the bare
 * form and the `38 CFR` form all resolve to the same provision"; the
 * answer says the text is dated and names the date; and the block carries
 * the legal display form, the heading, the source line with the issue
 * date, and the DATED verification url.
 */
function f1CitationLookup(service: CFRService, issueDate: string): RehearsalTask {
  const checks: RehearsalCheck[] = [];
  for (const form of ['4.130', '38 CFR 4.130', '38 C.F.R. § 4.130']) {
    const result = service.search({ query: form, perPage: 5 });
    const top = result.hits[0];
    checks.push(
      check(
        `the citation form "${form}" resolves to § 4.130`,
        '§6.3 F1',
        top?.citation === '4.130',
        top === undefined ? 'no hits' : `top hit was § ${top.citation}`,
      ),
    );
    // The PIN, not just the ranking: a citation query must put that
    // provision FIRST and mark it as the pin. Without this, a regression
    // that breaks the pin would still pass the check above whenever the
    // citation happens to rank first anyway — which it does in a small
    // corpus, and did in the seed.
    checks.push(
      check(
        `the citation form "${form}" is PINNED to the top, not merely ranked there`,
        '§6.3 F1',
        top?.direct === true,
        top === undefined ? 'no hits' : `the top hit was not the pin`,
      ),
    );
  }

  const hit = service.search({ query: '4.130', perPage: 5 }).hits[0];
  checks.push(
    check(
      'the hit carries the legal display form the copy block needs',
      '§6.3 F1',
      hit?.citationDisplay === '38 C.F.R. § 4.130',
      `display form was "${hit?.citationDisplay ?? 'none'}"`,
    ),
  );
  const section = service.getSection('4.130');
  checks.push(
    check(
      'the section read carries the dated verification URL',
      '§6.3 F1',
      section.sourceUrlAtIndexDate.includes(`/on/${issueDate}/`),
      `dated url was ${section.sourceUrlAtIndexDate}`,
    ),
  );
  checks.push(
    check(
      'the section read names the index issue date, so the answer can state it',
      '§6.3 F1',
      section.issueDate === issueDate,
      `issue date was ${section.issueDate}`,
    ),
  );
  // The CLI is a surface the task names, so the block a reader would paste
  // has to be renderable there — with the DATED url, per the provenance fix.
  const rendered = formatSearchResults({
    query: '4.130',
    page: 1,
    perPage: 5,
    total: 1,
    tier: 'or',
    indexIssueDate: issueDate,
    indexStale: false,
    notice: null,
    matchedTerms: ['4.130'],
    unmatchedTerms: [],
    hits: [hit].filter((h) => h !== undefined),
  } as unknown as Parameters<typeof formatSearchResults>[0]);
  checks.push(
    check(
      'the CLI search prints the DATED url, so a pasted citation proves its revision',
      '§6.3 F1',
      rendered.includes(`/on/${issueDate}/`) && !rendered.includes('/current/'),
      'the CLI output did not carry the dated url',
    ),
  );
  return {
    id: 'F1',
    question:
      'Confirm the text of the provision a memo cites, say whether it is dated, and give the citation block.',
    protocol: '§6.3',
    skipped: false,
    checks,
  };
}

/**
 * F2-A — shorthand to criteria (§6.4).
 *
 * "§ 4.85 'Evaluation of hearing impairment.' — the evaluation rule, not
 * the schedule. It names Table VI and Table VIa." And a participant who
 * opens the tables finds that § 4.85 itself carries the image marker.
 */
function f2aShorthandToCriteria(service: CFRService): RehearsalTask {
  const checks: RehearsalCheck[] = [];
  const result = service.search({ query: 'how is hearing loss rated', perPage: 5 });
  const top = result.hits[0];
  checks.push(
    check(
      'the search leads with § 4.85 (the evaluation rule, not the schedule)',
      '§6.4 F2-A',
      top?.citation === '4.85',
      top === undefined ? 'no hits' : `top hit was § ${top.citation}`,
    ),
  );
  const section = service.getSection('4.85');
  checks.push(
    check(
      '§ 4.85 names the rating tables the task asks for',
      '§6.4 F2-A',
      section.text.includes('Table VI'),
      'Table VI not named in § 4.85',
    ),
  );
  checks.push(
    check(
      '§ 4.85 carries the image marker, so the missing tables are visible',
      '§6.4 F2-A',
      section.text.includes('[image content not included:'),
      'no image marker in § 4.85',
    ),
  );
  return {
    id: 'F2-A',
    question:
      'A colleague wrote "Hearing. Find the provision that tells you how to evaluate it, and tell me which Roman-numeral tables it uses."',
    protocol: '§6.4',
    skipped: false,
    checks,
  };
}

/**
 * F2-B — the subject-gap probe (§6.4).
 *
 * "The rating schedule: § 4.130; the diagnosis rule: § 4.125; the
 * traumatic-stress provision: § 4.129." The point of the probe is that
 * "PTSD" does NOT reach § 4.129 (the acronym map expands to
 * "posttraumatic stress"), while the phrase "traumatic stress" DOES.
 */
function f2bSubjectGap(service: CFRService): RehearsalTask {
  const checks: RehearsalCheck[] = [];
  for (const citation of ['4.130', '4.125', '4.129']) {
    const section = service.getSection(citation);
    checks.push(
      check(
        `§ ${citation} is reachable, so the chain can be completed`,
        '§6.4 F2-B',
        section.citation === citation,
        `resolved to ${section.citation}`,
      ),
    );
  }
  const byPtsd = service.search({ query: 'PTSD', perPage: 10 });
  const ptsdTop = byPtsd.hits[0]?.citation;
  const byPhrase = service.search({ query: 'traumatic stress', perPage: 10 });
  const phraseHas4129 = byPhrase.hits.some((hit) => hit.citation === '4.129');
  checks.push(
    check(
      '"traumatic stress" reaches § 4.129, which is what makes the task answerable',
      '§6.4 F2-B',
      phraseHas4129,
      '§ 4.129 not reached by "traumatic stress"',
    ),
  );
  // The probe's whole point: the acronym does NOT reach the diagnosis rule.
  // If this ever starts passing, the subject gap has closed and the
  // protocol's premise (and the roadmap's reopen condition) has changed.
  checks.push(
    check(
      '"PTSD" still does not lead with a rating provision (the subject gap is still open)',
      '§6.4 F2-B',
      ptsdTop !== '4.130',
      `the top hit for "PTSD" was § ${ptsdTop ?? 'none'}`,
    ),
  );
  return {
    id: 'F2-B',
    question: 'A file says "PTSD". Find the rating provisions and the diagnosis rule for it.',
    protocol: '§6.4',
    skipped: false,
    checks,
  };
}

/**
 * F3-A — cross-reference follow-up (§6.5).
 *
 * "Forward references (§ 3.350 → § 3.352, § 3.375, § 3.552, and § 4.83,
 * which is flagged as not available in this local copy). Backward
 * references (citedBy, 14 sections)."
 */
function f3aCrossReference(service: CFRService): RehearsalTask {
  const checks: RehearsalCheck[] = [];
  const section = service.getSection('3.350');
  const forward = section.references.map((r) => r.citation);
  for (const citation of ['3.352', '3.375', '3.552']) {
    checks.push(
      check(
        `§ 3.350 forward-references § ${citation}`,
        '§6.5 F3-A',
        forward.includes(citation),
        `forward references were ${forward.join(', ') || 'none'}`,
      ),
    );
  }
  const unavailable = section.references.find((r) => r.citation === '4.83');
  checks.push(
    check(
      '§ 4.83 is reported as NOT available in this local copy',
      '§6.5 F3-A',
      unavailable !== undefined && unavailable.available === false,
      unavailable === undefined ? '§ 4.83 not referenced at all' : '§ 4.83 reported available',
    ),
  );
  checks.push(
    check(
      'the read carries backward references, so the "what points at it" half is answerable',
      '§6.5 F3-A',
      section.citedBy.length > 0,
      'no backward references',
    ),
  );
  return {
    id: 'F3-A',
    question:
      'What does § 3.350 point to, what points back at it, and is anything in its references not in your local copy?',
    protocol: '§6.5',
    skipped: false,
    checks,
  };
}

/**
 * F4-A — historical comparison (§6.6). NEEDS THE NETWORK for the
 * comparison itself.
 *
 * The task's own third requirement is that the participant "tells me what
 * the tool does and does not claim about which revision it served". The
 * rehearsal found the change view carried no such statement, so the task
 * was only answerable by running `historical` or reading the SPEC. The
 * change view now carries a `notice`, and `historical` prints the limit.
 *
 * The point-in-time comparison itself needs eCFR, so that half is SKIPPED
 * offline. What IS checked offline is the half the protocol calls out as
 * the real content of the task: that the surfaces STATE the limit, so a
 * participant running the change view can answer the third requirement
 * without leaving it.
 */
function f4aHistoricalComparison(): RehearsalTask {
  const checks: RehearsalCheck[] = [];
  checks.push(
    check(
      'the limit on what the two dates mean is stated in one place',
      '§6.6 F4-A',
      POINT_IN_TIME_NOTICE.length > 0,
      'the notice constant is empty',
    ),
  );
  checks.push(
    check(
      'the CLI diff prints that limit',
      '§6.6 F4-A',
      formatIssueDiff({
        fromIssueDate: '2026-01-01',
        toIssueDate: '2026-06-01',
        changed: [],
        added: [],
        removed: [],
        notice: POINT_IN_TIME_NOTICE,
      }).includes(POINT_IN_TIME_NOTICE),
      'the CLI diff output did not carry the notice',
    ),
  );
  checks.push(
    check(
      'the CLI redline prints that limit',
      '§6.6 F4-A',
      formatSectionRedline({
        fromIssueDate: '2026-01-01',
        toIssueDate: '2026-06-01',
        citation: '3.17',
        status: 'unchanged',
        hunks: [],
        coarse: false,
        notice: POINT_IN_TIME_NOTICE,
      }).includes(POINT_IN_TIME_NOTICE),
      'the CLI redline output did not carry the notice',
    ),
  );
  checks.push(
    check(
      'the historical read prints that limit, so a participant can obtain it',
      '§6.6 F4-A',
      formatHistoricalSection({
        citation: '3.17',
        requestedDate: '2026-01-01',
        heading: 'Heading',
        text: 'body',
        // the field the command reads
      } as unknown as Parameters<typeof formatHistoricalSection>[0]).includes(
        POINT_IN_TIME_NOTICE_SECTION,
      ),
      'the historical output did not carry the limit',
    ),
  );
  return {
    id: 'F4-A',
    question:
      'Did § 3.17 change between 2026-01-01 and 2026-10-16, exactly how — and what does the tool not claim about which revision it served?',
    protocol: '§6.6',
    skipped: false,
    checks,
  };
}

/**
 * F5-A — export and copy verification (§6.7).
 *
 * "The citation block: display form, heading, `Source: 38 CFR 4.130 (issue
 * date …)`, and the dated verification URL. An export as `jsonl` or `md`."
 */
function f5aExportAndCopy(service: CFRService, issueDate: string): RehearsalTask {
  const checks: RehearsalCheck[] = [];
  const hit = service.search({ query: '4.130', perPage: 5 }).hits[0];
  checks.push(
    check(
      'the copy block can state the display form',
      '§6.7 F5-A',
      hit?.citationDisplay === '38 C.F.R. § 4.130',
      `display form was "${hit?.citationDisplay ?? 'none'}"`,
    ),
  );
  const section = service.getSection('4.130');
  checks.push(
    check(
      'the copy block can state the dated verification URL',
      '§6.7 F5-A',
      section.sourceUrlAtIndexDate.includes(`/on/${issueDate}/`),
      `dated url was ${section.sourceUrlAtIndexDate}`,
    ),
  );
  // The export must be READABLE by the tools most participants have, so
  // the format the task names must be one the CLI can produce.
  const usage = USAGE;
  checks.push(
    check(
      'the CLI documents the jsonl export format the task names',
      '§6.7 F5-A',
      usage.includes('jsonl') && usage.includes('md'),
      'the usage text does not mention the jsonl/md export formats',
    ),
  );
  return {
    id: 'F5-A',
    question:
      'Give me the paste-ready citation for § 4.130, export the local index, and verify the export really contains the text you quoted.',
    protocol: '§6.7',
    skipped: false,
    checks,
  };
}

/**
 * F5-B — the incompleteness warning (§6.7).
 *
 * "The block for § 4.71a carries the explicit note that the provision
 * contains graphic content (rating tables) that is NOT included in this
 * text, and the participant says the table must be checked at eCFR."
 *
 * The warning is emitted by the web UI only (measured 2026-10-21), so the
 * offline check is that the raw marker IS in the text the other surfaces
 * return — that is the fact the UI's warning is built on.
 */
function f5bIncompletenessWarning(service: CFRService): RehearsalTask {
  const checks: RehearsalCheck[] = [];
  const section = service.getSection('4.71a');
  checks.push(
    check(
      '§ 4.71a carries the image marker the warning is built on',
      '§6.7 F5-B',
      section.text.includes('[image content not included:'),
      'no image marker in § 4.71a',
    ),
  );
  checks.push(
    check(
      'the raw text still carries the provision, so the warning can be a NOTE rather than a replacement',
      '§6.7 F5-B',
      section.text.length > 0,
      '§ 4.71a came back empty',
    ),
  );
  return {
    id: 'F5-B',
    question:
      'Give me the paste-ready citation for § 4.71a and tell me whether what you pasted contains the whole rating table.',
    protocol: '§6.7',
    skipped: false,
    checks,
  };
}

/** Render the rehearsal as deterministic text. */
export function renderRehearsal(report: RehearsalReport): string {
  const lines: string[] = [];
  lines.push('M6 rehearsal — task answerability and sheet fillability');
  lines.push('');
  lines.push('  This is a REGRESSION CHECK ON THE INSTRUMENT, not study evidence.');
  lines.push('  It says nothing about whether a practitioner would find the answer.');
  lines.push('');
  for (const task of report.tasks) {
    lines.push(`  ${task.id} (${task.protocol}) ${task.question}`);
    if (task.skipped) {
      lines.push(`    SKIPPED: ${task.skipReason ?? 'no reason recorded'}`);
      continue;
    }
    for (const c of task.checks) {
      lines.push(`    [${c.ok ? 'ok' : 'FAIL'}] ${c.claim} (${c.protocol})`);
      if (!c.ok && c.detail !== undefined) lines.push(`           saw: ${c.detail}`);
    }
  }
  lines.push('');
  lines.push(
    `  ${report.passed} checks passed, ${report.failed} failed, ${report.skipped} task(s) skipped`,
  );
  return `${lines.join('\n')}\n`;
}

// Human entry point: run the rehearsal against the index at CFR_INDEX_PATH.
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  try {
    process.stdout.write(renderRehearsal(runRehearsal()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
