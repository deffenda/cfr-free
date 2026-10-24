/**
 * DEVELOPMENT query set for the retrieval evaluation (M3).
 *
 * FROZEN: once committed, a change to an entry is a change to the
 * benchmark and must be visible in the diff — never silently edited.
 * The holdout set (queries.holdout.ts) must not be used to tune or pick
 * anything.
 *
 * `adjudication: 'adjudicated'` means the entry is settled: either the
 * two-member committee's ruling of 2026-10-21, cross-checked against the
 * other member and against the corpus (the record of those rulings is
 * `docs/research/expectation-adjudication-2026-10-21.md`; the measured
 * consequence is `docs/research/retrieval-baseline-2026-10-20.md`), or an
 * operator decision recorded on issue #135 (2026-10-22, e.g. the
 * quoted-phrase all-match policy below). The expected set is the
 * adjudicating authority's answer to the question the query asks — it
 * measures the RETRIEVER against that answer, not legal correctness, and
 * an expert remains the authority.
 *
 * Expectations are grounded in the 2026-10-16 Title 38 corpus (issue
 * date recorded in the runner's report).
 *
 * QUOTED-PHRASE EXPECTATIONS follow the operator's all-match policy
 * (selected in chat 2026-10-22, recorded on issue #135): a quoted phrase
 * expects EVERY product FTS result for the phrase — the same rule the
 * fresh set carries.
 */

export type QueryCategory =
  | 'bare-citation'
  | 'display-citation'
  | 'abbreviation'
  | 'natural-phrasing'
  | 'quoted-phrase'
  | 'ambiguous'
  | 'appendix'
  | 'no-answer';

export interface RetrievalQuery {
  /** The query string, as a claims researcher would type it. */
  readonly query: string;
  readonly category: QueryCategory;
  /**
   * Expected provisions (citations). Empty for a no-answer case. Ordered
   * by what a reviewer would consider correct first.
   */
  readonly expected: readonly string[];
  /** One line: WHY these are the expected provisions. */
  readonly rationale: string;
  /** The corpus issue date the expectation was formed against. */
  readonly sourceDate: string;
  /**
   * 'adjudicated' = settled: the committee's cross-checked ruling of
   * 2026-10-21 (docs/research/expectation-adjudication-2026-10-21.md),
   * or an operator decision recorded on issue #135 (2026-10-22).
   * 'provisional' = the orchestrator's working expectation, not adjudicated.
   */
  readonly adjudication: 'provisional' | 'adjudicated';
}

const SOURCE_DATE = '2026-10-16';

