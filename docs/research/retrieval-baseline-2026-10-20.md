# Retrieval baseline — Title 38 CFR, 2026-10-20 (adjudicated set)

**What this measures.** How the search retriever behaves over a frozen
query set that mimics how a claims researcher or adjudicator looks up a
regulation. It measures the RETRIEVER, not legal correctness.

**Provenance of the expectations.** The set was reviewed by a two-member
committee (free-tier models, independent of the implementer), and the two
members were then **cross-checked against each other and against the
corpus**: each member's citation was verified by the provision's own
heading, and where they disagreed the corpus decided. Entries the corpus
cannot settle — "what would a practitioner mean" — stay `provisional`;
entries settled by the corpus are `adjudicated`. **The cross-check found
errors in BOTH members**: one proposed DIC sections whose headings are
_pension_ provisions (3.17, 3.26 — the real DIC sections are 3.5, 3.10,
3.25), and the other dismissed § 3.309 as merely mentioning PTSD when the
text reads "if the Secretary determines that the veteran has
post-traumatic stress disorder (PTSD)". A corpus grep also settled Purple
Heart: exactly four provisions mention it (17.36, 17.108, 17.149, 51.50) —
each member had missed one. **11 of 50 are now `adjudicated`; 39 remain
`provisional`**, and the thresholds below stay contingent on an expert
pass.

**Update (2026-10-21) — the expectations were adjudicated.** A further
committee round (two members, their rulings cross-checked against each other
and against the corpus, the disagreements resolved) adjudicated the remaining
39; the record of the proposals, the cross-checks and the rulings is
`docs/research/expectation-adjudication-2026-10-21.md`. **All 50 entries now
carry `adjudication: 'adjudicated'`**, and the thresholds below stay
contingent on an expert pass. That round also changed the CONTENT of seven
expected sets, so this document states its figures for two states of the
benchmark: the ones measured on 2026-10-20 against the expectations of that
day, and the ones re-measured on 2026-10-21 against the adjudicated
expectations. The section "The 2026-10-21 expectation adjudication" below
gives both, and says why they are not the same measurement.

**Reproduce.**

```bash
cp ~/.cfr-free/index.sqlite /tmp/eval-index.sqlite   # never run against the live index
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts dev
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts holdout
```

**Provenance** — darwin 25.6.0 arm64, node v26.11.1, 8 cpus, 24 576 MB;
index issue date 2026-10-16 (2 970 provisions). Warm-search latency is
reported per query. The runner is offline and deterministic apart from the
measured latencies.

## Correction to the first baseline (2026-10-20, same day)

The first version of this report claimed **no-answer violations 4/4** — the
retriever answering confidently for queries that are not in the corpus. The
committee showed that **three of those four "no-answer" queries were my
mistake**: dental treatment eligibility, burial allowance and VA loan
underwriting **are** in Title 38 (17.161/17.162, 3.1700-3.1705, 36.4340/
36.4206). The set also contained invented or wrong citations (`3.18` is not
in the corpus at all; `3.17`/`3.26` are pension sections, not DIC;
`3.301` is "Line of duty and misconduct", not PTSD criteria; tinnitus is
rated in the **ear** schedule § 4.87; loss of use of a hand is § 4.63). The
numbers below are **re-measured against the corrected expectations**, not
re-labelled.

## The 2026-10-21 expectation adjudication (a change in the question, not in the retrieval)

On 2026-10-21 a two-member committee adjudicated the 39 expectations this
document recorded as `provisional`. The two members' rulings were
cross-checked against each other and against the corpus, the disagreements
were resolved, and the consolidated decisions are what the frozen sets now
carry. The record — the proposals, the cross-checks, the rulings — is
`docs/research/expectation-adjudication-2026-10-21.md`. Three things changed,
and only one of them is a number.

**1. The expected SETS of seven entries.** The query text, the category and
the ORDER of every set are unchanged; the MEMBERS are:

