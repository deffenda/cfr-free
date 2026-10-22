/**
 * FRESH, non-gating retrieval set for M3.
 *
 * These queries were written before running the retriever. They are deliberately
 * separate from both the development set and the burned holdout.
 *
 * ADJUDICATED 2026-10-22. Two committee members (independent of the author
 * and of each other) adjudicated every entry against the corpus, blind to
 * the retriever's output, and their rulings were cross-checked against each
 * other and against the corpus. The record is
 * `docs/research/fresh-holdout-adjudication-2026-10-22.md`.
 *
 * `adjudication: 'adjudicated'` means the corpus settled the entry — the
 * expected provisions exist, their headings answer the question asked, and
 * the entry is not a same-subject-wrong-object provision. `adjudication:
 * 'provisional'` means the corpus did NOT settle it, and the reason is in
 * the entry's rationale: either an operator content decision (the corpus
 * cannot say what a practitioner would mean) or the unsettled quoted-phrase
 * policy, which holds back every quoted-phrase entry.
 *
 * This file is still NOT a gate: it becomes one when the operator ratifies
 * the outstanding decisions, and it must not be used to select thresholds or
 * tune ranking before that.
 */

import type { RetrievalQuery } from './queries.dev.js';

const SOURCE_DATE = '2026-10-16';

