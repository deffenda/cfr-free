# Multi-title support — decision brief (SPEC §13 row 24)

**Date:** 2026-10-18 · **Status:** recommendation, pending operator decision
**Evidence:** probed live (titles.json) + code inventory at `01fdb5b`

## The question

Row 24 floated `title_id`-keying "for future multi-title". A schema change
with zero consumers is exactly the "ship no data beats flaky data" trap in
another form — so this brief evaluates what multi-title would actually
cost, per the accuracy-first discipline.

## Scope of the real eCFR

- `titles.json` lists **50 titles, 49 non-reserved**, all currency-dated
  (sample: 2026-10-15).
- Title 38 (this project's scope) is comparatively small: 2 953 sections,
  9.6 MB raw XML, **4.65 s end-to-end sync** (measured 2026-10-18).

## Cost inventory (verified file:line at current main)

| #   | Coupling point                                                                             | Consequence for multi-title                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `sections.citation TEXT NOT NULL UNIQUE` (`src/core/store.ts:76`)                          | **The real decision**: citations collide across titles (§ 1.1 exists in many) — keying must become `(title, citation)` or schema-keyed, not an additive column. FTS5 external-content triggers must all three move together. |
| 2   | `TITLE_38 = 38` (`src/core/ecfr.ts:5`) + versioner URL paths (:70/:77)                     | Every fetch/text template parameterized                                                                                                                                                                                      |
| 3   | Hardcoded `title-38` URL forms (`src/core/service.ts:167,215`, `src/mcp/resources.ts:166`) | verify/historical deep links change shape → point-in-time URL contract + docs                                                                                                                                                |
| 4   | Single `~/.cfr-free/index.sqlite` (`src/config.ts`)                                        | Either one multi-title store (bigger FTS index, migration path) or per-title stores (retrieval surfaces change)                                                                                                              |
| 5   | `/metrics` gauge set + OpenAPI Health/search schemas + README tables                       | All count/field surfaces gain per-title dimensions or aggregate semantics                                                                                                                                                    |
| 6   | Sync budget: 49 titles × much-larger-than-Title-38 volumes                                 | Likely 10–30 min syncs → refresh-scheduler cadence contract reshapes; progress reporting (row 25) becomes material                                                                                                           |
| 7   | Percentages/metrics/docs + tests (~30 test files)                                          | Cross-product growth of fixtures and edge cases                                                                                                                                                                              |

## Recommendation

**Keep single-title (38).** Record multi-title as an explicit non-goal
under the accuracy-first mission, with recorded revisit triggers rather
than speculative code:

1. An operator/user need for a second title (e.g., claims workflows moving
   into Title 38 adjacent regulations);
2. eCFR cost/latency making Title-38-only the niche option (unlikely);
3. A change to how citations collide upstream (e.g., eCFR adopts globally
   unique citation identifiers — then keying becomes an additive column
   and the schema decision dissolves).

`title_id`-as-future-proofing is rejected: an unused column owns real
invariants (query paths, FTS sync triggers, migration) with no consumer
to justify them.

## Decision sought from the operator

- [ ] Accept: close row 24 as "Rejected speculative (this brief)".
- [ ] Or schedule multi-title as a real design round (est. multi-day,
      touching schema + API contract + all count surfaces; see table).