| set     | query                                              | expected set before | expected set after                                              |
| ------- | -------------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| dev     | `schizophrenia`                                    | `4.130`             | `4.130, 3.384`                                                  |
| dev     | `total disability rating based on unemployability` | `4.16`              | `4.16, 4.17`                                                    |
| dev     | `traumatic brain injury compensation`              | `3.350, 4.124a`     | `3.350, 4.124a, 3.310`                                          |
| dev     | `Persian Gulf veterans compensation`               | `3.317`             | `3.317, 3.320, 3.320a, 3.320b`                                  |
| dev     | `"schedule of ratings"`                            | `4.130`             | all sixteen sections whose heading begins "Schedule of ratings" |
| holdout | `veteran with a mental disorder rating`            | `4.130`             | `4.130, 4.126`                                                  |
| holdout | `"aid and attendance"`                             | `3.504`             | `3.504, 3.352, 3.350`                                           |

The four no-answer entries (`tricare enrollment forms`, `BVA`, `NVL`,
`sf-8 form`) keep their empty expected sets, and seven further sibling
proposals were REJECTED — § 17.151 (it furnishes invalid lifts, a different
benefit type), § 4.86 (the exception to the general evaluation § 4.85),
§ 17.160 (who may be _examined_, not who is _eligible_), § 3.1701
(eligibility, not the rate the query asks for), § 36.4225 (lender closing
authority, not underwriting standards), § 3.455 (apportionment — a mechanic
presupposing the entitlement) and § 3.658 (offsets — likewise). Those sets
are exactly as they were.

**2. The `adjudication` flags.** All 39 entries that carried
`adjudication: 'provisional'` now carry `adjudication: 'adjudicated'`. The
flag records the committee's cross-checked ruling; an expert remains the
authority, and the thresholds below stay contingent on one. This supersedes
the M3-b note at the foot of this document, which said the expectation's
ORDER was "still provisional".

**3. One rationale was factually wrong.** The `BVA` entry's rationale said
"the Board of Veterans Appeals is not a CFR provision". **That premise is
false.** The corpus contains the Board's regulations: Title 38 Part 19
("Board of Veterans' Appeals: Legacy Appeals Regulations", 34 sections) and
Part 20 ("Board of Veterans Appeals: Rules of Practice", 125 sections) — 159
sections in all. The empty expected set nevertheless STANDS: a bare acronym
is not a usable ground truth for 159 sections, and the corpus carries no
"BVA" heading. The rationale now says so.

**What the re-measurement shows — and what it does not.** The figures below
are re-measured on 2026-10-21 against the adjudicated expectations.

> **This is NOT a retrieval improvement.** Not one ranking rule, synonym,
> candidate-set rule or code path changed, and no retriever change ships
> here. What changed is the **question the metric asks**: from "is the top
> hit the citation the committee picked?" to "is the top hit a defensible
> answer?". A broader expected set makes the metric easier to pass, so the
> two columns below are **not the same measurement and must never be
> presented as a before/after improvement**.

| metric (46 answerable queries)       | before — 2026-10-20 expectations | after — 2026-10-21 expectations |
| ------------------------------------ | -------------------------------- | ------------------------------- |
| top hit is an expected citation      | 29/46                            | **34/46**                       |
| an expected citation in the top five | 42/46                            | **43/46**                       |
| mean reciprocal rank                 | 0.7536                           | **0.8225**                      |

Per set:

| set     | top hit is an expected citation | an expected citation in the top five | mean reciprocal rank |
| ------- | ------------------------------- | ------------------------------------ | -------------------- |
| dev     | 17/29 → **21/29**               | 28/29 → **28/29**                    | 0.7529 → **0.8276**  |
| holdout | 12/17 → **13/17**               | 14/17 → **15/17**                    | 0.7549 → **0.8137**  |

The "before" column is the state this document measured on 2026-10-20, after
the M3-b/M3-d/M3-e retrieval rounds; it was correct against the expectations
of that day, and it is still correct against them.

Five queries flip to a correct first hit: `schizophrenia`, `total disability
rating based on unemployability`, `Persian Gulf veterans compensation`,
`"schedule of ratings"` and `veteran with a mental disorder rating`. The
residual failures are unchanged: `traumatic brain injury compensation` still
leads with § 9.21 "Schedule of Losses." — the genuine ranking failure — and
the two appendix queries are still vocabulary misses.

