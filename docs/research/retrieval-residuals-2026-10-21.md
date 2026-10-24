# Retrieval residuals and fresh holdout — 2026-10-21

## Status

This is a measurement artifact for M3 items 2 and 3, written 2026-10-21.
**Updated 2026-10-23:** the fresh set is adjudicated and is a structural
gate (no numeric threshold) since `6f459ec` — 41 entries, 33 answerable and
8 no-answer, all `adjudicated`. The counts below marked "2026-10-21
snapshot" are the set as it then stood and are kept as written; the current
record is `docs/research/fresh-holdout-adjudication-2026-10-22.md`. The
burned 2026-10-16 holdout remains a regression set only.

## Fresh holdout

`test/fixtures/retrieval/queries.fresh.ts` was written before running the
retriever (two queries were later rewritten on corpus evidence — both
rewritten entries were then removed at `6f459ec` — and two reworded by
operator ruling; see the adjudication record); it is separate from
`queries.dev.ts` and `queries.holdout.ts`.
**2026-10-21 snapshot:** 43 queries — 35 answerable and 8
proposed no-answer cases — all marked `adjudication: 'provisional'`, with
a category tally of 6 bare citations + 5 display citations + 7
abbreviations + 12 natural-phrasing + 5 quoted-phrase + 8 no-answer = 43.
**Current (2026-10-23):** 41 queries — 33 answerable and 8 no-answer, all
`adjudicated`; two quoted-phrase entries were removed because their query
text duplicated burned-holdout entries, so the quoted-phrase tally is now 3.

The set intentionally includes bare and display citations, abbreviations,
natural phrasing, quoted phrases, and out-of-corpus candidates. Before it
could gate anything, an expert had to:

1. verify each expected provision against the provision heading and the
   question asked;
2. record a corpus-grep receipt for each no-answer candidate, with at least
   8–10 genuine out-of-corpus cases retained;
3. record disagreements and the final expected set without changing query
   wording; and
4. read the adjudicated set exactly once as the first threshold-bearing
   evaluation.

**Status of the four (2026-10-23):** items 1 and 2 are done — the record
is `docs/research/fresh-holdout-adjudication-2026-10-22.md`. Item 3 was
done with recorded DEVIATIONS: query wording WAS changed — two entries
rewritten by the cross-check (§3.1 and §3.3), both removed at `6f459ec`
so only the operator rewordings survive in the gated 41, and two
reworded by operator ruling (§4.1 and §5.1), all recorded in the
adjudication record. Item 4 has
NOT happened: no threshold-bearing evaluation has run, and the
2026-10-23 baseline is explicitly non-threshold. How the "read exactly
once" discipline counts non-threshold baseline reads is not stated
in-repo and is the operator's to rule when the first threshold-bearing
round opens.

The preliminary run against the 2026-10-16 local index produced 18/35 exact
citations, 21/35 recall@5, MRR 0.5524, and 0/8 no-answer violations (on the
original 43-entry set; the gated 41-entry set's baseline is 17/33, 23/33,
MRR 0.596, 0/8 — recorded in the adjudication record). A corpus
grep over both `sections.text` and `sections.markdown` returned zero matches
for every token in the eight proposed no-answer cases:

| Candidate queries                                                               | Corpus token counts |
| ------------------------------------------------------------------------------- | ------------------- |
| `tokamak superconductivity astrophysics`; `ichthyology cladistics elasmobranch` | 0 for all 6 tokens  |
| `volcanology seismograph calibration`; `glaciology firn densification`          | 0 for all 6 tokens  |
| `myrmecology eusociality formicidae`; `ornithology passerine plumage`           | 0 for all 6 tokens  |
| `paleontology stratigraphy ammonite`; `meteorology baroclinic cyclone forecast` | 0 for all 6 tokens  |

This is a reproducible corpus-receipt candidate, not expert adjudication: the
terms are intentionally out-of-domain and had to be accepted or rejected by
the adjudicator before they could gate anything (all eight were confirmed
out of corpus and adjudicated 2026-10-22/23).

The receipt was produced against a copied index with this exact query (one
row per token, searching both rendered columns without FTS stemming):

```sql
SELECT ? AS token, count(*) AS section_count
FROM sections
WHERE lower(text) LIKE '%' || lower(?) || '%'
   OR lower(markdown) LIKE '%' || lower(?) || '%';
```

The result was `section_count = 0` for every token listed above.

Run it only as a preliminary measurement with:

```bash
cp ~/.cfr-free/index.sqlite /tmp/eval-index.sqlite
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts fresh
```

## Residual failure inventory

The existing adjudicated measurement identifies one clear ranking failure and
several cases where the top result answers a related but different question.
The following split is intentional: it prevents a lexical tweak from being
presented as a legal-answer improvement.

| Class                             | Representative query                                                                                              | Observed problem                                                                                                                                             | Safe next action                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Wrong-programme lexical collision | `traumatic brain injury compensation`                                                                             | § 9.21 wins on body-term frequency over the Part 4 rating provisions; the heading-phrase rule cannot fire                                                    | Keep the part title visible; do not add a blocklist or score threshold without new evidence                        |
| Wrong benefit type                | `SMC`, `special monthly compensation`                                                                             | § 17.151 is a different invalid-lifts provision, not the requested rating schedule                                                                           | Observe practitioner navigation in M6; do not relabel it as a retrieval success                                    |
| Wrong question object             | `veterans dental benefits eligibility`, `military burial allowance rate table`, `VA loan underwriting guidelines` | The pre-2026-10-21 expectation treated a related eligibility, rate, or authority provision as wrong; later adjudication confirmed these topics are in-corpus | Preserve as historical adjudication evidence; do not treat them as current retrieval failures until re-adjudicated |
| Subject-level reach               | `PTSD` → § 4.125                                                                                                  | The diagnosis section is relevant by subject but does not contain the query vocabulary                                                                       | Reopen the subject-index brief only if M6 F2-B `E3` reaches the fixed majority threshold                           |

