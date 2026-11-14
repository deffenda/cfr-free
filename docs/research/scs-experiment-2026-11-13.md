# The Structural Citation Support experiment — 2026-11-13

**Status: REJECTED.** The experiment fails the regression guard of the
ranking-instrument design (`ranking-instrument-design-2026-11-01.md` §3.3):
top-hit accuracy on the frozen benchmark regressed from **35/46 to 28/46**
and recall@5 from **43/46 to 33/46**. Per the design's negative-result rule,
the ranking change is not landed, this record retains the per-query evidence,
and the SCS-as-ranking-key option joins the rejected-options list with its
revisit trigger.

No new corpus fact and no new retrieval-quality metric is introduced here.
The corpus receipt of both runs is identical (see §1), so the comparison is
like-for-like.

## 1. Protocol (as declared by the design, §3.3)

- **Baseline code:** `origin/main` at `40b3e6df3` (the SCS worktree branched
  there; the unrelated security merge `0a85b7e00` that landed during the
  experiment does not touch ranking). **Experiment code:** the
  `feat/scs-ranking-key` worktree, implementing §3.1 exactly (SQL in the
  appendix), unit-tested (43/43 store tests, including a seeded corpus whose
  expected order pins the lexicographic (G, P, I) semantics, self-citation
  exclusion, and missing-metadata behavior). The branch was **not merged and
  is discarded**; the SQL appendix reproduces it.
- **Index:** two byte-identical copies of the operator's index
  (`~/.cfr-free/index.sqlite`), issue date **2026-10-27**, corpus hash
  `d48fa707c6aa8e3e9b5c54ffa80654e9eb0199538f5120d8f68d0b2f7c8e2da0` — the
  same receipt in both runs, per the design's compare-only-on-same-receipt
  rule.
- **Benchmark:** the frozen sets through the product's own runner:
  `CFR_INDEX_PATH=<copy> npx tsx test/fixtures/retrieval/run.ts {dev,holdout}`.
  30 + 20 queries, **46 answerable**, all expectations committee-adjudicated.
- **Guard:** complete per-query top-5 recorded (appendix B); top-hit accuracy
  must not regress from 35/46; the § 9.21 wrong-programme case, the seven
  question-object cases, and the subject-level `PTSD` → § 4.125 case reported
  separately.

## 2. Result

| Aggregate            | dev (29 answerable) | holdout (17 answerable) | combined (46)     |
| -------------------- | ------------------- | ----------------------- | ----------------- |
| exact-citation       | 22/29 → **18/29**   | 13/17 → **10/17**       | 35/46 → **28/46** |
| recall@5             | 28/29 → **23/29**   | 15/17 → **10/17**       | 43/46 → **33/46** |
| MRR                  | 0.8448 → **0.6983** | 0.8137 → **0.5882**     | —                 |
| no-answer violations | 1/1 → 1/1           | 2/3 → 2/3               | unchanged         |

30 of the 50 queries changed their top-5 (60 changed lines in the per-query
diff). All ten bare/display-citation pins stayed at rank 1 on both sides —
the damage is confined to natural-phrasing and abbreviation queries, exactly
the queries the earlier keys leave to the tie-breakers.

**Verdict: reject.** The candidate set never changed (SCS sorts; it does not
filter), and recall@5 movement is top-5-window composition, reported here so
the rerank cannot be read either as a recall gain or as an unrelated loss.

## 3. Mechanism: graph degree measures neighbourhood prominence

The design's stated risk is what happened. Where the heading-phrase key and
AND tier tie, SCS-TOTAL hands the tie to the corpus's most-cited hubs —
provisions every part cites for procedural reasons, not the provision that
answers the question:

- `PTSD` → 3.309, 3.12, 3.304@3, 4.130@4, 61.1 (was 3.304@1): 3.12 and 4.130
  are the two most inbound-cited sections in the corpus.
