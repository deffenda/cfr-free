# Expectation adjudication — the ORDER of the 39 provisional entries, and the sibling-addition proposals

**Date:** 2026-10-21. **Status:** provisional throughout. This document
**records** two things and **proposes** a third. It changes no metric, edits no
frozen set, and ships no code.

1. The **ORDER** of the 39 provisional expectations, as two committee members
   independently ordered them, cross-checked against each other and against the
   corpus. One disagreement, one ruling.
2. The **sibling-addition proposals** that fall out of measuring the top-hit
   gap: twelve of the thirteen "the expected provision is in the top five but
   not first" cases have a rank-1 hit that is a _defensible sibling_ — a real
   provision on the same subject as the expected one. Proposing those siblings
   as acceptable answers is an **operator content decision**, not an
   engineering one.
3. The **proposal** that follows: if the operator accepts the siblings, the
   measured top-1 rate changes from 29/46 to 41/46 (or 43/46 on the wider
   reading below), and the property being measured changes from "the top hit
   is an expected citation" to "the top hit is a defensible answer" — which is
   the property a client that quotes the top hit actually needs.

**The order adjudication changes no metric.** The runner's exact-citation test
is `entry.expected.includes(top5[0])` (`test/fixtures/retrieval/run.ts:110`) —
a membership test, not a comparison of the first element. Reordering a set
cannot change it. The order matters for a different reason: it is what tells
the practitioner study (M6) which of two co-equal provisions the retriever was
_supposed_ to lead with, and it is what separates the real ranking failures
from the committee's ranking preferences. Say that plainly rather than
implying the gap shrank: **it did not, and it cannot, from a reordering.**

**Nothing in the frozen set was edited.** `test/fixtures/retrieval/queries.dev.ts`
and `queries.holdout.ts` are byte-for-byte as committed; the evaluation runner
is unchanged; no `expected` set was touched. This round produced one new file
and one amended roadmap row.

## 1. Provenance and how to reproduce

|                |                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus         | `~/.cfr-free/index.sqlite`, issue date **2026-10-16** (`meta.issue_date`)                                                                       |
| Corpus size    | **2 970** provisions = 2 953 sections + 17 appendices (`meta.sections_count`, `meta.appendices_count`; `SELECT COUNT(*) FROM sections` = 2 970) |
| Part structure | `meta.structure_json` (used below for the Part-9 finding)                                                                                       |
| Measurement    | the repo's own runner, `test/fixtures/retrieval/run.ts`, against a **copy** of the index                                                        |
| Provenance     | darwin 25.6.0 arm64, node v26.11.1, 8 cpus, 24 576 MB                                                                                           |

The live index is **read-only** and was never queried in place:

```bash
cp ~/.cfr-free/index.sqlite /tmp/eval-index.sqlite   # never run against the live index
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts dev
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts holdout
```

The runner is offline and deterministic apart from the measured latencies;
both sets were run twice and the top-5 lists were identical. The measured
baseline, reproduced here so every number below has a receipt:

| Set      | queries | answerable | exact-citation (top hit expected) | recall@5  | MRR    | no-answer violations |
| -------- | ------- | ---------- | --------------------------------- | --------- | ------ | -------------------- |
| dev      | 30      | 29         | **17/29**                         | 28/29     | 0.7529 | 1/1                  |
| holdout  | 20      | 17         | **12/17**                         | 14/17     | 0.7549 | 2/3                  |
| **both** | 50      | **46**     | **29/46**                         | **42/46** | —      | 3/4                  |

**Burn disclosure.** The holdout was read and adjudicated on 2026-10-21 and is
**burned for threshold selection** (see ROADMAP, "The holdout's status"). This
round read it again, because the sibling proposals can only be measured against
the full 46 answerable queries. No retriever change ships here, no threshold
was chosen, and no expected set was modified — but the fact is on the record:
**any threshold drawn from these numbers is drawn on a burned set.** The fresh
holdout required before the first threshold-bearing round is still required.

## 2. The frozen set: what is provisional, and how it divides

Recomputed from the two fixture files (not from a report):