export const DEV_QUERIES: readonly RetrievalQuery[] = [
  // Bare citations — must pin exactly.
  {
    query: '4.130',
    category: 'bare-citation',
    expected: ['4.130'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '3.350',
    category: 'bare-citation',
    expected: ['3.350'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '4.85',
    category: 'bare-citation',
    expected: ['4.85'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '3.504',
    category: 'bare-citation',
    expected: ['3.504'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '4.16',
    category: 'bare-citation',
    expected: ['4.16'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '3.317',
    category: 'bare-citation',
    expected: ['3.317'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },

  // Display citations — the legal form the tool prints.
  {
    query: '38 C.F.R. § 4.130',
    category: 'display-citation',
    expected: ['4.130'],
    rationale: 'the printed display form of the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '38 C.F.R. § 4.85',
    category: 'display-citation',
    expected: ['4.85'],
    rationale: 'the printed display form of the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '38 CFR 3.350',
    category: 'display-citation',
    expected: ['3.350'],
    rationale: 'the undotted full citation',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '§ 3.504',
    category: 'display-citation',
    expected: ['3.504'],
    rationale: 'the section-sign form',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },

  // Abbreviations — the rating-office language.
  {
    query: 'PTSD',
    category: 'abbreviation',
    expected: ['4.130', '3.304', '3.309', '4.125'],
    rationale:
      'the rating schedule (4.130), direct service connection (3.304), presumptive service connection (3.309) and the diagnosis section (4.125) - committee members disagreed; the corpus shows 3.309 names PTSD substantively, so all four are kept',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'TBI',
    category: 'abbreviation',
    expected: ['4.124a', '3.350', '3.310'],
    rationale:
      'TBI residuals are rated in the neurological schedule (4.124a); 3.350 is the special monthly compensation; 3.310 governs aggravation and the proximate result',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'SMC',
    category: 'abbreviation',
    expected: ['3.350'],
    rationale: 'special monthly compensation (expert to confirm)',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'A&A',
    category: 'abbreviation',
    expected: ['3.352', '3.350', '3.504'],
    rationale:
      'aid and attendance: the criteria (3.352), the entitlement and rate (3.350) and the parents provision (3.504) - the abbreviation denotes the subject generally',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'VA disability rating',
    category: 'abbreviation',
    expected: ['4.1', '4.15'],
    rationale:
      'the general rating provisions - essentials of evaluative rating (4.1) and total disability ratings (4.15); the mental-disorders schedule and the TDIU formula answer narrower questions',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },

  // Natural phrasing — how an adjudicator asks.
  {
    query: 'schizophrenia',
    category: 'natural-phrasing',
    expected: ['4.130', '3.384'],
    rationale:
      '§ 4.130 is the schedule-of-ratings section for mental disorders incl. schizophrenia; § 3.384 "Psychosis." is the definitional sibling the retriever leads with, and the committee accepted it as a defensible answer to this question',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'how is hearing loss rated',
    category: 'natural-phrasing',
    expected: ['4.85'],
    rationale: '§ 4.85 evaluates hearing impairment',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'aid and attendance for a parent',
    category: 'natural-phrasing',
    expected: ['3.504'],
    rationale: '§ 3.504 rates aid and attendance for parents',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'total disability rating based on unemployability',
    category: 'natural-phrasing',
    expected: ['4.16', '4.17'],
    rationale:
      '§ 4.16 is the general total-rating formula; § 4.17 is the pension half of the same formula pair, accepted by the committee as a defensible answer',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'traumatic brain injury compensation',
    category: 'natural-phrasing',
    expected: ['3.350', '4.124a', '3.310'],
    rationale:
      'the compensation (3.350) and the residuals rating (4.124a) - a practitioner needs both to compute an award; § 3.310(d) "Traumatic brain injury." is the proximate-result provision, added by the committee',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'Persian Gulf veterans compensation',
    category: 'natural-phrasing',
    expected: ['3.317', '3.320', '3.320a', '3.320b'],
    rationale:
      '§ 3.317 covers Persian Gulf service; §§ 3.320, 3.320a and 3.320b are the same Gulf-service family (fine particulate matter and the presumptive conditions), accepted by the committee as defensible answers',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },

  // Quoted phrases — verbatim regulatory language.
  {
    query: '"schedule of ratings"',
    category: 'quoted-phrase',
    expected: [
      '3.321',
      '4.104',
      '4.114',
      '4.116',
      '4.117',
      '4.118',
      '4.119',
      '4.124a',
      '4.130',
      '4.150',
      '4.71a',
      '4.73',
      '4.79',
      '4.87',
      '4.87a',
      '4.88b',
      '4.97',
      'Appendix A to Part 4',
    ],
    rationale:
      'the all-match set for the phrase: every provision whose text carries "schedule of ratings" (18 by product FTS, 18 by LIKE); OPERATOR DECISION 2026-10-23 — all-match policy selected in chat 2026-10-22 and recorded on issue #135, applied to the dev set 2026-10-24',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '"evaluation of hearing impairment"',
    category: 'quoted-phrase',
    expected: ['3.383', '4.85'],
    rationale:
      'the all-match set for the phrase (2 by product FTS, 2 by LIKE); OPERATOR DECISION 2026-10-23 — all-match policy selected in chat 2026-10-22 and recorded on issue #135, applied to the dev set 2026-10-24',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },

  // Ambiguous — more than one provision could be right.
  {
    query: 'special monthly compensation',
    category: 'ambiguous',
    expected: ['3.350'],
    rationale: '§ 3.350 is the SMC rating schedule',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'mental disorders rating schedule',
    category: 'ambiguous',
    expected: ['4.130'],
    rationale: '§ 4.130 is the schedule of ratings for mental disorders',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },

  // Appendices.
  {
    query: 'table of amendments title 38',
    category: 'appendix',
    expected: ['Appendix A to Part 4'],
    rationale: 'Appendix A to Part 4 is the table of amendments',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },

  // No-answer — a real query that should return nothing relevant.
  {
    query: 'veterans dental benefits eligibility',
    category: 'natural-phrasing',
    expected: ['17.161', '17.162', '3.381'],
    rationale:
      'dental treatment IS in Title 38: authorization (17.161), Class II eligibility (17.162) and service connection of dental conditions (3.381). Was mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'military burial allowance rate table',
    category: 'natural-phrasing',
    expected: ['3.1704', '3.1705', '3.1700'],
    rationale:
      'burial benefits ARE in Title 38 Part 3: service-connected (3.1704), non-service-connected (3.1705) and the types of benefit (3.1700). Only the RATE itself is outside the CFR. Was mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'tricare enrollment forms',
    category: 'no-answer',
    expected: [],
    rationale: 'TRICARE enrollment is outside the CFR corpus',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'va loan underwriting guidelines',
    category: 'natural-phrasing',
    expected: ['36.4340', '36.4206'],
    rationale:
      'VA loan underwriting standards ARE in Title 38 Part 36 (36.4340, 36.4206). Was mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
];