- `schizophrenia` → 3.12, 4.130@2, 61.1, 3.384@4 (was 3.384@1).
- `VA disability rating` → 21.9640, 3.3, 21.9641 … (4.15 left the top five
  entirely; was 4.15@1).
- `aid and attendance for a parent` → 3.551, 3.272, 3.278 … (3.504 left the
  top five; was 3.504@1).
- `veterans dental benefits eligibility`, `military burial allowance rate
table`, `va loan underwriting guidelines` (three of the seven adjudicated
  question-object failures): all regressed or stayed wrong.

At G = P = 0 — a candidate whose part and subject group nothing in its
neighbourhood cites from — the lexicographic vector reduces to raw inbound
degree, and raw inbound degree is prominence, not answer-ness. That is the
design's own caveat ("a higher SCS score for § 9.21 would be evidence that
graph degree measures neighbourhood prominence, not answer correctness"),
measured across the whole set.

## 4. What the negative result also found

Two findings inside the rejection are retained, because they are evidence
about the corpus structure, not about SCS:

1. **The same-part/same-group component discriminated where it exists.**
   Two of the eight adjudicated real ranking failures flipped to correct:
   `SMC` / `special monthly compensation` → § 3.350@1 (was § 17.151 first),
   and `DIC` → § 3.5@1 (was § 3.455 first). In both, the expected provision
   sits in the same part — and is cited from the same subject group — far
   more than the wrong first hit. The corpus's citation structure DOES
   separate these question objects at the group level.
2. **The damage is attributable to the total-support tier specifically.**
   Every large loss is a hub with corpus-wide inbound degree promoted at
   G = P = 0. No loss required the group or part components.

**The obvious next move is recorded as deliberately NOT taken.** Adopting
"G-only, drop total support" (or any threshold) selected from this result
would be tuning against the burned holdout — the design (§3.3) forbids it,
and the roadmap's fresh-holdout and expert-adjudication discipline would be
required for any threshold-bearing round. The finding above is the
revisit trigger's substance: a narrower quantity built on the group
component, evaluated on a FRESH query set with expert adjudication, is a
legitimate future packet. Re-running this exact experiment with weights
adjusted to fit these 46 queries is not.

## 5. The § 9.21 case

`traumatic brain injury compensation` moved from 9.21 first to
3.352, 3.350, 4.124a, 9.21@4, 4.71a — the wrong-programme provision is no
longer on top. This is INCIDENTAL: a graph-prominence rerank moving one case
does not fix the programme collision, and per the design the honest remedy
remains part-title context, not a ranking rule. No claim is made that SCS
"fixed" § 9.21, and the case stays in the residual record unchanged.

## 6. Rejected-option record

- **Option:** Structural Citation Support as a ranking key (the full (G, P,
  I) lexicographic vector), inserted after the exception demotion and before
  bm25.
- **Evidence:** this document; per-query outputs in appendix B; unit-test
  corpus semantics verified during implementation.
- **Outcome:** rejected by the §3.3 regression guard (35/46 → 28/46).
- **Revisit trigger:** a NEW corpus-structure signal or a narrower,
  group-only quantity evaluated on a FRESH holdout set with expert
  adjudication — never re-tuning against this benchmark. The rejected § 9.21
  per-part rule, blocklist, BM25 retune, and abstention band stay rejected.
- **Maintenance note for any future packet:** SCS is recomputed from the
  rebuilt index per receipt, never carried across issue dates (design §4) —
  this experiment measured the quantity exactly that way.

## Appendix A — the experiment's ranking keys (verbatim)

Inserted into `ORDER BY` between the exception-demotion key and bm25 in
`Store.search()`; each is a correlated subquery over the
`section_references_cited` index plus a PK join to `sections`:

```sql
-- group support (G)
(SELECT count(DISTINCT c.id)
  FROM section_references r
  JOIN sections c ON c.id = r.citing_id
  WHERE r.cited_citation = s.citation
    AND c.id != s.id
    AND c.part IS NOT NULL AND c.part != '' AND c.part = s.part
    AND c.subject_group IS NOT NULL AND c.subject_group != '' AND c.subject_group = s.subject_group
) DESC
-- part support (P): same without the subject_group predicates
-- total support (I): same without the part and subject_group predicates
```

