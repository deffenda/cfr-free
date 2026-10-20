# Retrieval baseline — Title 38 CFR, 2026-10-20

**What this measures.** How the search retriever behaves over a frozen
query set that mimics how a claims researcher or adjudicator looks up a
regulation. It measures the RETRIEVER, not legal correctness: every
expectation below is `provisional` — the orchestrator's working assumption,
not expert-adjudicated ground truth. An expert must adjudicate the set
before its numbers can gate a change.

**Reproduce.**

```bash
cp ~/.cfr-free/index.sqlite /tmp/eval-index.sqlite   # never run against the live index
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts dev
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts holdout
```

**Provenance** — darwin 25.6.0 arm64, node v26.11.1, 8 cpus, 24 576 MB;
index issue date 2026-10-16 (2 970 provisions). Warm-search latency is
reported per query; the dev set's figures below are from that run. The
runner is offline and deterministic apart from the measured latencies.

## Development set (30 queries; 26 answerable, 4 no-answer)

| Metric                                           | Result  |
| ------------------------------------------------ | ------- |
| Exact-citation success (expected is the top hit) | 13/26   |
| Recall@5 (expected appears in top 5)             | 20/26   |
| Mean reciprocal rank                             | 0.6006  |
| No-answer queries that returned a confident hit  | **4/4** |

| Category         | recall@5               |
| ---------------- | ---------------------- |
| bare-citation    | 6/6                    |
| display-citation | 4/4                    |
| natural-phrasing | 5/6                    |
| quoted-phrase    | 2/2                    |
| abbreviation     | 2/5                    |
| ambiguous        | 1/2                    |
| appendix         | 0/1                    |
| no-answer        | 0/4 (all four violate) |

## What the baseline says

1. **Citation retrieval is excellent.** Every bare and display citation
   pins its exact section first (10/10). The dotted legal form
   `38 C.F.R. § 4.130` works and resolves, though it costs ~6× the
   latency of the bare form (65–72 ms vs 6–13 ms) — a pinned-then-fallback
   path difference worth a look, not a defect.

2. **The retriever never abstains.** All four no-answer queries — dental
   benefits, burial allowance rates, TRICARE forms, home-loan underwriting
   — return five confident hits. The retriever has no "not in this corpus"
   answer, so an LLM client reading the response may treat a wrong
   provision as on-point. **This is the single most consequential gap for
   the mission**: a claims adjudicator asking about something Title 38 does
   not cover is handed plausible-looking CFR text.

3. **Abbreviations are the weakest link.** `A&A` (aid and attendance)
   returns an unrelated top hit in 137 ms — its top five (§ 26.31, 45.200,
   77.8, …) contain nothing about aid and attendance. `TBI` never surfaces
   § 3.350 at all. `SMC` puts its target at rank 4. `PTSD` puts § 3.309 at
   rank 5. The curated synonym groups do not cover these forms.

4. **Natural phrasing finds the right provision but not first.**
   `schizophrenia` ranks the definitional § 3.384 above the criteria
   schedule § 4.130 (§ 4.130 at rank 2); `traumatic brain injury
compensation` puts § 3.350 third, behind § 9.21; `total disability
rating based on unemployability` puts § 4.16 second behind § 4.17. The
   provision a practitioner means is usually in the top five — but a
   first-hit-only client would mislead.

5. **Quoted phrases and appendices are thin.** `"schedule of ratings"`
   ranks § 4.130 third (behind two rating tables), and "table of amendments
   title 38" does not surface Appendix A to Part 4 at all.

## Proposed thresholds (proposal only — not in force)

These are **proposals contingent on the operator adjudicating the set**.
They are the bar a future retrieval change (M3 follow-ups: synonyms,
ranking, abstention) would be measured against; none is enforced today.

- **Exact-citation success: no regression** on the 10/10 citation queries.
- **Recall@5 ≥ 0.75** on the adjudicated answerable set (today 20/26 ≈
  0.77 on a provisional set).
- **Mean reciprocal rank ≥ 0.65** (today 0.6006).
- **No-answer violations ≤ 1 of 4** (today 4 of 4) — abstention is the
  highest-value target.

## What is deliberately NOT in this round

No ranking, synonym, snippet, reference-extraction or abstention change
ships here. This document is the baseline those changes would be measured
against; the roadmap sets thresholds only after a baseline exists, and the
query set itself is subject to expert adjudication before it can gate
anything. The holdout set is not read or tuned on while iterating.