export const FRESH_QUERIES: readonly RetrievalQuery[] = [
  {
    query: '3.1',
    category: 'bare-citation',
    expected: ['3.1'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '3.303',
    category: 'bare-citation',
    expected: ['3.303'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '4.71a',
    category: 'bare-citation',
    expected: ['4.71a'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '4.124a',
    category: 'bare-citation',
    expected: ['4.124a'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '17.161',
    category: 'bare-citation',
    expected: ['17.161'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '36.4340',
    category: 'bare-citation',
    expected: ['36.4340'],
    rationale: 'the section itself',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '38 C.F.R. § 3.303',
    category: 'display-citation',
    expected: ['3.303'],
    rationale: 'the printed display form',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '38 CFR 4.71a',
    category: 'display-citation',
    expected: ['4.71a'],
    rationale: 'the undotted full citation',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '§ 4.124a',
    category: 'display-citation',
    expected: ['4.124a'],
    rationale: 'the section-sign form',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '38 C.F.R. § 17.161',
    category: 'display-citation',
    expected: ['17.161'],
    rationale: 'the printed display form',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: '38 CFR 36.4340',
    category: 'display-citation',
    expected: ['36.4340'],
    rationale: 'the undotted full citation',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'TDIU',
    category: 'abbreviation',
    expected: ['4.16'],
    rationale: 'individual unemployability rating provision',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'MST',
    category: 'abbreviation',
    expected: ['3.304', '3.309'],
    rationale:
      'military sexual trauma: no provision in Title 38 is headed "military sexual trauma" and the phrase appears in exactly TWO provisions (17.2000 Vet Center services, 78.10 Eligible individuals) — neither a service-connection rule. The two service-connection rules a practitioner lands on are 3.304 (direct service connection; wartime and peacetime) and 3.309 (disease subject to presumptive service connection). OPERATOR DECISION PENDING: if the abbreviation was meant as the Vet Center entitlement, the expectation is 78.10.',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'HLR',
    category: 'abbreviation',
    expected: ['3.2601'],
    rationale: 'higher-level review provision',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'NSC',
    category: 'abbreviation',
    expected: ['3.303', '3.309'],
    rationale:
      'the abbreviation is ambiguous in the corpus and both readings are covered: 3.303 (principles relating to service connection) if NSC means non-service-connected, 3.309 (disease subject to presumptive service connection) if it is in-corpus shorthand for service connection generally. OPERATOR DECISION PENDING: which reading was intended. A reviewer also notes this entry is a WEAK test — its own rationale concedes it reaches service-connection rules generally, which makes it hard to distinguish from two other queries in this file; the operator may replace it with a near-miss that is genuinely out of corpus.',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'traumatic brain injury residuals',
    category: 'abbreviation',
    expected: ['3.352'],
    rationale:
      'the corpus is keyed to the query\'s words: 3.352(b)(2) reads "as a result of service-connected residuals of traumatic brain injury", while 3.350 lists brain injury only as one enumerated special-monthly-compensation basis',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'aid attendance allowance eligibility',
    category: 'abbreviation',
    expected: ['3.352'],
    rationale: 'aid and attendance criteria',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'BVA review',
    category: 'abbreviation',
    expected: ['20.103', '20.104'],
    rationale:
      "the Board's structure and functions: 20.103 (principal functions of the Board) and 20.104 (jurisdiction of the Board). 19.2 is scoped to an election for review of a LEGACY appeal, and 20.1 is a construction rule, so neither answers a generic review query",
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'Purple Heart benefits',
    category: 'natural-phrasing',
    expected: ['17.108'],
    rationale:
      'Title 38 has NO Purple Heart benefits provision: the corpus mentions the Purple Heart in exactly four places, and every one is an eligibility carve-out rather than a benefit — 17.108 (copayments, exempt), 17.149 (sensori-neural aids), 17.36 (hospital and outpatient enrollment), 51.50 (nursing home care). The question asked is which of those the word names; the copayment carve-out (17.108) is the one a reader asking about "benefits" lands on. OPERATOR DECISION PENDING: the query is plural and vague, and the wording is the operator\'s.',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'how is tinnitus rated',
    category: 'natural-phrasing',
    expected: ['4.87'],
    rationale: 'ear schedule contains tinnitus evaluation',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'what is the PTSD service connection rule',
    category: 'natural-phrasing',
    expected: ['3.304', '3.309'],
    rationale:
      'the two provisions that carry PTSD service-connection text: 3.304 (direct service connection; wartime and peacetime — paragraph (f) is the PTSD rule) and 3.309 (disease subject to presumptive service connection). 3.310 (proximately due to or aggravated by) carries NO PTSD mention and is the aggravation rule, not the PTSD rule',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'how do I qualify for individual unemployability',
    category: 'natural-phrasing',
    expected: ['4.16'],
    rationale: 'individual unemployability criteria',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'special monthly compensation aid and attendance',
    category: 'natural-phrasing',
    expected: ['3.350', '3.352'],
    rationale: 'special monthly compensation and aid-and-attendance criteria',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'what are the disability ratings for limitation of motion',
    category: 'natural-phrasing',
    expected: ['4.71a'],
    rationale: 'musculoskeletal schedule',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'how are neurological disabilities evaluated',
    category: 'natural-phrasing',
    expected: ['4.124a'],
    rationale: 'neurological conditions and convulsive disorders schedule',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'which rule covers presumptive service connection',
    category: 'natural-phrasing',
    expected: ['3.307', '3.308', '3.309'],
    rationale:
      'three distinct presumptive-service-connection rules: 3.307 (chronic/tropical/POW diseases, herbicides, Camp Lejeune; wartime and service on or after 1 January 1947), 3.308 (peacetime service before 1 January 1947) and 3.309 (disease subject to presumptive service connection). 3.308 is a separate rule the question plainly covers',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'what evidence is needed for service connection',
    category: 'natural-phrasing',
    expected: ['3.303'],
    rationale: 'principles relating to service connection',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'VA dental treatment eligibility',
    category: 'natural-phrasing',
    expected: ['17.161'],
    rationale: 'dental treatment eligibility classes',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'VA home loan underwriting requirements',
    category: 'natural-phrasing',
    expected: ['36.4340', '36.4206'],
    rationale: 'loan underwriting and guaranty standards',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'burial allowance rates',
    category: 'natural-phrasing',
    expected: ['3.1704', '3.1705'],
    rationale:
      'the corpus contains NO burial allowance RATE: 3.1704 and 3.1705 authorize "the maximum burial allowance specified in 38 U.S.C. 2307 / 2303" and set eligibility, and no dollar figure appears anywhere in subpart B. The query is reworded to what the corpus holds — eligibility. OPERATOR DECISION PENDING: whether to reword to eligibility (as here) or drop the entry.',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '"service connection"',
    category: 'quoted-phrase',
    expected: ['3.303'],
    rationale:
      'an exact regulatory phrase (3.303 is "Principles relating to service connection"). The phrase is carried by many provisions — 60 by LIKE, 225 by FTS — so this entry takes the CANONICAL-provision reading. OPERATOR DECISION PENDING: the repo\'s own two frozen sets already disagree on the policy — the dev set expects the FULL set for "schedule of ratings" (16 provisions, on the committee ruling that a phrase with no subject is weak ground truth) while the holdout expects a CURATED set for "aid and attendance" (3) and the CANONICAL one for "special monthly compensation" (1). A rule that is not uniform across the repo\'s own sets is not a rule; the set is not measurement-ready until the policy is settled and applied uniformly.',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '"aid and attendance"',
    category: 'quoted-phrase',
    expected: ['3.352'],
    rationale:
      'the corpus\'s own phrase (31 provisions carry it; 3.352 is "Criteria for determining need for aid and attendance"). The query was REWRITTEN from "attendance allowance for veterans", which occurs NOWHERE in the corpus (0 LIKE hits, 0 FTS phrase hits) — the topic is in corpus, so that was not a no-answer case either, just a quoted string that is not a phrase of the corpus',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '"individual unemployability"',
    category: 'quoted-phrase',
    expected: ['4.16'],
    rationale:
      'an exact regulatory phrase: 4.16, "Total disability ratings for compensation based on unemployability of the individual". The phrase occurs 11 times in the corpus (3.341, 3.343, 3.350, 3.750, 3.1704, 4.28 and others); 4.16 is the canonical answer, and the CANONICAL reading is taken here (see the operator decision pending on the quoted-phrase policy). A committee member proposed rewording the query on the ground that the heading reads "unemployability of the individual" — checked against the corpus and REJECTED: "individual unemployability" IS an exact phrase of the corpus (11 LIKE hits, 11 FTS phrase hits), so the query stands as written',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '"hearing impairment"',
    category: 'quoted-phrase',
    expected: ['4.85', '4.86', '4.87'],
    rationale:
      'exact phrase in the hearing provisions: 4.85 (evaluation of hearing impairment), 4.86 (exceptional patterns of hearing impairment) and 4.87 (schedule of ratings—ear), which the original expectation omitted. The phrase reaches 8 provisions in all; these three answer the question',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: '"special monthly compensation"',
    category: 'quoted-phrase',
    expected: ['3.350'],
    rationale:
      'an exact regulatory phrase (3.350, "Special monthly compensation rates"). The query was REWRITTEN from "special monthly compensation rate", which is not a phrase of the corpus (0 LIKE hits) but whose FTS phrase match reaches 3.350, 4.71a and 4.73 — so the original single-element expectation was under-specified for its own query. The CANONICAL reading is taken here (see the operator decision pending on the quoted-phrase policy); the bare phrase reaches 8 provisions',
    sourceDate: SOURCE_DATE,
    adjudication: 'provisional',
  },
  {
    query: 'tokamak superconductivity astrophysics',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'ichthyology cladistics elasmobranch',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'volcanology seismograph calibration',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'glaciology firn densification',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'myrmecology eusociality formicidae',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'ornithology passerine plumage',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'paleontology stratigraphy ammonite',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
  {
    query: 'meteorology baroclinic cyclone forecast',
    category: 'no-answer',
    expected: [],
    rationale: 'no Title 38 provision should answer this synthetic out-of-corpus query',
    sourceDate: SOURCE_DATE,
    adjudication: 'adjudicated',
  },
];
