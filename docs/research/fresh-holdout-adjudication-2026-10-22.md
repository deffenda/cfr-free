# Fresh-holdout expectation adjudication — 41 adjudicated entries

**Date:** 2026-10-22. **Status:** the entries are adjudicated as recorded
below; **as of 2026-10-23 the set is a structural gate** (see the 2026-10-23
sections at the end) with no numeric threshold: 41 entries (33 answerable,
8 no-answer), all `adjudicated`, after two burned-holdout duplicates were
removed (43 → 41 on 2026-10-23). The rulings below were the state on
2026-10-22; the file was **not a gate** until the operator ratified it —
selection made in chat 2026-10-22, recorded on issue #135 (opened
2026-10-22) — effective with the 2026-10-23 gate commit (see "What the
operator still owns").

**This records one thing and changes one thing.** It records the
adjudication of the expectations in `test/fixtures/retrieval/queries.fresh.ts`
— 43 queries written on 2026-10-21, every expectation marked
`adjudication: 'provisional'` — and it changes those expectations in the
file to the cross-checked result. It changes **no metric**: the frozen
dev set and the burned holdout are byte-for-byte as committed, the
evaluation runner is unchanged, and no reordering or re-scoping of any
existing set happened here.

## 1. How this was done

Two committee members (free-tier, independent of the author and of each
other) adjudicated the 43 entries **separately and blind to the
retriever**. Neither ran the evaluation runner or the search CLI — the
question being answered is "is this expectation right?", not "does the
retriever hit it?". Each member queried a **copy** of the corpus
(`cp ~/.cfr-free/index.sqlite /tmp/eval-*.sqlite`); the live index was
never opened in place.

|                     |                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Corpus              | `~/.cfr-free/index.sqlite`, issue date **2026-10-16**, **2 970** provisions (2 953 sections + 17 appendices) |
| Members             | two, independent, cross-checked against each other and against the corpus                                    |
| Blind to            | the retriever's output; each other's rulings; the prior adjudication's answers                               |
| Measured afterwards | the adjudicated set, once, with the repo's own runner                                                        |

The cross-check found **real defects in the author-written set**: seven
expectation amendments that landed in the file, an eighth expectation
ruling (§3.3) recorded in this document but never applied, and two
quoted-phrase queries rewritten (one whose string occurs nowhere in the
corpus; one whose string made the entry under-specified for its own
expectation). Git is the receipt: `git diff 1de9b90 1e9dee7 --
test/fixtures/retrieval/queries.fresh.ts` shows exactly seven `expected:`
changes and two `query:` changes — the seven landed amendments, not the
§3.3 ruling. Both members found the
no-answer set clean, independently and with receipts.

## 2. The no-answer set: 8 of 8 confirmed

Both members confirmed all eight candidates are genuinely out of corpus,
and I re-probed them. Every token returns **0** under both a `LIKE` scan
of `text` and `heading` and an FTS phrase match, on a connection where
positive controls return non-zero (`aid and attendance` 31, `tinnitus` 4,
`Purple Heart` 4, `presumptive` 18, `underwriting` 13). The positive
controls matter: a "no-answer" claim is exactly where a silent false
negative would be invisible, so the zeros are shown to be real absences
rather than a broken matcher.

**The no-answer set needs no change.**

## 3. The six §3 entries: five changed, one rejected

(The full-set count — seven expectation amendments and two query
rewrites across §3–§5 — is in the introduction; this section is the §3
part of it.)

### 3.1 `"attendance allowance for veterans"` — REJECTED as written

The quoted string occurs **nowhere**: 0 `LIKE` hits and 0 FTS phrase hits.
The corpus says **"aid and attendance"** (31 provisions). The topic is
present in the corpus, so this is not a no-answer case either — it is a
quoted-phrase query whose string is not a phrase in the corpus.

_Both members found this independently_ (A: "the quoted string occurs 0
times"; B: "0 LIKE hits, 0 FTS phrase hits … miscategorized").

**Ruling:** the entry is rewritten to the corpus's own phrase
(`"aid and attendance"`, 31 provisions) — still a quoted-phrase query,
but one whose string IS a phrase of the corpus. (The entry was later
removed at `6f459ec` as a burned-holdout duplicate.)

### 3.2 `"individual unemployability"` — a member's claim, checked and REJECTED

Member A proposed rewording the query, on the ground that the heading
reads "unemployability of the individual" and so the quoted form is not a
phrase of the corpus.

**Checked against the corpus and rejected:** `"individual unemployability"`
IS an exact phrase — 11 `LIKE` hits and 11 FTS phrase hits, carried by
3.341, 3.343, 3.350, 3.750, 3.1704, 4.28 and others. The heading's word
order is not the phrase's.

**Ruling:** the query stands as written and the expectation (§ 4.16) was
already right. A proposal that the corpus contradicts does not become a
ruling, and the cross-check is where it is caught. (The expectation
itself was later superseded by the 2026-10-23 all-match ruling — the
entry now carries the full 11-provision FTS set, §5.4.)

### 3.3 `"special monthly compensation rate"` — under-specified

The quoted string returns **0** `LIKE` hits, but the FTS phrase match
returns **3** provisions: **3.350, 4.71a, 4.73**. (The phrase without
"rate" reaches 16 provisions by FTS and 16 by `LIKE`, verified 2026-10-23
against the index; the cross-check's count of 8 did not reproduce and is
superseded.) The original expectation listed 3.350 alone, so the
set was under-specified for its own query.

**Ruling:** the expectation becomes all three provisions the phrase
actually reaches, and the query is reworded to the corpus's phrase. (The
query rewrite reached the file at `1e9dee7`; the expectation change did
not — the entry still carries `expected: ['3.350']` there under its
rewritten query `"special monthly compensation"` — and the entry was
removed at `6f459ec` as a burned-holdout duplicate, so this expectation
ruling is recorded here only.)

### 3.4 `"hearing impairment"` — incomplete

The phrase reaches 16 provisions by FTS and 14 by LIKE (verified
2026-10-23 against the index; the cross-check's original count of 8 did
not reproduce and is superseded), of which the three that answer the
question are **4.85** (Evaluation of hearing impairment), **4.86**
(Exceptional patterns) and **4.87** (Schedule of ratings—ear). The
original expectation listed 4.85 and 4.86 (git receipt: `expected:
['4.85', '4.86']` at `1de9b90`); 4.87 was the missing one.

**Ruling:** amended to all three. (Later superseded by the 2026-10-23
all-match ruling: the entry now carries the full 16-provision FTS set,
§5.4.)

### 3.5 `traumatic brain injury residuals` — the wrong object

The expectation was § 3.350 (Special monthly compensation ratings).
Member A's finding: **§ 3.352(b)(2)** reads "As a result of
service-connected residuals of traumatic brain injury" — the query's words
verbatim — while 3.350 only lists brain injury as one enumerated SMC
basis. Member B did not raise it.

**Ruling:** amended to 3.352. The corpus decides this: the question asks
about _residuals_, and 3.352 is keyed to that word.

### 3.6 `which rule covers presumptive service connection` — incomplete

The expectation was 3.307 and 3.309. Member B found **3.308**
("Presumptive service connection; peacetime service before January 1,
1947") is a distinct rule the query plainly covers. Verified: 3.307 and
3.308 are both headed presumptive-service-connection, and 3.309 is the
disease-specific one.

**Ruling:** amended to 3.307, 3.308, 3.309.

## 4. The disputes the corpus settled against a member

Three entries where the members disagreed, and the corpus decided.

### 4.1 `Purple Heart benefits` — BOTH amendments are wrong

A amended to `[17.36, 17.149]`; B amended to `[17.149, 17.108]`.

Neither is right. The corpus has **exactly four** Purple Heart mentions,
and every one is an **eligibility carve-out**, not a benefits provision:

| provision | heading                                 | the Purple Heart mention                                                        |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 17.36     | Enrollment—hospital and outpatient care | "veterans awarded the Purple Heart" qualify for enrollment without copay/offset |
| 17.149    | Sensori-neural aids                     | "Those awarded a Purple Heart" get aids                                         |
| 17.108    | Copayments                              | "A veteran awarded a Purple Heart" is exempt from copayments                    |
| 51.50     | Eligible veterans—nursing home care     | Purple Heart awardees are an eligible category                                  |

There is **no "Purple Heart benefits" provision in Title 38.** The query
asks for a thing the corpus does not have, and it is **plural and vague** —
a scope question the corpus cannot settle.

**Ruling:** the entry is reworded to what the corpus actually holds — the
Purple Heart **carve-out from copayments** (17.108) — with the expectation
narrowed to 17.108. The other three mentions are recorded in the
rationale. This is the one entry where **the author, not the committee,
chose the question**; the operator owns the final wording.

### 4.2 `what is the PTSD service connection rule` — B's amendment is wrong

B amended to `[3.304, 3.309, 3.310]`. Verified against the corpus:
**3.310 has no PTSD mention at all** — its heading is "Disabilities that
are proximately due to, or aggravated by, service-connected disease or
injury", which is the aggravation rule, not the PTSD rule. 3.304 carries
the PTSD service-connection paragraph (f); 3.309 carries the PTSD
presumption.

**Ruling:** amended to `[3.304, 3.309]` — the two provisions that carry
PTSD service-connection text. 3.310 is dropped. (For the change count:
this needed no edit — the entry already carried `[3.304, 3.309]` at
creation (`1de9b90`), so only B's proposed 3.310 was rejected.)

### 4.3 `BVA review` — both amendments point at the wrong thing

A amended to `[20.1]`; B amended to `[20.103, 20.104]`. The headings:

- 19.2 — "Appellant's election for review of a **legacy appeal**" (A's
  objection to 19.2 is right: it is scoped to legacy appeals)
- 20.1 — "Rule 1. **Purpose and construction** of Rules of Practice" (a
  construction rule, not review structure — A's amendment is wrong)
- 20.103 — "Rule 103. **Principal functions** of the Board"
- 20.104 — "Rule 104. **Jurisdiction** of the Board"

A generic "BVA review" query most plausibly means the Board's
**structure and functions** (20.103, 20.104). 20.1 is a construction
rule; 19.2 is legacy-appeal-specific.

**Ruling:** amended to `[20.103, 20.104]`.

## 5. The entries the corpus cannot settle (operator decisions)

These stayed **provisional** as written on 2026-10-22. The corpus does not
decide them, and the repo's precedent keeps content questions with the
operator. **All four were selected by the operator in chat on 2026-10-22
and recorded on issue #135 (opened 2026-10-22)**; each entry's rationale
in `test/fixtures/retrieval/queries.fresh.ts` carries its ruling as an
`OPERATOR DECISION 2026-10-23` note (the date the note was written into
the file): burial allowance is eligibility, not a rate (3.1704/3.1705),
MST is read as service connection (3.304/3.309), NSC stays broad
(3.303/3.309), and a quoted-phrase expectation is every product FTS
result for the phrase (item 4 below — the readings for `"service
connection"` (225), `"individual unemployability"` (11) and
`"hearing impairment"` (16)). The Purple Heart rewording (§4.1, where the
corpus settled the dispute and the operator owned the wording) carries a
note in the same form.

1. **`burial allowance rates`** — the corpus has **no rate**. § 3.1704
   and § 3.1705 authorize "the maximum burial allowance specified in
   38 U.S.C. 2307 / 2303" and set eligibility; no dollar figure exists
   anywhere in subpart B. (Verified: the only subpart-B section mentioning
   an amount is 3.1711, about government contributions, not a rate.) The
   query asks for something the corpus does not contain, so it is
   **reworded to eligibility** and the expectation is 3.1704/3.1705 — a
   ruling the corpus supports, but the choice of wording is the operator's.
2. **`MST`** — no provision in Title 38 is headed "military sexual
   trauma", and the phrase appears in exactly **two** provisions
   (17.2000 "Vet Center services" and 78.10 "Eligible individuals"),
   neither of which is a service-connection rule.
   Whether the abbreviation means the PTSD/psychosis presumption (3.309),
   the direct-service-connection rule (3.304) or the Vet Center
   entitlement (78.10) is **author intent**. The expectation is widened
   to `[3.304, 3.309]` — the two service-connection rules a practitioner
   would land on — and the rationale records the 78.10 reading.
3. **`NSC`** — genuinely ambiguous: "non-service-connected" makes 3.303
   the wrong object, but the corpus's own curated map treats `NSC` as
   shorthand for service-connection rules generally. Both readings are
   covered by `[3.303, 3.309]`. Separately, A's observation stands: this
   entry is a **weak test** — its own rationale concedes it reaches
   service-connection rules generally, which makes it hard to distinguish
   from two other queries in the same file. The operator may replace it
   with a near-miss that is actually out of corpus.
4. **The quoted-phrase POLICY — and the repo's own two frozen sets already
   disagree on it.** A quoted phrase reaches many provisions
   (`"service connection"` matches 60 by `LIKE` and 225 by FTS). Does a
   quoted-phrase query expect _every_ provision carrying the phrase, or
   only the canonical one? The two readings differ by an order of
   magnitude, so as written the set could not be used for measurement
   until this was settled (it was — selected in chat 2026-10-22, recorded
   on issue #135; see the end of this item).

   **There is no settled precedent to follow, because the two existing sets
   already answer it differently:**

   | set     | query                            | expectation                                                                                                                                                          | reading                                                                                                                                                                                                                                                                        |
   | ------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | dev     | `"schedule of ratings"`          | **16** provisions — every section whose heading begins "Schedule of ratings" (the state when this question was settled; now 18 under the all-match rule — see below) | the FULL set; the rationale then on record in `queries.dev.ts` read "a single-section expectation for a phrase with no subject is a weak ground truth, so the committee ruled that the honest answer is the set" — replaced by the all-match rationale in the 2026-10-24 round |
   | holdout | `"aid and attendance"`           | **3** provisions (3.504, 3.352, 3.350)                                                                                                                               | a CURATED set                                                                                                                                                                                                                                                                  |
   | holdout | `"special monthly compensation"` | **1** provision (3.350)                                                                                                                                              | the CANONICAL provision                                                                                                                                                                                                                                                        |

   B flagged this as a policy question; it is the operator's, and the
   disagreement above is the reason it is the operator's rather than the
   committee's. As written on 2026-10-22 the fresh entries took the
   **canonical-provision** reading, and the fresh entry for
   `"aid and attendance"` (since removed as a burned-holdout duplicate)
   illustrated the disagreement most sharply — the two frozen sets would
   answer the SAME query text differently (the holdout expects three
   provisions; the fresh entry expected one). **RESOLVED — selected by
   the operator in chat on 2026-10-22, recorded on issue #135 (opened
   2026-10-22): a fresh quoted-phrase expectation is EVERY product FTS
   result for the phrase.** This was a FRESH-SET rule at the time of the
   fresh set's adjudication; it reached the dev set in the 2026-10-24
   round, where the dev set's then-heading-based quoted-phrase
   expectations (16 provisions for `"schedule of ratings"`, 1 for
   `"evaluation of hearing impairment"` — the product FTS totals are 18
   and 2) were aligned to the rule and the dev baseline re-measured
   (recorded in `docs/research/retrieval-residuals-2026-10-21.md`). The
   surviving entries carry the full sets (225 / 11 / 16 provisions for
   `"service connection"`, `"individual unemployability"` and
   `"hearing impairment"`); the holdout's curated expectations in the
   table above remain byte-frozen as a regression set, not a policy
   carrier.

## 6. What changed in the file

`test/fixtures/retrieval/queries.fresh.ts` — the expectations and
rationales of the entries above, and the `adjudication` markers. **Four
entries' query text changed in all. Two were rewritten by the cross-check**
(3.1 — whose quoted string occurs nowhere in the corpus, so no corpus
result could ground it as a quoted-phrase query; 3.3 — whose string does
occur but under-specified the entry for its own expectation; in both,
rewording is what makes the entry a valid instance of its category;
§3.2's claim was rejected, so its query stands as written) **and two
were reworded by the operator's rulings** (selected in chat 2026-10-22,
carried in the 2026-10-23 gate
commit): burial allowance →
eligibility and Purple Heart → copayment exemption (§5.1 and §4.1).

**As written on 2026-10-22, the set was not a gate.** It became a
structural gate on 2026-10-23 (see the section at the end). The original
plan recorded here was that it would become one when the operator ratified
the four §5 decisions, at which point the `adjudication` markers could
move from `provisional` to `adjudicated` and the set could gate a
threshold-bearing round once a threshold was separately ratified. What
happened on 2026-10-23 is the ratification, the marker move, and the
structural gate — no threshold-bearing round has run (the baseline below
sets no threshold).

## 7. What the operator still owns

1. The four §5 content decisions (burial-allowance wording, MST scope,
   NSC scope, and the quoted-phrase policy). **Done — selected in chat
   2026-10-22, recorded on issue #135, see §5.**
2. Ratification, which is what makes the set gate-worthy. **Done for the
   fresh set — selected in chat 2026-10-22, recorded on issue #135
   (opened 2026-10-22). The runner AC landed (CI now exercises the fresh
   set through the runner against the hermetic seeded corpus), and the
   dev realignment landed in the 2026-10-24 round, so every #135 AC is
   satisfied and the issue closes on that round's merge** (see the
   2026-10-23 sections below and the 2026-10-24 section in
   `docs/research/retrieval-residuals-2026-10-21.md`).
3. Whether to replace `NSC` with a stronger near-miss. **Open** — the
   ruling kept the entry broad, which leaves the weak-test observation
   (§5.3) standing.

The subject-index reopen condition (ROADMAP §M3) is **unaffected**: it
turns on the pilot's `E3` count, not on this set. This adjudication
changes no roadmap decision.

## 8. Reproducing this

```bash
cp ~/.cfr-free/index.sqlite /tmp/eval-index.sqlite   # never the live index
CFR_INDEX_PATH=/tmp/eval-index.sqlite npx tsx test/fixtures/retrieval/run.ts fresh
```

Note on running this without installs: `tsx` is not a repo dependency, so
`npx tsx` fetches it from the registry and fails offline in a worktree
without `node_modules` (installs are forbidden there). Be precise about
what each path reproduces. The `run.ts fresh` command above (online)
prints the full report — totals, MRR, no-answer violations, provenance
and the per-category recall@5 line. The hermetic path —
`npx vitest run test/retrieval-eval.test.ts`, under the repo's standard
disclosed `node_modules` symlink from a checkout at the same commit —
re-runs the structural gate and exercises the fresh set through the
runner against the hermetic seeded corpus; it prints no metrics, and its
seeded-corpus outcomes are not the baseline (the baseline needs the real
corpus index). The per-category exact-citation cells in the
measured-baseline section below came from a one-off probe over
`evaluateSet` in `test/fixtures/retrieval/run.ts` — a throwaway script,
not a committed entry point — so reproducing them offline means rebuilding
that probe under vitest; no committed command prints those cells.

The two member findings are recorded verbatim in the review record for
this round; the corpus receipts quoted above (the 0-hit probes, the FTS
phrase hits, and the heading checks) are reproducible with `node:sqlite`
against the copied index.

## 2026-10-23 — gate wiring and two removed duplicates

- Gate: `test/retrieval-eval.test.ts` now asserts the fresh set structurally (41 entries, all adjudicated, unique, disjoint from dev and the burned holdout, 33 answerable / 8 no-answer). No numeric threshold is set.
- Removed two fresh entries, `"aid and attendance"` and `"special monthly compensation"`. Their query text is identical to burned holdout entries, so they were not unseen. Answerable count 35 → 33; total 43 → 41.
- Caveat on quoted-phrase entries (ratified by the committee, 2026-10-23): under the all-match policy every quoted-phrase expectation equals the full FTS result set for that phrase. Those entries cannot discriminate ranking quality. Scoring is inclusion-based (`run.ts`), so a quoted entry fails only when none of its top 5 is in the expected set. Dropping one expected citation from a long list is not detected.
- Disjointness is exact-string only. Near-duplicates are not caught. Example: fresh `"hearing impairment"` is a substring of dev `"evaluation of hearing impairment"`.
- Changes carried in from earlier work, recorded here for the first time: the two rewrites (3.1, 3.3), whose entries were later removed as burned-holdout duplicates (so no cross-check rewrite survives in the set); the two operator rewordings that do survive (burial allowance → eligibility, Purple Heart → copayment exemption); and the quoted-phrase expectation sets for `"service connection"`, `"individual unemployability"`, and `"hearing impairment"` expanded to the full FTS set. The expansions are the operator's 2026-10-22/23 all-match ruling; it has since reached the dev set — the dev set's heading-based quoted-phrase expectations (16 for `"schedule of ratings"`, 1 for `"evaluation of hearing impairment"`) were aligned to the FTS totals (18 and 2) when the policy reached the dev set (2026-10-24 round; re-measured dev baseline in `docs/research/retrieval-residuals-2026-10-21.md`). The quoted `"special monthly compensation"` entry was also removed (see the first bullet of this section).
- Expected lists in the quoted-phrase entries are string-sorted, not numerically sorted. Scoring is set-based, so this has no runtime effect.

### Handoff state (2026-10-23)

- Branch `feat/m3-fresh-final`, commit `3388e26` on top of `2228085`. A byte-identical uncommitted copy sits in worktree `.opencode-worktrees/sf-m3-reviewed` (branch `sf/m3-fresh-final-reviewed`); leave it alone.
- Local gate: `npm run ci` exit 0, 709 passed, 1 skipped (run with a disclosed `node_modules` symlink, removed after).
- Independent review of `3388e26`: APPROVE, no P0/P1, four P2 doc fixes. Those fixes were amended into the same commit (unpublished at the time), so the final SHA needs its own review.
- Open, not in this change: dev quoted-phrase re-measure (patch saved outside the repo at `$TMPDIR/opencode/dev-quoted-phrase-edits.md`) — closed in the 2026-10-24 round, which applied the policy to the dev set and re-measured the dev baseline; stale counts at `ROADMAP.md:355` and `docs/research/retrieval-residuals-2026-10-21.md:12-17` — corrected in the `chore/docs-m3-baseline` round (PR #142; see the housekeeping note in the 2026-10-23 section below).
- Repo context: PR #139 (`chore/agents-fleet-standard`) is open and CLEAN; it would replace the agent-file contract this round followed. Main CI is green at `2228085`.
- Limit: the runner checks only the top 5 (`run.ts`, `topHitExpected` and `recallAt5`). Expected provisions ranked below 5 are never checked, so the gate cannot detect a missing result beyond rank 5.
- Scope: `test/fixtures/retrieval/queries.dev.ts` is NOT changed by this round. The dev quoted-phrase realignment landed in its own round (2026-10-24): expectations aligned to the FTS totals and the dev baseline re-measured, recorded in `docs/research/retrieval-residuals-2026-10-21.md`.
- `adjudicated` in `queries.fresh.ts` now means settled by the corpus or by an operator ruling of 2026-10-22/23. Seven entries that were operator-decided are marked this way.

## 2026-10-23 — measured baseline of the gated set

The first measurement of the gated 41-entry set, taken against the state
at `6f459ec` (PR #141). (An earlier preliminary run on the original
43-entry set is recorded in `docs/research/retrieval-residuals-2026-10-21.md`;
the two are different sets and not comparable.) It sets no threshold —
that would need separate operator ratification — and no ranking or scoring
change accompanies it. Runner: `test/fixtures/retrieval/run.ts fresh`
against the local index with `CFR_INDEX_PATH` override (top-5-only limit
as in the handoff above), index issue date 2026-10-16:

| metric               | value |
| -------------------- | ----- |
| exact-citation       | 17/33 |
| recall@5             | 23/33 |
| MRR                  | 0.596 |
| no-answer violations | 0/8   |

By category — the runner's "by category" line prints recall@5
(`test/fixtures/retrieval/run.ts`); exact-citation below is the count of
outcomes with `topHitExpected` grouped by `category`, re-derived 2026-10-23
from `evaluateSet` on the same index (both columns sum to the table above):

| category         | exact-citation | recall@5 |
| ---------------- | -------------- | -------- |
| abbreviation     | 0/7            | 1/7      |
| bare-citation    | 6/6            | 6/6      |
| display-citation | 5/5            | 5/5      |
| natural-phrasing | 3/12           | 8/12     |
| quoted-phrase    | 3/3            | 3/3      |

No-answer: 0/8 violations (recall@5 is not defined for a no-answer case —
the runner prints 0/8 there by construction). The quoted-phrase row cannot
discriminate ranking quality: under the all-match policy those
expectations are the full FTS result sets (caveat in the 2026-10-23
section above).

Provenance: darwin 25.6.0 arm64, node v26.12.1, 8 cpus, 24576 MB; index
issue date 2026-10-16; 41 adjudicated entries, 0 provisional.

Housekeeping for the docs round that records this (`chore/docs-m3-baseline`):
the stale counts the handoff names at `ROADMAP.md:355` and
`docs/research/retrieval-residuals-2026-10-21.md:12-17` are corrected
there. The handoff's "final SHA needs its own review" was reported
satisfied at merge time, but no canonical artifact of that review exists —
PR #141's body records the review of `05d34a3` and says a fresh review was
required at `f4b7228`, and the journal has no entry — so an audit should
treat it as an unverified claim, recorded here as a process gap. Also
open at the time of that measurement, since closed: the dev
quoted-phrase re-measure saved outside the repo
(`$TMPDIR/opencode/dev-quoted-phrase-edits.md`) — it landed in its own
round (2026-10-24): expectations aligned to the FTS totals, dev
baseline re-measured, recorded in
`docs/research/retrieval-residuals-2026-10-21.md`.