|                   | dev    | holdout | total  |
| ----------------- | ------ | ------- | ------ |
| entries           | 30     | 20      | 50     |
| `adjudicated`     | 5      | 6       | 11     |
| **`provisional`** | **25** | **14**  | **39** |

The 39 provisional entries divide as:

- **31** single-member — the expected set is one provision, so its order is
  not a decision; the ORDER of a one-element set is fixed.
- **4** multi-member — the only entries where an order is a decision:
  `TBI` (3 members), `VA disability rating` (2), `traumatic brain injury
compensation` (2), `respiratory` (2).
- **4** no-answer — empty expected sets: `tricare enrollment forms` (dev),
  `BVA`, `NVL`, `sf-8 form` (holdout). These are the only four empty sets in
  the whole 50, and an empty set has no order.

35 of the 39 are answerable. The CONTENT of all 39 was adjudicated by an
earlier committee round (M3-c, `65c8b3c`); the **ORDER** was not. This
document closes the ORDER, provisionally, and proposes the sibling additions
that the measurement suggests.

## 3. The four multi-member sets: the agreed orders

Two committee members (free-tier models, independent of the implementer)
ordered each of the four multi-member provisional sets independently, then
cross-checked against each other and against the corpus. **They agreed on 38
of the 39 entries** — which includes all 31 single-member and all 4 no-answer
entries, where no ordering was possible, and three of the four multi-member
entries. **Neither member flagged any expected member as not belonging**: no
proposed citation was rejected, so every expected set stays as it is.

| query                                 | agreed order                      | the criterion both members used                                                                                                                                                 | confidence (A / B) |
| ------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `TBI`                                 | 4.124a, 3.350, 3.310              | operative rating schedule first — § 4.124a's text carries DC 8045 "Residuals of traumatic brain injury (TBI)" — then payable compensation, then entitlement                     | medium / medium    |
| `VA disability rating`                | 4.1, 4.15                         | general/scheduling provision before the narrower: § 4.1 "Essentials of evaluative rating." before § 4.15 "Total disability ratings."                                            | medium / high      |
| `traumatic brain injury compensation` | 3.350, 4.124a                     | the provision whose heading states the rule the query names ("compensation" → § 3.350 "Special monthly compensation ratings.") before the schedule that computes the base award | medium / medium    |
| `respiratory`                         | **4.97, 4.96** (flipped — see §4) | operative scheduling provision before the special evaluation mechanics                                                                                                          | medium / medium    |

Corpus receipts for the four decisions: § 4.124a "Schedule of ratings—
neurological conditions and convulsive disorders." (its text contains
"8045 Residuals of traumatic brain injury (TBI):"); § 3.350 "Special monthly
compensation ratings."; § 3.310 "Disabilities that are proximately due to, or
aggravated by, service-connected disease or injury."; § 4.1 "Essentials of
evaluative rating."; § 4.15 "Total disability ratings."; § 4.97 "Schedule of
ratings—respiratory system."; § 4.96 "Special provisions regarding evaluation
of respiratory conditions."

## 4. The one disagreement, and the ruling

The single difference between the two members was the order of `respiratory`:

- **Member A** kept `4.96, 4.97`, calling the two "genuinely co-equal".
- **Member B** flipped to `4.97, 4.96`.

