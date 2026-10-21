# Retrieval residuals and fresh holdout — 2026-10-21

## Status

This is a measurement artifact for M3 items 2 and 3. The fresh set is **not
adjudicated and is not a quality gate**. Its expectations must be reviewed by
an expert before any threshold, ranking change, or release claim uses it. The
burned 2026-10-16 holdout remains a regression set only.

## Fresh holdout

`test/fixtures/retrieval/queries.fresh.ts` contains 43 queries written before
running the retriever: 35 answerable queries and 8 proposed no-answer cases.
It is separate from `queries.dev.ts` and `queries.holdout.ts`. All 43 entries
are marked `adjudication: 'provisional'`. The category tally is 6 bare
citations + 5 display citations + 7 abbreviations + 12 natural-phrasing + 5
quoted-phrase + 8 no-answer = 43.

The set intentionally includes bare and display citations, abbreviations,
natural phrasing, quoted phrases, and out-of-corpus candidates. Before it can
gate anything, an expert must:

1. verify each expected provision against the provision heading and the
   question asked;
2. record a corpus-grep receipt for each no-answer candidate, with at least
   8–10 genuine out-of-corpus cases retained;
3. record disagreements and the final expected set without changing query
   wording; and
4. read the adjudicated set exactly once as the first threshold-bearing
   evaluation.

The preliminary run against the 2026-10-16 local index produced 18/35 exact
citations, 21/35 recall@5, MRR 0.5524, and 0/8 no-answer violations. A corpus
grep over both `sections.text` and `sections.markdown` returned zero matches
for every token in the eight proposed no-answer cases:

| Candidate queries                                                               | Corpus token counts |
| ------------------------------------------------------------------------------- | ------------------- |
| `tokamak superconductivity astrophysics`; `ichthyology cladistics elasmobranch` | 0 for all 6 tokens  |
| `volcanology seismograph calibration`; `glaciology firn densification`          | 0 for all 6 tokens  |
| `myrmecology eusociality formicidae`; `ornithology passerine plumage`           | 0 for all 6 tokens  |
| `paleontology stratigraphy ammonite`; `meteorology baroclinic cyclone forecast` | 0 for all 6 tokens  |

This is a reproducible corpus-receipt candidate, not expert adjudication: the
terms are intentionally out-of-domain and must still be accepted or rejected
by the adjudicator before they gate anything.

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
measurement, not another lexical rule. The next engineering decision requires
both an expert-adjudicated fresh set and the M6 observation of whether users
recover from a non-first result by reading its heading/snippet or browsing the
structure.