## Appendix B — complete per-query top-five output

Baseline (main `40b3e6df3`) vs experiment (`feat/scs-ranking-key`), identical
index receipt (issue 2026-10-27, hash `d48fa707…e2da0`). Machine:
darwin 27.2.0 arm64, node v24.22.1.

### dev (30 queries)

BASELINE (main 40b3e6df3)

```text
[bare-citation] "4.130" -> 4.130, 21.130, 20.1301, 13.130, 15.130 (4.130@1) 13.1ms
[bare-citation] "3.350" -> 3.350, 21.350, 51.350, 17.3500, 21.3021 (3.350@1) 21.2ms
[bare-citation] "4.85" -> 4.85, 4.25, 4.76a, 21.4201, Appendix C to Part 4 (4.85@1) 13.2ms
[bare-citation] "3.504" -> 3.504, 20.504, 1.504, 17.504, 21.5041 (3.504@1) 16.8ms
[bare-citation] "4.16" -> 4.16, 80.16, 12.13, 17.164, 17.166 (4.16@1) 15.1ms
[bare-citation] "3.317" -> 3.317, 21.258, 21.445, 3.320a, 21.4001 (3.317@1) 17.6ms
[display-citation] "38 C.F.R. § 4.130" -> 4.130, 21.130, 20.1301, 13.130, 59.130 (4.130@1) 97.5ms
[display-citation] "38 C.F.R. § 4.85" -> 4.85, 4.25, 4.76a, 21.4201, 3.5 (4.85@1) 104.3ms
[display-citation] "38 CFR 3.350" -> 3.350, 4.71a, 17.37, 4.75, 21.4200 (3.350@1) 25.5ms
[display-citation] "§ 3.504" -> 3.504, 20.504, 1.504, 17.504, 21.5041 (3.504@1) 17.2ms
[abbreviation] "PTSD" -> 3.304, 17.644, 61.1, 3.12, 9.21 (3.304@1) 4.0ms
[abbreviation] "TBI" -> 3.310, 9.21, 4.124a, 78.10, 17.644 (3.310@1 4.124a@3) 4.0ms
[abbreviation] "SMC" -> 17.151, 3.350, 4.75, 4.96, 4.115b (3.350@2) 4.1ms
[abbreviation] "A&A" -> 3.504, 3.552, 17.151, 3.352, 3.351 (3.352@4 3.504@1) 3.6ms
[abbreviation] "VA disability rating" -> 4.15, 4.88b, 3.22, 3.10, 3.327 (4.15@1) 10.3ms
[natural-phrasing] "schizophrenia" -> 3.384, 4.130, 61.1, Appendix C to Part 4, 3.12 (3.384@1 4.130@2) 2.5ms
[natural-phrasing] "how is hearing loss rated" -> 4.85, 4.86, 17.149, 3.383, 3.350 (4.85@1) 15.4ms
[natural-phrasing] "aid and attendance for a parent" -> 3.504, 3.404, 3.351, 3.25, 3.278 (3.504@1) 69.2ms
[natural-phrasing] "total disability rating based on unemployability" -> 4.17, 4.16, 3.341, 3.343, 21.6503 (4.16@2 4.17@1) 11.7ms
[natural-phrasing] "traumatic brain injury compensation" -> 9.21, 3.352, 3.350, 4.124a, 4.71a (3.350@3 4.124a@4) 8.9ms
[natural-phrasing] "Persian Gulf veterans compensation" -> 3.320, 3.317, 51.50, 3.54, 17.111 (3.317@2 3.320@1) 7.5ms
[quoted-phrase] "\"schedule of ratings\"" -> 4.87a, 4.87, 4.130, 4.150, 4.116 (4.116@5 4.130@3 4.150@4 4.87@2 4.87a@1) 4.6ms
[quoted-phrase] "\"evaluation of hearing impairment\"" -> 4.85, 3.383 (3.383@2 4.85@1) 2.0ms
[ambiguous] "special monthly compensation" -> 17.151, 3.350, 3.351, 21.266, 4.96 (3.350@2) 6.7ms
[ambiguous] "mental disorders rating schedule" -> 4.130, 4.129, 4.128, 4.88b, 4.124a (4.130@1) 9.1ms
[appendix] "table of amendments title 38" -> 8.11, 38.603, 3.317, 4.124a, 36.4322  22.2ms
[natural-phrasing] "veterans dental benefits eligibility" -> 17.160, 17.169, 3.381, 17.161, 17.90 (17.161@4 3.381@3) 10.3ms
[natural-phrasing] "military burial allowance rate table" -> 3.1701, 3.1704, 3.1711, 3.1705, 3.32 (3.1704@2 3.1705@4) 7.9ms
[no-answer] "tricare enrollment forms" -> 17.271, 17.36, 21.7620, 21.9715, 21.4203  6.9ms
[natural-phrasing] "va loan underwriting guidelines" -> 36.4225, 36.4352, 36.4340, 36.4206, 36.4226 (36.4206@4 36.4340@3) 10.7ms
```

