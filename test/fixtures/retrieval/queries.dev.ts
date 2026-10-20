/**
 * DEVELOPMENT query set for the retrieval evaluation (M3).
 *
 * FROZEN: once committed, a change to an entry is a change to the
 * benchmark and must be visible in the diff — never silently edited.
 * The holdout set (queries.holdout.ts) must not be used to tune or pick
 * anything.
 *
 * `adjudication: 'provisional'` means the orchestrator's working
 * expectation — it measures the RETRIEVER, not legal correctness. Only
 * the operator/expert can promote an entry to 'adjudicated'.
 *
 * Expectations are grounded in the 2026-10-16 Title 38 corpus (issue
 * date recorded in the runner's report).
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
  /** 'provisional' = orchestrator's expectation, not expert-adjudicated. */
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
    adjudication: 'provisional',
  },
  {
    query: '3.350',
    category: 'bare-citation',
    expected: ['3.350'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '4.85',
    category: 'bare-citation',
    expected: ['4.85'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '3.504',
    category: 'bare-citation',
    expected: ['3.504'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '4.16',
    category: 'bare-citation',
    expected: ['4.16'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '3.317',
    category: 'bare-citation',
    expected: ['3.317'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },

  // Display citations — the legal form the tool prints.
  {
    query: '38 C.F.R. § 4.130',
    category: 'display-citation',
    expected: ['4.130'],
    rationale: 'the printed display form of the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '38 C.F.R. § 4.85',
    category: 'display-citation',
    expected: ['4.85'],
    rationale: 'the printed display form of the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '38 CFR 3.350',
    category: 'display-citation',
    expected: ['3.350'],
    rationale: 'the undotted full citation',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '§ 3.504',
    category: 'display-citation',
    expected: ['3.504'],
    rationale: 'the section-sign form',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },

  // Abbreviations — the rating-office language.
  {
    query: 'PTSD',
    category: 'abbreviation',
    expected: ['3.304', '3.309', '4.130'],
    rationale:
      'PTSD appears in direct service connection (3.304), presumptive service connection (3.309) and the mental-disorders schedule (4.130)',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'TBI',
    category: 'abbreviation',
    expected: ['4.124a', '3.350'],
    rationale:
      'TBI residuals are rated in the neurological schedule (4.124a); 3.350 covers TBI special monthly compensation',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'SMC',
    category: 'abbreviation',
    expected: ['3.350'],
    rationale: 'special monthly compensation (orchestrator expectation; expert to confirm)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'A&A',
    category: 'abbreviation',
    expected: ['3.352', '3.350'],
    rationale:
      'aid and attendance: the criteria section (3.352) and the ratings section (3.350) — the abbreviation denotes the subject generally, not only parents',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'VA disability rating',
    category: 'abbreviation',
    expected: ['4.130', '4.16'],
    rationale: 'the general rating-schedule sections (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },

  // Natural phrasing — how an adjudicator asks.
  {
    query: 'schizophrenia',
    category: 'natural-phrasing',
    expected: ['4.130'],
    rationale:
      '§ 4.130 is the schedule-of-ratings section for mental disorders incl. schizophrenia (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'how is hearing loss rated',
    category: 'natural-phrasing',
    expected: ['4.85'],
    rationale: '§ 4.85 evaluates hearing impairment (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'aid and attendance for a parent',
    category: 'natural-phrasing',
    expected: ['3.504'],
    rationale: '§ 3.504 rates aid and attendance for parents (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'total disability rating based on unemployability',
    category: 'natural-phrasing',
    expected: ['4.16'],
    rationale: '§ 4.16 is the general total-rating formula (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'traumatic brain injury compensation',
    category: 'natural-phrasing',
    expected: ['4.124a'],
    rationale:
      'TBI residuals are rated in the neurological schedule (4.124a); 3.350 is special monthly compensation, not the rating itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'Persian Gulf veterans compensation',
    category: 'natural-phrasing',
    expected: ['3.317'],
    rationale: '§ 3.317 covers Persian Gulf service (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },

  // Quoted phrases — verbatim regulatory language.
  {
    query: '"schedule of ratings"',
    category: 'quoted-phrase',
    expected: ['4.130'],
    rationale: 'the literal heading phrase of the mental-disorders schedule (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '"evaluation of hearing impairment"',
    category: 'quoted-phrase',
    expected: ['4.85'],
    rationale: 'the literal heading phrase of § 4.85 (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },

  // Ambiguous — more than one provision could be right.
  {
    query: 'special monthly compensation',
    category: 'ambiguous',
    expected: ['3.350'],
    rationale: '§ 3.350 is the SMC rating schedule (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'mental disorders rating schedule',
    category: 'ambiguous',
    expected: ['4.130'],
    rationale: '§ 4.130 is the schedule of ratings for mental disorders (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },

  // Appendices.
  {
    query: 'table of amendments title 38',
    category: 'appendix',
    expected: ['Appendix A to Part 4'],
    rationale: 'Appendix A to Part 4 is the table of amendments (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },

  // No-answer — a real query that should return nothing relevant.
  {
    query: 'veterans dental benefits eligibility',
    category: 'natural-phrasing',
    expected: ['17.161', '17.162'],
    rationale:
      'CORRECTED: dental treatment IS in Title 38 — authorization (17.161) and Class II eligibility (17.162). Mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'military burial allowance rate table',
    category: 'natural-phrasing',
    expected: ['3.1700', '3.1704', '3.1705'],
    rationale:
      'CORRECTED: burial benefits ARE in Title 38 Part 3 — types (3.1700), service-connected (3.1704) and non-service-connected (3.1705). Mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'tricare enrollment forms',
    category: 'no-answer',
    expected: [],
    rationale: 'TRICARE enrollment is outside the CFR corpus (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'va loan underwriting guidelines',
    category: 'natural-phrasing',
    expected: ['36.4340', '36.4206'],
    rationale:
      'CORRECTED: VA loan underwriting standards ARE in Title 38 Part 36 (36.4340, 36.4206). Mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
];