## Development set (30 queries; 29 answerable, 1 genuine no-answer)

| Metric                                           | Result  |
| ------------------------------------------------ | ------- |
| Exact-citation success (expected is the top hit) | 16/29   |
| Recall@5 (expected appears in top 5)             | 25/29   |
| Mean reciprocal rank                             | 0.6753  |
| No-answer queries that returned a confident hit  | **1/1** |

| Category         | recall@5 |
| ---------------- | -------- |
| bare-citation    | 6/6      |
| display-citation | 4/4      |
| natural-phrasing | 8/9      |
| quoted-phrase    | 2/2      |
| abbreviation     | 4/5      |
| ambiguous        | 1/2      |
| appendix         | 0/1      |
| no-answer        | 0/1      |

Re-measured on 2026-10-21 against the adjudicated expectations: exact-citation
success **21/29** · recall@5 **28/29** · mean reciprocal rank **0.8276** ·
no-answer violations 1/1. By category: bare-citation 6/6, display-citation
4/4, natural-phrasing **9/9**, quoted-phrase 2/2, abbreviation **5/5**,
ambiguous **2/2**, appendix 0/1, no-answer 0/1.

## Holdout set (20 queries; 17 answerable, 3 no-answer)

Exact-citation success 13/17 · recall@5 14/17 · mean reciprocal rank
0.7794 · no-answer violations 2/3. By category: bare-citation 2/2,
display-citation 3/3, natural-phrasing 4/5, quoted-phrase 2/2, ambiguous
1/2, appendix 1/2, **abbreviation 1/3** (the abbreviation weakness shows
in the holdout too — the same vocabulary gap the dev set measures).

Re-measured on 2026-10-21 against the adjudicated expectations: exact-citation
success **13/17** · recall@5 **15/17** · mean reciprocal rank **0.8137** ·
no-answer violations 2/3. By category: bare-citation 2/2, display-citation
3/3, natural-phrasing **5/5**, quoted-phrase 2/2, ambiguous 1/2, appendix
1/2, **abbreviation 1/3**.

## What the baseline says

1. **Citation retrieval is excellent.** Every bare and display citation
   pins its exact section first (10/10 in the dev set). The dotted legal
   form `38 C.F.R. § 4.130` works and resolves, though it costs ~6× the
   latency of the bare form (59–70 ms vs 4–13 ms) — a pinned-then-fallback
   path difference worth a look, not a defect.

2. **The vocabulary gap is the real weakness.** Four of the five
   abbreviation misses are one thing: the retriever has no synonym for the
   rating-office forms. `A&A` returns an unrelated top hit in 136 ms
   (its targets, 3.352/3.350, are absent from the top five); `SMC` puts
   § 3.350 fourth; `TBI` puts § 4.124a third. The nine curated synonym
   groups do not cover these forms. This is fixable **deterministically**
   with the store's existing expansion mechanism and corpus-verified
   targets (PTSD → 3.304/3.309/4.130; A&A → 3.352/3.350; DIC → 3.5/3.10/
   3.25; TBI → 4.124a/3.350).

3. **Natural phrasing finds the right provision but not first.**
   `schizophrenia` ranks the definitional § 3.384 above the criteria
   schedule § 4.130; `traumatic brain injury compensation` puts § 4.124a
   fourth; `Persian Gulf veterans compensation` puts § 3.317 second. The
   right provision is usually in the top five — but a first-hit-only client
   would be misled.

4. **Two subjects are not findable at all.** "table of amendments title
   38" never surfaces Appendix A to Part 4, and "special monthly
   compensation" never surfaces § 3.350 — both are vocabulary misses with
   no synonym.