EXPERIMENT (feat/scs-ranking-key)

```text
[bare-citation] "4.130" -> 4.130, 3.400, 21.260, 3.160, 21.294 (4.130@1) 18.4ms
[bare-citation] "3.350" -> 3.350, 21.7136, 21.7137, 21.7636, 21.4252 (3.350@1) 24.8ms
[bare-citation] "4.85" -> 4.85, 1.460, 3.3, 21.7136, 21.7137 (4.85@1) 16.5ms
[bare-citation] "3.504" -> 3.504, 21.260, 21.7042, 3.279, 3.6 (3.504@1) 23.3ms
[bare-citation] "4.16" -> 4.16, 21.9640, 1.460, 3.3, 21.9641 (4.16@1) 20.5ms
[bare-citation] "3.317" -> 3.317, 3.500, 3.159, 21.3041, 21.258 (3.317@1) 23.9ms
[display-citation] "38 C.F.R. § 4.130" -> 4.130, 3.400, 21.260, 3.160, 21.294 (4.130@1) 118.7ms
[display-citation] "38 C.F.R. § 4.85" -> 4.85, 1.460, 3.3, 21.7136, 21.7137 (4.85@1) 104.3ms
[display-citation] "38 CFR 3.350" -> 3.350, 21.7136, 21.7137, 21.4252, 3.155 (3.350@1) 28.7ms
[display-citation] "§ 3.504" -> 3.504, 21.260, 21.7042, 3.279, 3.6 (3.504@1) 24.1ms
[abbreviation] "PTSD" -> 3.309, 3.12, 3.304, 4.130, 61.1 (3.304@3 3.309@1 4.130@4) 3.7ms
[abbreviation] "TBI" -> 3.352, 3.350, 4.130, 17.148, 3.310 (3.310@5 3.350@2) 2.8ms
[abbreviation] "SMC" -> 3.350, 17.151, 3.155, 4.75, 4.97 (3.350@1) 3.7ms
[abbreviation] "A&A" -> 3.352, 3.552, 17.151, 3.504, 3.23 (3.352@1 3.504@4) 3.4ms
[abbreviation] "VA disability rating" -> 21.9640, 3.3, 21.9641, 21.7136, 3.23  16.6ms
[natural-phrasing] "schizophrenia" -> 3.12, 4.130, 61.1, 3.384, Appendix C to Part 4 (3.384@4 4.130@2) 2.3ms
[natural-phrasing] "how is hearing loss rated" -> 4.85, 4.86, 3.350, 4.97, 36.4340 (4.85@1) 19.6ms
[natural-phrasing] "aid and attendance for a parent" -> 3.551, 3.272, 3.278, 3.25, 21.4201  78.1ms
[natural-phrasing] "total disability rating based on unemployability" -> 3.3, 3.321, 3.351, 3.350, 17.110  18.1ms
[natural-phrasing] "traumatic brain injury compensation" -> 3.352, 3.350, 4.124a, 9.21, 4.71a (3.350@2 4.124a@3) 9.2ms
[natural-phrasing] "Persian Gulf veterans compensation" -> 3.3, 3.317, 17.161, 3.54, 17.111 (3.317@2) 11.4ms
[quoted-phrase] "\"schedule of ratings\"" -> 4.97, 4.114, 4.88b, 4.130, 4.124a (4.114@2 4.124a@5 4.130@4 4.88b@3 4.97@1) 5.9ms
[quoted-phrase] "\"evaluation of hearing impairment\"" -> 4.85, 3.383 (3.383@2 4.85@1) 1.7ms
[ambiguous] "special monthly compensation" -> 3.350, 17.151, 21.7137, 3.155, 3.351 (3.350@1) 10.6ms
[ambiguous] "mental disorders rating schedule" -> 4.129, 4.88b, 21.7520, 4.130, 3.815 (4.130@4) 10.9ms
[appendix] "table of amendments title 38" -> 3.317, 36.4340, 36.4322, 4.124a, 8.11  27.8ms
[natural-phrasing] "veterans dental benefits eligibility" -> 17.272, 17.52, 21.4201, 17.108, 17.37  15.4ms
[natural-phrasing] "military burial allowance rate table" -> 21.9640, 3.3, 21.9641, 17.63, 21.7136  13.6ms
[no-answer] "tricare enrollment forms" -> 21.9640, 1.460, 21.9641, 21.7136, 21.4253  10.5ms
[natural-phrasing] "va loan underwriting guidelines" -> 36.4340, 36.4225, 36.4352, 3.204, 17.500 (36.4340@1) 15.7ms
```