The current adjudicated baseline after the ranking round is **35/46 top-hit
accuracy** and **43/46 recall@5**, with **8** in-window-but-not-first cases. A
future change must report its effect separately on the wrong-programme case,
the related-but-wrong cases, and the subject-level case; a single aggregate
score is insufficient.

## Decision boundary

No implementation change to ranking, synonym expansion, or abstention is
authorized by this artifact. The evidence currently supports context and
measurement, not another lexical rule. The next engineering decision
requires both an expert-adjudicated fresh set (met 2026-10-23) and the M6
observation of whether users
recover from a non-first result by reading its heading/snippet or browsing the
structure.

## 2026-10-24 — dev quoted-phrase realignment and re-measure

The operator's quoted-phrase policy reached the dev set: a quoted phrase
expects EVERY product FTS result for the phrase. The policy was selected in
chat on 2026-10-22 and recorded on issue #135; it was applied to the dev set
in this round (2026-10-24). The dev set's two quoted-phrase entries were
heading-based; they now carry the all-match sets.

**Expectation changes** — the only edits to `test/fixtures/retrieval/queries.dev.ts`:

| query                                | before | after | added                           |
| ------------------------------------ | ------ | ----- | ------------------------------- |
| `"schedule of ratings"`              | 16     | 18    | `3.321`, `Appendix A to Part 4` |
| `"evaluation of hearing impairment"` | 1      | 2     | `3.383`                         |

**Verification.** Each set was checked two ways against a COPY of the
2026-10-16 index (`~/.cfr-free/index.sqlite` copied; the live index was never
opened):

1. Product FTS — the phrase query `toFtsQuery` builds for a quoted span
   (`src/core/store.ts`), `"<phrase>"*`, over the `sections_fts` table
   (tokenizer `porter unicode61`):
   `SELECT citation FROM sections_fts WHERE sections_fts MATCH '"schedule of ratings"*'`
   → 18 rows — the 16 committed citations plus `3.321` and
   `Appendix A to Part 4`; and the same query for
   `"evaluation of hearing impairment"` → 2 rows, `3.383` and `4.85`.
2. LIKE substring over the SAME surface the FTS indexes (`citation`,
   `heading` and `text`):
   `SELECT citation FROM sections WHERE lower(citation || ' ' || heading || ' ' || text) LIKE '%schedule of ratings%'`
   → 18 rows, the identical set; the same query for
   `evaluation of hearing impairment` → 2 rows, the identical set.

   The surface matters: a LIKE over the body `text` column alone returns 4
   and 1, and a LIKE over the heading alone returns exactly the OLD 16 and 1
   — the 16 heading-based citations match the HEADING, while `3.321`,
   `3.383` and `Appendix A to Part 4` carry the phrase in the body. Only the
   three-column surface is comparable to the product's FTS hit set.

**Re-measured dev baseline** (the runner, `test/fixtures/retrieval/run.ts`,
against the 2026-10-16 index copy): 30 queries, 29 answerable, 1 no-answer —
exact-citation **22/29**, recall@5 **28/29**, MRR **0.8448**, no-answer
violations **1/1**. Provenance: darwin 25.6.0 (arm64), node v26.12.1, 8 cpus,
24576 MB, index issue date 2026-10-16; 30 adjudicated expectations, 0
provisional.

**The numbers did not move.** The same probe over the PRE-realignment fixture
on the same index copy reports the identical 22/29, 28/29, 0.8448 and 1/1.
The reason is saturation plus monotonicity: both quoted-phrase queries were
already exact-citation successes — `"schedule of ratings"` ranks `4.87a`
first (expected by the old 16), and `"evaluation of hearing impairment"`
ranks `4.85` first (the old sole expectation) — so `topHitExpected` was
already true and the first expected hit already at rank 1, worth 1.0 to
MRR. Adding expectations can only turn a scoring boolean on or lower the
first expected rank, never the reverse, so a query already saturated on
every metric cannot move. (For `"schedule of ratings"` the two additions
`3.321` and `Appendix A to Part 4` also rank outside the runner's top-five
window entirely; for `"evaluation of hearing impairment"` the added
`3.383` sits inside it at rank 2 — it is included in the expectation but
was not the first expected hit, so it changed no metric.) The same
limitation is recorded for the fresh set in
`docs/research/fresh-holdout-adjudication-2026-10-22.md` (expected provisions
ranked below 5 are never checked). The dev baseline published in
`docs/research/retrieval-baseline-2026-10-20.md` (22/29, 28/29, MRR 0.8448,
1/1, after the 2026-10-21 exception-demotion round) therefore still stands
unchanged.

**Scope.** This touches the DEV set only. The fresh set's gated baseline
(17/33 exact-citation, 23/33 recall@5, MRR 0.596, 0/8 no-answer violations)
is unaffected — its quoted-phrase entries were already all-match. The burned
holdout remains untouched and unchanged: its curated quoted-phrase expectations
stay a frozen regression set, not a policy carrier.
