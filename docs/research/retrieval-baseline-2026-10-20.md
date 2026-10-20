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

## Holdout set (20 queries; 17 answerable, 3 no-answer)

Exact-citation success 13/17 · recall@5 14/17 · mean reciprocal rank
0.7794 · no-answer violations 2/3.

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
   with § 17.271) and two in the holdout (BVA, sf-8). A confidence band
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

Contingent on an expert adjudicating the remaining 41 provisional
expectations.

- **Exact-citation success: no regression** on the 10/10 citation queries.
- **Recall@5 ≥ 0.80** on the adjudicated answerable set (today 25/29 ≈
  0.83 on a partly-provisional set).
- **Mean reciprocal rank ≥ 0.65** (today 0.6753).
- **No-answer violations ≤ 1 of 4** (today 1 of 1 in dev, 2 of 3 in
  holdout) — and only if a signal is found that separates them; the
  score-based candidate does not.

## What is deliberately NOT in this round

No ranking, synonym, snippet, reference-extraction or abstention change
ships here. This document is the baseline those changes would be measured
against; the roadmap sets thresholds only after a baseline exists, and the
query set is subject to expert adjudication before it can gate anything.
The holdout set is not read or tuned on while iterating.

**Next, in order of measured value:** (1) the synonym/vocabulary gap
(M3-b) with the corpus-verified targets above; (2) the ranking order for
natural phrasing (M3-d); (3) abstention (M3-a) — but only with a signal
that demonstrably separates the cases, and on a set an expert has
adjudicated.