### holdout (20 queries)

BASELINE (main 40b3e6df3)

```text
[bare-citation] "3.301" -> 3.301, 48.301, 20.301, 1.301, 21.7137 (3.301@1) 16.7ms
[bare-citation] "4.29" -> 4.29, 74.29, 19.29, 21.290, 21.292 (4.29@1) 15.4ms
[display-citation] "38 C.F.R. § 3.350" -> 3.350, 21.350, 21.3021, 21.3042, 21.3301 (3.350@1) 132.0ms
[display-citation] "38 CFR 4.85" -> 4.85, 1.476, 1.488, 1.469, 21.4201 (4.85@1) 13.4ms
[display-citation] "§ 4.16" -> 4.16, 80.16, 12.13, 17.164, 17.166 (4.16@1) 13.7ms
[abbreviation] "DIC" -> 3.455, 3.30, 3.25, 3.33, 3.10 (3.10@5 3.25@3) 3.7ms
[abbreviation] "BVA" -> 3.2502, 20.108, 20.703, 8.30, 20.602  4.2ms
[abbreviation] "NVL" ->   0.4ms
[natural-phrasing] "veteran with a mental disorder rating" -> 4.126, 4.129, 4.125, 3.344, 4.124a (4.126@1) 70.0ms
[natural-phrasing] "how much compensation for loss of use of a hand" -> 4.63, 3.350, 3.383, 4.15, 4.71a (4.63@1) 153.9ms
[natural-phrasing] "rating for service-connected tinnitus" -> 4.87, 3.323, 3.324, 21.48, 4.29 (4.87@1) 11.8ms
[quoted-phrase] "\"aid and attendance\"" -> 3.504, 3.552, 17.151, 3.352, 3.351 (3.352@4 3.504@1) 3.4ms
[quoted-phrase] "\"special monthly compensation\"" -> 17.151, 3.350, 4.75, 4.96, 4.115b (3.350@2) 3.8ms
[ambiguous] "respiratory" -> 4.96, 4.97, 17.3210, 4.16, 17.3230 (4.96@1 4.97@2) 3.9ms
[ambiguous] "dependency and indemnity compensation" -> 3.658, 3.702, 3.455, 21.3023, 3.251  9.4ms
[appendix] "Appendix B to Part 4" -> Appendix B to Part 4, Appendix B to Part 45, Appendix B to Part 50, Appendix A to Part 50, Appendix A to Subpart E of Part 18 (Appendix B to Part 4@1) 39.8ms
[appendix] "which appendices list amendments" -> 50.3, 26.41, 26.40, 1.519, 42.22  8.9ms
[natural-phrasing] "va mortgage rates" -> 36.4212, 36.4312, 36.4306, 36.4300, 36.4339 (36.4212@1 36.4312@2) 10.7ms
[no-answer] "sf-8 form" -> 61.92, 61.1, 14.604, 14.601, 14.668  8.1ms
[natural-phrasing] "purple heart recipients" -> 17.149, 51.50, 4.100, 4.115, 4.104 (17.149@1 51.50@2) 4.8ms
```