**Ruling: accept B's flip** — the operative scheduling provision (§ 4.97,
"Schedule of ratings—respiratory system.") first, and the special evaluation
mechanics (§ 4.96, "Special provisions regarding evaluation of respiratory
conditions.") second. The criterion is the same one that puts § 4.124a first
for the bare query `TBI`: where a query can be answered by a rating schedule
and also by a provision that governs how a schedule is applied, the schedule
is the answer and the mechanics are the gloss. **A's co-equal note is
recorded** and is the reason this entry remains on the close-call list (§5):
the corpus shows both sections are about respiratory conditions, and nothing in
the corpus itself ranks them.

The ruling changes no measurement. The measured top five for `respiratory` is
`4.96, 4.97, 17.3210, 4.16, 17.3230` — § 4.96 is the top hit either way, so
the query already counts as an exact-citation success and its reciprocal rank
is 1.0 under either ordering.

**Both members' orderings are provisional.** The operator's expert
adjudication is still the authority; this round produced evidence for that
adjudication, not a substitute for it. The close-call list in §5 is where to
start.

## 5. The close calls a human expert should check first

Ordered by how much a practitioner's answer would change, not by committee
confidence.

1. **`TBI` — is § 3.350 or the TBI-specific § 3.310(d) second?** The agreed
   order is 4.124a, 3.350, 3.310. Two corpus facts bear on it. First, § 3.310
   is not a generic aggravation provision: its paragraph (d) is headed
   **"Traumatic brain injury."** and sets out what is held to be the proximate
   result of a service-connected TBI. Second, § 3.350 is not a bare
   compensation section but **"Special monthly compensation ratings."** — a
   rating schedule in its own right, so "the operative schedule first" does
   not by itself separate 3.350 from 3.310. A practitioner asking about TBI
   compensation may need 3.310(d)'s proximate-result list and 3.350's
   entitlement, and 4.124a alone does not give them either.
2. **`traumatic brain injury compensation` — § 3.350 vs § 4.124a, arguably
   co-equal.** The members split on the heading test ("compensation" → 3.350)
   versus the base-award test (4.124a is what computes the award). Both
   members rated their own case medium confidence.
3. **`respiratory` — § 4.96's "evaluation" framing vs § 4.97's schedule.** The
   ruling is recorded; the co-equal note is the reason to re-check it. If
   the expert disagrees, the top hit for this query is § 4.96 either way, so
   the disagreement is about interpretation, not measurement.
4. **`VA disability rating` — § 4.1 is not even in the current top five.**
   The measured top five is `4.15, 4.88b, 3.22, 3.10, 3.327`: § 4.15 is
   first (and so the query counts as an exact-citation success), and § 4.1
   "Essentials of evaluative rating." does not appear at all. The expectation
   keeps § 4.1 first on the general-before-narrow principle; the retrieval
   does not find it. That gap is a retrieval fact, not a disagreement between
   the members.
5. **`"schedule of ratings"` — § 4.130 against § 4.87 / § 4.87a / § 4.97 /
   § 4.124a.** The query is a bare quoted phrase with no subject, and the
   corpus answers that **sixteen** sections carry a heading beginning
   "Schedule of ratings": 4.71a, 4.73, 4.79, 4.87, 4.87a, 4.88b, 4.97, 4.104,
   4.114, 4.116, 4.117, 4.118, 4.119, 4.124a, 4.130, 4.150. A single-section
   expectation for a phrase that names sixteen schedules is a weak ground
   truth, and this is a case where the honest answer is a set.
6. **`how is hearing loss rated` — § 4.86 is retrieved first, but § 4.85 is
   the general evaluation.** § 4.85 "Evaluation of hearing impairment." is the
   general rule; § 4.86 "Exceptional patterns of hearing impairment." is the
   exception to it. A practitioner asking "how is hearing loss rated" is
   asking for the general rule, so the retrieved order is a ranking
   imperfection rather than a co-equal answer. This one is in the sibling
   table below, with that caveat attached.

## 6. The measurement: how the 46 answerable queries decompose

Measured on the frozen 50 against the 2026-10-16 corpus:

|                                                               | count  | share |
| ------------------------------------------------------------- | ------ | ----- |
| answerable queries                                            | 46     | —     |
| the top hit **is** an expected citation                       | **29** | 63 %  |
| an expected provision is in the top five but **not first**    | **13** | —     |
| no expected provision is in the top five (**recall failure**) | **4**  | —     |

29 + 13 + 4 = 46. The "63 % top-1" figure therefore does not mean 63 % of
answerable questions are answered correctly. For thirteen of the queries the
answer is _in the window_ and something else is on top. Whether that is a
ranking failure or a difference of opinion about which of two co-equal
provisions should lead is exactly the question the ORDER adjudication
addresses, and exactly the question the sibling proposals below answer with
corpus evidence.

### 6.1 The thirteen in-window-but-not-first cases

Each row is the measured rank-1 hit and the corpus heading of that hit, checked
against the corpus by hand.

| query                                              | set     | rank-1 hit (measured) | expected provision     | the retrieved section's corpus heading                                                        | sibling?                 |
| -------------------------------------------------- | ------- | --------------------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| `SMC`                                              | dev     | 17.151                | 3.350                  | Invalid lifts for recipients of aid and attendance allowance or special monthly compensation. | yes (weak)               |
| `special monthly compensation`                     | dev     | 17.151                | 3.350                  | Invalid lifts for recipients of aid and attendance allowance or special monthly compensation. | yes (weak)               |
| `"special monthly compensation"`                   | holdout | 17.151                | 3.350                  | Invalid lifts for recipients of aid and attendance allowance or special monthly compensation. | yes (weak)               |
| `schizophrenia`                                    | dev     | 3.384                 | 4.130                  | Psychosis.                                                                                    | yes                      |
| `how is hearing loss rated`                        | dev     | 4.86                  | 4.85                   | Exceptional patterns of hearing impairment.                                                   | yes (but see §5, item 6) |
| `total disability rating based on unemployability` | dev     | 4.17                  | 4.16                   | Total disability ratings for pension based on unemployability and age of the individual.      | yes                      |
| `Persian Gulf veterans compensation`               | dev     | 3.320                 | 3.317                  | Claims based on exposure to fine particulate matter.                                          | yes                      |
| `"schedule of ratings"`                            | dev     | 4.87a                 | 4.130                  | Schedule of ratings—other sense organs.                                                       | yes                      |
| `veterans dental benefits eligibility`             | dev     | 17.160                | 17.161, 17.162, 3.381  | Authorization of dental examinations.                                                         | yes                      |
| `military burial allowance rate table`             | dev     | 3.1701                | 3.1704, 3.1705, 3.1700 | Deceased veterans for whom VA may provide burial benefits.                                    | yes                      |
| `va loan underwriting guidelines`                  | dev     | 36.4225               | 36.4340, 36.4206       | Authority to close manufactured home loans on the automatic basis.                            | yes                      |
| `DIC`                                              | holdout | 3.455                 | 3.5, 3.10, 3.25        | Apportionment of a surviving spouse's dependency and indemnity compensation.                  | yes                      |
| `traumatic brain injury compensation`              | dev     | 9.21                  | 3.350, 4.124a          | Schedule of Losses.                                                                           | **no — see §7**          |

**Twelve of the thirteen** have a rank-1 hit that (a) exists in the corpus,
(b) sits in the same subject area as the expected provision, and (c) is a
provision a practitioner could reasonably be given. The thirteenth is the
genuine failure.

Two corrections to the record as first drafted, both corpus-checked:

- The rank-1 hit for `dependency and indemnity compensation` is **§ 3.658
  "Offsets; dependency and indemnity compensation."**, not § 3.351. § 3.351
  ("Special monthly dependency and indemnity compensation, death compensation,
  pension and spouse's compensation ratings.") does not appear in that query's
  top five at all. The measured top five is `3.658, 3.702, 3.455, 21.3023,
3.251`; § 3.702 is headed "Dependency and indemnity compensation." and §
  3.455 is "Apportionment of a surviving spouse's dependency and indemnity
  compensation." All three are genuine DIC provisions, so the _proposal_ is
  unaffected — but the section number was wrong.
- The heading of § 36.4225 is "Authority to close manufactured home loans on
  the **automatic basis**." (not "automatic-banking").

### 6.2 The four recall failures

The expected provision is absent from the top five in **four** of the 46
answerable queries, not three:

| query                                   | set     | expected             | measured top five                    |
| --------------------------------------- | ------- | -------------------- | ------------------------------------ |
| `table of amendments title 38`          | dev     | Appendix A to Part 4 | 8.11, 38.603, 3.317, 4.124a, 36.4322 |
| `which appendices list amendments`      | holdout | Appendix A to Part 4 | 50.3, 26.41, 26.40, 1.519, 42.22     |
| `veteran with a mental disorder rating` | holdout | 4.130                | 4.126, 4.129, 4.125, 3.344, 4.124a   |
| `dependency and indemnity compensation` | holdout | 3.5, 3.10, 3.25      | 3.658, 3.702, 3.455, 21.3023, 3.251  |

The corpus holds "Appendix A to Part 4" — "Table of Amendments and Effective
Dates Since 1946" — so the first two are vocabulary failures, not corpus
absences. The third and fourth are the two cases whose rank-1 hit is on the
right subject: § 4.126 "Evaluation of disability from mental disorders." for
the mental-disorders schedule, and § 3.658 for DIC. Those two are therefore
also sibling proposals (§6.3), and are the reason the table in §6.3 is wider
than the thirteen in §6.1.

### 6.3 The sibling-addition proposals

**This is the substantive finding of this round, and it is an operator content
decision.** The proposal is: for each of the fourteen queries below, add the
measured rank-1 hit to the entry's `expected` set, so that a retrieval which
leads with that section counts as answering the question.

| query                                              | set     | add     | expected today         | corpus heading of the added section                                                           | same subject as the expected provision?                          |
| -------------------------------------------------- | ------- | ------- | ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `SMC`                                              | dev     | 17.151  | 3.350                  | Invalid lifts for recipients of aid and attendance allowance or special monthly compensation. | yes — names SMC                                                  |
| `special monthly compensation`                     | dev     | 17.151  | 3.350                  | Invalid lifts for recipients of aid and attendance allowance or special monthly compensation. | yes — names SMC                                                  |
| `"special monthly compensation"`                   | holdout | 17.151  | 3.350                  | Invalid lifts for recipients of aid and attendance allowance or special monthly compensation. | yes — names SMC                                                  |
| `schizophrenia`                                    | dev     | 3.384   | 4.130                  | Psychosis.                                                                                    | yes — VA's mental-disorders criteria                             |
| `how is hearing loss rated`                        | dev     | 4.86    | 4.85                   | Exceptional patterns of hearing impairment.                                                   | yes — but it is the _exception_ to the general rule (§5, item 6) |
| `total disability rating based on unemployability` | dev     | 4.17    | 4.16                   | Total disability ratings for pension based on unemployability and age of the individual.      | yes — the pension half of the same formula pair                  |
| `Persian Gulf veterans compensation`               | dev     | 3.320   | 3.317                  | Claims based on exposure to fine particulate matter.                                          | yes — the same Gulf-service family                               |
| `"schedule of ratings"`                            | dev     | 4.87a   | 4.130                  | Schedule of ratings—other sense organs.                                                       | yes — same "Schedule of ratings" heading family                  |
| `veterans dental benefits eligibility`             | dev     | 17.160  | 17.161, 17.162, 3.381  | Authorization of dental examinations.                                                         | yes — the dental-benefit authorization pair                      |
| `military burial allowance rate table`             | dev     | 3.1701  | 3.1704, 3.1705, 3.1700 | Deceased veterans for whom VA may provide burial benefits.                                    | yes — the burial-benefit set                                     |
| `va loan underwriting guidelines`                  | dev     | 36.4225 | 36.4340, 36.4206       | Authority to close manufactured home loans on the automatic basis.                            | yes — Part 36 loan-guaranty                                      |
| `DIC`                                              | holdout | 3.455   | 3.5, 3.10, 3.25        | Apportionment of a surviving spouse's dependency and indemnity compensation.                  | yes — names DIC                                                  |
| `veteran with a mental disorder rating`            | holdout | 4.126   | 4.130                  | Evaluation of disability from mental disorders.                                               | yes — Part 4 mental disorders                                    |
| `dependency and indemnity compensation`            | holdout | 3.658   | 3.5, 3.10, 3.25        | Offsets; dependency and indemnity compensation.                                               | yes — names DIC                                                  |

Two of the fourteen are the weakest, and the operator should decide them
explicitly rather than inherit them:

- **§ 17.151 (three queries).** It names "special monthly compensation"
  verbatim and is a real provision, but it governs _invalid lifts_ for
  recipients. A practitioner asking about special monthly compensation is
  asking for the rating schedule (§ 3.350). Adding 17.151 to the expected set
  would make "the retriever led with the lifts provision" a success. The
  three queries that would benefit (`SMC`, `special monthly compensation`,
  `"special monthly compensation"`) are the ones where the abbreviation
  expansion is weakest, which is a separate problem with a separate fix.
- **§ 4.86 for `how is hearing loss rated`.** The retrieved section is the
  exceptional-patterns exception; the expected section is the general
  evaluation. Accepting the sibling would bless a ranking that a practitioner
  would call wrong.

## 7. The one genuine ranking failure

For `traumatic brain injury compensation` the measured top five is:

    9.21, 3.352, 3.350, 4.124a, 4.71a

The top hit is **§ 9.21 "Schedule of Losses."** This is the clearest genuine
failure in the set, and the corpus says precisely why — in a way that sharpens
rather than softens it.

**Correction to the earlier characterisation of this hit.** It was described as
"about dependency/death compensation, not traumatic brain injury". The corpus
contradicts both halves of that:

- § 9.21 is **not** about dependency or death compensation. It sits in
  **Part 9 — "Servicemembers' Group Life Insurance and Veterans' Group Life
  Insurance"** (`meta.structure_json`). The dependency and death-compensation
  provisions are in **Part 3 — "Adjudication"** (§ 3.5 "Dependency and
  indemnity compensation.", § 3.1701 "Deceased veterans for whom VA may
  provide burial benefits.", § 3.1704 "Burial allowance based on
  service-connected death.").
- It is **not** off-subject by accident, either. § 9.21's paragraph (c)(17)
  reads: _"Coma (8 or less on Glasgow Coma Scale) AND/OR Traumatic Brain Injury
  resulting in inability to perform at least 2 activities of daily living
  (ADL): (i) The amount payable at the 15th consecutive day of ADL loss is
  $25,000."_ § 9.20, the provision that cites it, is "Traumatic injury
  protection."

So the top hit **names "Traumatic Brain Injury" verbatim and states a dollar
amount payable for it** — under the group life insurance regime. The
retrieval's lexical match is not a near-miss; it is a phrase-perfect hit on the
wrong benefit. And the ordering rules cannot see the difference: the M3-d
heading-phrase key has nothing to fire on (measured below), so the decision
falls to bm25 on the body text, where the provision that repeats the query's
words most often wins.

A practitioner asking about "traumatic brain injury compensation" means VA
disability compensation (§ 4.124a, DC 8045) and special monthly compensation
(§ 3.350). § 9.21 pays a VGLI insurance loss benefit — a different program
entirely, with its own trigger and its own dollar amounts. **A client that
quotes the top hit hands the practitioner a life-insurance loss schedule.** No
sibling proposal is proposed for this query: there is no reading under which
§ 9.21 is an acceptable answer to a question about VA disability compensation.

Two smaller things about this case, both measured:

- The three closest sections are crowded behind it: § 3.352 "Criteria for
  determining need for aid and attendance and 'permanently bedridden.'" at 2,
  § 3.350 at 3, § 4.124a (the TBI residuals schedule) at 4. The right answers
  are in the window.
- **The M3-d heading-phrase key cannot reach this query at all.** The key
  fires only when a hit's _heading_ carries the query's content terms as a
  phrase (`src/core/store.ts:606`, `headingMatchKey`). For "traumatic brain
  injury compensation" the phrase is the whole query, and the heading key is
  **0 for every one of the top five** — § 9.21's heading is "Schedule of
  Losses.", and § 4.124a's is "Schedule of ratings—neurological conditions and
  convulsive disorders."; neither carries the phrase. All five top hits are
  AND-tier members, so the order is decided by **bm25 alone**, and § 9.21 wins
  it: its body repeats the phrase "traumatic brain injury" **4 times** and the
  word "traumatic" **15 times**, more than any of the other four (§ 3.350 and
  § 3.352: twice each; § 4.124a: once). This is precisely the failure the
  M3-d round diagnosed — bm25 weighs term frequency inside a column — except
  that here the column is the body and the heading key had nothing to offer.
- The 2026-10-20 baseline recorded this query with **§ 4.124a fourth**; today's
  measurement puts § 4.124a fourth again, so the ordering of the top five is
  unchanged. What the baseline did not record is that the top hit is § 9.21:
  the baseline reports aggregate and per-category figures, not the per-query top
  hit, and the dev set's top-five order for this query is only in the runner's
  own output.

## 8. The measured consequence of the sibling proposals

Two readings, because the fourteen proposals in §6.3 fall into two groups:
twelve sit on the in-window-but-not-first cases of §6.1, and two sit on
recall failures (§6.2).

**Scenario A — add the sibling to the twelve in-window-but-not-first cases
only:**

|                                                  | before | after             |
| ------------------------------------------------ | ------ | ----------------- |
| exact-citation (top hit is an expected citation) | 29/46  | **41/46**         |
| recall@5                                         | 42/46  | 42/46 (unchanged) |
| residual failures                                | 17     | **5**             |

The five residual failures: `traumatic brain injury compensation` (§ 9.21),
`table of amendments title 38` (§ 8.11), `which appendices list amendments`
(§ 50.3), `veteran with a mental disorder rating` (§ 4.126),
`dependency and indemnity compensation` (§ 3.658).

**Scenario B — apply all fourteen proposals, including the two on recall
failures:**

|                                                  | before | after                                                |
| ------------------------------------------------ | ------ | ---------------------------------------------------- |
| exact-citation (top hit is an expected citation) | 29/46  | **43/46**                                            |
| recall@5                                         | 42/46  | **44/46** (the two added sections are in the window) |
| residual failures                                | 17     | **3**                                                |

The three residual failures: `traumatic brain injury compensation` (§ 9.21),
`table of amendments title 38` (§ 8.11), `which appendices list amendments`
(§ 50.3).

**What the change is actually for.** Neither scenario improves retrieval. Not
one ranking rule, synonym, or candidate-set change ships here. What changes is
the **question the metric asks**. Today it asks "is the top hit the citation
the committee picked?" — and it counts a retrieval that led with § 4.86
"Exceptional patterns of hearing impairment." as a **failure** for the query
"how is hearing loss rated", because the committee's preferred answer was
§ 4.85. With the siblings accepted, it asks "is the top hit a defensible
answer?" — which is the property a client that quotes the top hit actually
needs. The committee's ranking preferences stop being scored as retrieval
defects.

**The honest cost of that change.** A broader expected set makes the metric
easier to pass. The number that would replace "29/46" is not a like-for-like
comparison, and the two scenarios above differ by two queries for that reason
alone. The measure that does not move is recall@5 in Scenario A, and the
measure that only moves because a new expected citation entered the window is
recall@5 in Scenario B. **Whichever reading the operator accepts, the 29/46
figure and the 41/46 or 43/46 figure are not the same measurement and must
never be reported as a before/after improvement.**

## 9. What is decided here, and what is not

**Decided (provisionally, by this round):**

- The ORDER of the four multi-member provisional sets, per §3, with the one
  disagreement resolved per §4 and the co-equal note preserved.
- The finding that twelve of the thirteen in-window-but-not-first queries
  lead with a defensible sibling, and the finding that one (§ 9.21) does not.

**Not decided — and not mine to decide:**

- **The content of the 39 provisional expectations remains the operator's.**
  Neither committee member flagged an expected member as not belonging, so
  this round proposes no change to _which_ provisions are expected, only to
  their _order_ — and, as a proposal, additional acceptable answers.
- **Adding the siblings to the expected sets is an operator content
  decision.** The frozen sets are the benchmark; changing what the benchmark
  counts as correct changes the benchmark. This round proposes; the operator
  accepts or corrects. **The frozen sets were not edited.**
- **The order adjudication itself is provisional.** Both members' orderings
  are committee judgements and the operator's expert adjudication remains the
  authority. The close-call list in §5 is where to start.
- **The thresholds stay contingent.** The M3 proposal
  ("recall@5 ≥ 0.80, MRR ≥ 0.65, no regression on the citation queries")
  remains contingent on an expert adjudicating the expectations, and the
  holdout remains burned for threshold selection.

## 10. What is deliberately not in this round

No code, no ranking change, no synonym, no candidate-set change, no
abstention change. No `expected` set was edited; no query was added, removed
or re-worded; the evaluation runner is unchanged; the runner's metric is
unchanged. `docs/research/retrieval-baseline-2026-10-20.md` is unchanged —
this document is an addendum to it, not a replacement, and the baseline's
numbers stand as measured on the day.

What ships from this round: this document, and one amended row in
`ROADMAP.md`.
