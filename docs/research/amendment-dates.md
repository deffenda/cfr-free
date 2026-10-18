# Research: per-section amendment dates (roadmap item 18)

Date: 2026-10-18 · Question: can `amendedAt` be attached to sections from an
eCFR-provided amendment metadata feed? · Verdict: **not bulk-derivable with the
current eCFR API family**; no code shipped. This note records the probes so the
question does not get re-researched from scratch.

## Probes (all live, issue date 2026-10-15, title 38)

| #   | Source                             | Probe                                                                                                                                                                                    | Result                                                                                                                                                                                                                   |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Versioner bulk feeds               | HTTP probes of every plausible amendment path (`/meta/…`, `/amendments/…`, `/amendment_dates/…`, `/versions/…`, `/dates/…`, `/issues/…`) and spec files (`openapi.json`, `swagger.json`) | **404 everywhere** — no section-level amendment feed exists                                                                                                                                                              |
| 2   | Search API `starts_on`             | `GET /api/search/v1/results.json?query=<section>&date=…`                                                                                                                                 | Per-hit `starts_on`/`ends_on` carry the section's content-version window (e.g. §4.130 → a real amendment date). Accurate, but **~1 request per section** → ~2 950 requests/title per sync                                |
| 3   | Appendix A (Table of Amendments)   | Parsed the indexed text of `Appendix A to Part 4`                                                                                                                                        | **Lossy ground truth**: the stored text strips most `Sec.` target cells (blank continuation rows group unrelated diagnostic codes), and max-date-per-section was provably wrong on sample (§4.130 → 2014 vs actual 2021) |
| 4   | Bulk title XML                     | `grep -c` for `AMDDATE`, `AMDEP`, `AMEND`, `ANTDATE`, `EDATE`, `AMDS` in `full/<date>/title-38.xml`                                                                                      | **0 occurrences** — eCFR's transform strips GPO amendment tags entirely                                                                                                                                                  |
| 5   | Recent-changes API                 | `GET /api/recent-changes/v1/results.json` (documented shape + params)                                                                                                                    | **Defunct** (404, even for the documented base shape)                                                                                                                                                                    |
| 6   | Whole-title enumeration via search | `query=§` (every `SECTNO` begins with it), pagination + `per_page`                                                                                                                       | `§` is not in the search index — 0 results                                                                                                                                                                               |

## Decision

The roadmap item was conditional ("_if derivable_, attach `amendedAt`"). Per the
accuracy-first mission, shipping no date beats shipping a flaky one for
adjudicators (option 3's wrong dates and option 2's per-sync flake/latency were
both rejected). The date-of-claim workflow is already served by the point-in-time
URL links in `getSection` responses and the `cfr_claim_evaluation` prompt
(`https://www.ecfr.gov/on/<YYYY-MM-DD>/title-38/section-<citation>`).

## Revisit triggers

Re-open this item if any of the following changes upstream:

1. eCFR publishes a section-level amendment/version feed (probe #1's paths, or a
   new API version).
2. GPO amendment tags reappear in the bulk XML (probe #4).
3. A bounded use-case justifies the per-section search cost (probe #2) — e.g. a
   single part of interest, opt-in via config, with strict identity matching
   (hierarchy section + type + title) and capped pagination.