EXPERIMENT (feat/scs-ranking-key)

```text
[bare-citation] "3.301" -> 3.301, 21.9640, 21.9641, 21.7136, 21.7137 (3.301@1) 25.4ms
[bare-citation] "4.29" -> 4.29, 3.204, 3.3, 21.9641, 17.63 (4.29@1) 22.6ms
[display-citation] "38 C.F.R. § 3.350" -> 3.350, 21.7136, 21.7137, 21.7636, 21.4252 (3.350@1) 118.3ms
[display-citation] "38 CFR 4.85" -> 4.85, 1.460, 21.7136, 21.7137, 14.630 (4.85@1) 20.2ms
[display-citation] "§ 4.16" -> 4.16, 21.9640, 1.460, 3.3, 21.9641 (4.16@1) 22.0ms
[abbreviation] "DIC" -> 3.5, 3.278, 3.25, 1.956, 3.351 (3.25@3 3.5@1) 5.2ms
[abbreviation] "BVA" -> 14.636, 14.637, 20.704, 20.1305, 20.603  6.0ms
[abbreviation] "NVL" ->   0.4ms
[natural-phrasing] "veteran with a mental disorder rating" -> 3.278, 21.3021, 17.110, 4.125, 4.129  77.1ms
[natural-phrasing] "how much compensation for loss of use of a hand" -> 3.204, 17.500, 21.9640, 1.460, 3.3  106.0ms
[natural-phrasing] "rating for service-connected tinnitus" -> 3.204, 17.500, 21.9640, 1.460, 3.3  18.5ms
[quoted-phrase] "\"aid and attendance\"" -> 3.352, 3.552, 17.151, 3.504, 3.23 (3.352@1 3.504@4) 3.8ms
[quoted-phrase] "\"special monthly compensation\"" -> 3.350, 17.151, 3.155, 4.75, 4.97 (3.350@1) 3.6ms
[ambiguous] "respiratory" -> 4.97, 4.96, 1.460, 17.3230, 3.309 (4.96@2 4.97@1) 3.6ms
[ambiguous] "dependency and indemnity compensation" -> 3.1000, 3.1, 3.400, 3.160, 3.262  18.6ms
[appendix] "Appendix B to Part 4" -> Appendix B to Part 4, 21.4263, 18.423, 14.600, 18.4 (Appendix B to Part 4@1) 47.6ms
[appendix] "which appendices list amendments" -> 3.204, 17.500, 21.9640, 1.460, 3.3  13.6ms
[natural-phrasing] "va mortgage rates" -> 3.262, 21.9680, 3.263, 21.9681, 36.4301  13.7ms
[no-answer] "sf-8 form" -> 61.92, 61.1, 3.204, 21.9640, 1.460  14.1ms
[natural-phrasing] "purple heart recipients" -> 1.460, 21.4253, 3.303, 21.4254, 18.434  4.3ms
```