5. **Abstention is a smaller problem than the first baseline claimed, and
   the obvious signal does not work.** Exactly **one** confirmed no-answer
   case in the dev set (TRICARE enrollment forms — the retriever answers
   with § 17.271) and two in the holdout (BVA, sf-8). **One of those
   expectations carried a false premise, corrected on 2026-10-21:** the
   `BVA` rationale said the Board of Veterans Appeals is not a CFR
   provision, and it is — Title 38 Part 19 (34 sections) and Part 20 (125
   sections) are the Board's regulations, 159 sections in all. The empty
   expected set stands (a bare acronym is not a usable ground truth for 159
   sections, and the corpus carries no "BVA" heading), but the stated reason
   was wrong. A confidence band
   keyed on the top hit's bm25 score was measured against the corrected
   set and **misclassifies in both directions**: the genuine no-answer
   `BVA` scores **−16.24** (a strong match), while the answerable
   `dependency` (−4.30) and "which appendices list amendments" (−7.19)
   score weakly and would be abstained on. Worse, a score cannot see the
   dominant failure at all: `TBI` scores −19.98 and still misses its
   targets, because the problem is **vocabulary and ranking**, not
   confidence. Any abstention threshold would be a guess dressed as a
   guarantee.

## Proposed thresholds (proposal only — not in force)

Contingent on an expert pass over the expectations: as of 2026-10-21 the
committee's ruling has adjudicated all 50, and an expert adjudication is
still outstanding.

- **Exact-citation success: no regression** on the 10/10 citation queries.
- **Recall@5 ≥ 0.80** on the adjudicated answerable set (today 28/29 ≈
  0.97 in dev and 15/17 ≈ 0.88 in the holdout, re-measured 2026-10-21).
- **Mean reciprocal rank ≥ 0.65** (today 0.8276 in dev and 0.8137 in the
  holdout, re-measured 2026-10-21).
- **No-answer violations ≤ 1 of 4** (today 1 of 1 in dev, 2 of 3 in
  holdout) — and only if a signal is found that separates them; the
  score-based candidate does not.

## What is deliberately NOT in this round

No ranking, synonym, snippet, reference-extraction or abstention change
ships here. This document is the baseline those changes would be measured
against; the roadmap sets thresholds only after a baseline exists, and the
query set is subject to expert adjudication before it can gate anything.
The holdout set is not read or tuned on while iterating.

**Update (M3-b, after this baseline):** the curated synonym expansions
shipped with corpus-verified spellings, and the effect on this baseline is
measured, not asserted — dev exact-citation 16/29 → **17/29**, recall@5
25/29 → **26/29**, MRR 0.6753 → **0.7098**, abbreviation recall@5 **4/5 →
5/5**; holdout exact-citation 13/17 → 12/17 and MRR 0.7794 → 0.7402,
recall@5 unchanged at 14/17. The one holdout move is "DIC": the broader
expansion ("dependency and indemnity compensation" is in 98 sections) now
returns five GENUINE DIC provisions where it previously returned mostly
DIC-adjacent ones, so the expected provision is still in the window but no
longer first. That is a ranking consequence (M3-d), not a correctness
regression — and the expectation's ORDER is a committee judgement, still
provisional.

**Next, in order of measured value:** (1) the synonym/vocabulary gap
(M3-b) with the corpus-verified targets above; (2) the ranking order for
natural phrasing (M3-d); (3) abstention (M3-a) — but only with a signal
that demonstrably separates the cases, and on a set an expert has
adjudicated.

### 2026-10-21 — exception demotion (ranking round)

Measured on the frozen set (corpus issue date 2026-10-16, 46 answerable
queries):

| variant                          | dev first | dev recall@5 | holdout first | holdout recall@5 |
| -------------------------------- | --------- | ------------ | ------------- | ---------------- |
| baseline (shipped at `27b5b51`)  | 21/29     | 28/29        | 13/17         | 15/17            |
| + `s.citation` tie-break         | 21/29     | 28/29        | 13/17         | 15/17            |
| + tie-break + exception demotion | **22/29** | 28/29        | 13/17         | 15/17            |

The demotion flips "how is hearing loss rated" from `4.86, 4.85` to
`4.85, 4.86`. The dev per-query diff against baseline is that single line
and nothing else; the holdout per-query list is identical to baseline
(only timings differ).

Combined over both sets, and against the committee's adjudicated expected
sets, that is **35 of 46** answerable queries with an expected citation
first (was 34 of 46) and **43 of 46** in the top five — the first number
a genuine retrieval improvement, the second unchanged. The eight
remaining in-window-but-not-first cases are listed with the committee's
ruling on each in `docs/research/practitioner-pilot.md` §2.
