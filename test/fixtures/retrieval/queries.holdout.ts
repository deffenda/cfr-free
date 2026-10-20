/**
 * HOLDOUT query set for the retrieval evaluation (M3).
 *
 * FROZEN, and SEPARATE from the development set on purpose: do not tune
 * on it, do not use it to pick a change, and do not read it while
 * iterating on the retriever. Its job is to say whether a change that was
 * developed against the dev set GENERALIZES.
 *
 * `adjudication: 'provisional'` = the orchestrator's working expectation;
 * it measures the RETRIEVER, not legal correctness.
 */

import type { RetrievalQuery } from './queries.dev.js';

const SOURCE_DATE = '2026-10-16';

export const HOLDOUT_QUERIES: readonly RetrievalQuery[] = [
  {
    query: '3.301',
    category: 'bare-citation',
    expected: ['3.301'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '4.29',
    category: 'bare-citation',
    expected: ['4.29'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '38 C.F.R. § 3.350',
    category: 'display-citation',
    expected: ['3.350'],
    rationale: 'the printed display form',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '38 CFR 4.85',
    category: 'display-citation',
    expected: ['4.85'],
    rationale: 'the undotted full citation',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '§ 4.16',
    category: 'display-citation',
    expected: ['4.16'],
    rationale: 'the section-sign form',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'DIC',
    category: 'abbreviation',
    expected: ['3.5', '3.10', '3.25'],
    rationale:
      'dependency and indemnity compensation: the DIC section (3.5), the surviving-spouse rate (3.10) and parents DIC (3.25) — NOT the pension sections 3.17/3.18/3.26 (3.18 is not in the corpus at all)',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'BVA',
    category: 'abbreviation',
    expected: [],
    rationale:
      'the Board of Veterans Appeals is not a CFR provision; a no-answer case (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'NVL',
    category: 'abbreviation',
    expected: [],
    rationale:
      'neurovesical? an unclear abbreviation that should not confidently return a provision (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'veteran with a mental disorder rating',
    category: 'natural-phrasing',
    expected: ['4.130'],
    rationale:
      'the mental-disorders rating schedule (4.130); the TDIU formula (4.16) is not implied by the query',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'how much compensation for loss of use of a hand',
    category: 'natural-phrasing',
    expected: ['4.63'],
    rationale: 'loss of use of hand or foot (4.63)',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'rating for service-connected tinnitus',
    category: 'natural-phrasing',
    expected: ['4.87'],
    rationale:
      'tinnitus is rated in the ear schedule (4.87, DC 6260) — NOT the mental-disorders schedule',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '"aid and attendance"',
    category: 'quoted-phrase',
    expected: ['3.504'],
    rationale: 'the literal phrase (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '"special monthly compensation"',
    category: 'quoted-phrase',
    expected: ['3.350'],
    rationale: 'the literal phrase (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'respiratory',
    category: 'ambiguous',
    expected: ['4.96', '4.97'],
    rationale: 'respiratory evaluation (4.96) and the respiratory rating schedule (4.97)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'dependency',
    category: 'ambiguous',
    expected: ['3.17'],
    rationale: 'the dependency and indemnity compensation chapter (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'Appendix B to Part 4',
    category: 'appendix',
    expected: ['Appendix B to Part 4'],
    rationale: 'the appendix itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'which appendices list amendments',
    category: 'appendix',
    expected: ['Appendix A to Part 4'],
    rationale: 'the table-of-amendments appendix (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'va mortgage rates',
    category: 'natural-phrasing',
    expected: ['36.4212', '36.4312'],
    rationale:
      'CORRECTED: VA mortgage interest rates ARE in Title 38 Part 36 (36.4212, 36.4312). Mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'sf-8 form',
    category: 'no-answer',
    expected: [],
    rationale: 'a VA form number is not a provision; a no-answer case (provisional)',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'purple heart recipients',
    category: 'natural-phrasing',
    expected: ['17.36', '51.50', '17.149'],
    rationale:
      'CORRECTED: Purple Heart provisions ARE in Title 38 (enrollment 17.36, nursing-home care 51.50, sensori-neural aids 17.149). Mis-specified as a no-answer case.',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
];
