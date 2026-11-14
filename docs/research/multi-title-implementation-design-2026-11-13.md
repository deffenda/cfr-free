# Multi-title implementation design — 2026-11-13

**Status:** implementation design, answering the decision brief of
2026-10-18 (`multi-title.md`). **Trigger fired:** that brief kept single-title
with three recorded revisit triggers; the first — an operator need for a
second title — fired by operator directive on 2026-11-13 ("make this the best
CFR tool", corpus-wide as the goal, title-by-title as the path). Stage E's
own gate is met the same way: operator-approved scope.

This document decides HOW. It authorizes no code by itself; each
implementation PR carries its SPEC changes in the same reviewed diff, per
the authority rule.

## 1. Scope and order

The goal is the full eCFR (49 non-reserved titles, live `titles.json` probed
2026-11-13). The path is one title at a time, each gated by the M3-style
discipline: per-title fidelity fixtures, a per-title measured baseline, and
the honest-record convention. Title 38 remains the default surface; every
other title is opt-in per query until its own quality record exists.

**First title: 32 (National Defense).** Measured against the live eCFR on
2026-11-13:

| Title        | Raw XML | Sections | Claims adjacency                                                                                                                                                                                             |
| ------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 38 (shipped) | 9.6 MB  | 2 953    | the mission                                                                                                                                                                                                  |
| 32           | 13 MB   | 3 640    | Parts 70–73: discharge review boards and records correction — the regulations behind § 3.12's character-of-discharge determinations; a benefits denial on discharge character cannot be advised without them |
| 20           | 15 MB   | 5 634    | SSA offset/adjacency (§ 3.708) — queued second                                                                                                                                                               |

Title 32 wins the first slot on directness: § 3.12 itself turns on discharge
character, and the discharge-upgrade path is governed by 32 CFR parts 70–73.
That is the strongest form of M8's "observed tasks cannot be completed
without it." Title 20 queues second.

## 2. The seven coupling points, decided

The 2026-10-18 brief inventoried seven couplings (verified file:line there);
each gets a concrete decision here:

1. **`sections.citation TEXT NOT NULL UNIQUE`** → add `title INTEGER NOT
NULL`; unique key becomes `(title, citation)`; `cited_citation` in
   `section_references` gains a `title` scope column pair `(citing_title,
cited_citation)` resolved through the citing row's title (edges stay
   within one title at extraction — a Title 32 section citing "§ 70.3" means
   Title 32's; cross-title references are out of scope and recorded as a
   non-goal). FTS5 external-content triggers move together with the schema
   (all three, per the single-schema rule) and key on `rowid` as today; the
   FTS citation column keeps indexing the bare citation text for matching —
   disambiguation is the `sections` join's job.
2. **`TITLE_38 = 38` and the versioner URL templates** → `EcfrApi` takes the
   title as a parameter; every fetch/text URL template is title-parameterized.
   The archive floor (2017-01-01) is a Title-38 corpus fact; per-title
   structure probes set each title's own floor before first sync and record
   it in `meta` (never assumed equal to Title 38's).
3. **Hardcoded `title-38` deep links** (verify/historical URLs in service and
   MCP resources) → the point-in-time URL contract gains the title segment
   (`/current/title-N/section-…`); generated URLs always carry the section's
   own title; SPEC §5's URL shapes update in the same diff.
4. **Single index file** → one multi-title store (not per-title files): one
   FTS index, one connection pool, one backup/export unit, and cross-title
   queries stay a SQL filter away. Migration: schema version bump; existing
   files adopt through the established wholesale-rebuild path
   (`allowSchemaUpgrade` + full re-sync, ~5 s measured for Title 38). No
   per-title migration states.
5. **Count/metric/wire surfaces** → `meta` carries per-title `issue_date`
   and corpus receipt (the receipt becomes a title → hash map; comparability
   stays per-title). Search responses gain a `title` field on every hit;
   counts (`total`) stay per-query and are unchanged in shape. `/metrics`
   gains per-title gauges alongside the aggregates.
6. **Sync budget** → the sync command takes a title (default 38); the
   refresh scheduler iterates enabled titles serially (order: 38 first, then
   ascending by number). Estimated per-title cost scales with measured XML
   size: Title 32 ≈ 1.4× Title 38's 4.65 s end-to-end — seconds, not the
   brief's feared 10–30 min, for these first titles; the estimate is
   re-measured per title and recorded.
7. **Tests and fixtures** → seeded-store helpers gain a title (default 38 so
   existing tests are unchanged); fidelity fixtures are per-title (Title 32
   fixture lands with its sync PR); the retrieval benchmark stays Title-38
   keyed (a per-title benchmark is part of that title's acceptance, not a
   retrofit).

## 3. Authority discipline (the M8 non-negotiables)

- Every hit, section read, citation display, copy-a-citation block, and
  exported row carries its title; the display form reads "32 CFR § 70.1"
  beside "38 CFR § 3.12" — two authorities are never blended into one
  unlabeled list (M8's own rule).
- Search defaults to Title 38 (wire-compatible). A `title` parameter takes a
  number or `all`; cross-title ranking is allowed only with `title=all` and
  every hit labeled; per-title filters (`part`, `chapter`) keep working
  within the selected title.
- The citation pin (exact "§ 70.1"-style lookup) requires a title when the
  citation exists in more than one enabled title — an ambiguity error beats
  a silent Title-38 assumption.
- Cross-title citation edges, cross-title ranking weights, and multi-title
  redline/diff are non-goals for this packet; each is its own design round.
- Per-title amendment/structure probes run before first sync; a title whose
  structure parse fails its sanity check (parsed vs structure count) is not
  enabled, and the failure is recorded.

## 4. Acceptance per title (the M3 gate, generalized)

1. Fidelity: the title's own fixture set passes the corpus-fidelity gate
   (the probe's DIV-tag constructs are eCFR-wide; the fixture data is
   per-title).
2. Measurement: a per-title frozen-query baseline exists before any
   ranking claim; the Title-38 benchmark is never re-tuned by per-title
   work.
3. Records: ROADMAP M8 and the delivery log carry the title's packet ID,
   PRs, reviewed SHAs, gate tails, CI links, and measured sync/search
   numbers.
4. The SPEC changes (schema §4, API §5, ranking §4.1 notes) land in the same
   diffs as the code.

## 5. Rollout

1. Schema + config: `title` column, `(title, citation)` key, edge-table
   scope, per-title meta, version bump with wholesale-rebuild adoption.
2. Sync: title-parameterized `EcfrApi` + sync command/scheduler; Title 32
   first sync, floor probe, fidelity fixture.
3. Wire: `title` field/param, ambiguity rule for pins, deep-link shapes,
   OpenAPI + UI label.
4. Records: ROADMAP M8, delivery log, README surfaces.
5. Title 20 next, then operator-picked order; remaining titles follow the
   same four steps each.

**Boundary.** No scraping, no ingestion beyond the eCFR API the sync already
uses, no new authentication surface, and no cross-authority blending are
implied by this design.
