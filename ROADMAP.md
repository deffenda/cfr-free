# cfr-free — product and delivery roadmap

## Open review findings — dispatch first

The six P1 findings from the 2026-10-21 implementation audit were **OPEN**
at the time of this grooming; **all six are now CLOSED** — the fixing PR,
the reviewed SHA and its verdict, the verified merge SHA and what each fix
does are in [the 2026-10-21 review handoff](docs/research/review-2026-10-21.md)
(issue #106), and the roadmap's own completion records are in the table below.
**P1-20261021-07 — the browse view's request identity — is CLOSED as NOT A
DEFECT**: it was measured, and the race cannot happen. Two browse requests
cannot overlap ON THE SAME ROUTE GENERATION — the tree is cleared for the
duration of a fetch, so a second click cannot start a second request — and
a re-render advances the route generation, so an older response is
discarded. The two tests that pin that are in `test/ui.test.ts`. It is
recorded in the same handoff. **The list of OPEN FINDINGS below is
therefore empty.** This is a review handoff, not an implementation or a closure
record.

The four P1 findings from the 2026-10-20 review were **OPEN** at the time
of this grooming; **all four are now CLOSED** (PR #66 → `6a3637e`, reviewed
`a793fe1`, APPROVE 0/0/0; PR #68 → `de524f5`, reviewed `61e7b43`, APPROVE
0/0/2; PR #69 → `405321b`, reviewed `57bc0a7`, APPROVE_WITH_NITS 0/0/1 then
RE_AFFIRM 0/0/0; PR #71 → `94e869a`, reviewed `8282a4a`, APPROVE 0/0/0 —
completion records in the review handoff). Implementation packets, evidence,
acceptance criteria, and gates are recorded in
[the review handoff](docs/research/review-2026-10-20.md) (issue #62).

## Competitive direction — proposed 2026-10-20

Tracking: [issue #62](https://github.com/deffenda/cfr-free/issues/62).
This section is a planning backlog, not a claim that the features exist.
`docs/SPEC.md` remains the sole design authority. Refine and verify every
packet against current code before dispatch; update SPEC alongside behavior.
Historical shipped items are preserved below. No paid service, publishing,
external outreach, new corpus, or procurement is authorized by this roadmap.

**Positioning hypothesis:** a self-hosted Title 38 source engine for VA
research tools, differentiated by offline retrieval, reproducible sources,
and demonstrated content fidelity. Primary early users: developers building
research assistants and technically supported advocacy teams. Test this
hypothesis before expanding into a general claims application.

### Market evidence and boundaries

Primary sources inspected 2026-10-20; recheck before making public comparisons:

| Alternative                                                                            | Observed offering                                                       | Consequence for our proposed work                                                                                             |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [Official eCFR](https://www.ecfr.gov/reader-aids/using-ecfr/ecfr-changes-through-time) | Historical views, date comparisons, change subscriptions                | Merely adding search or redlines does not establish an advantage. Make local results reproducible and verifiable.             |
| [eCFR.io](https://ecfr.io/developers)                                                  | Free keyless HTTP API and remote MCP, source-date and citation metadata | MCP access alone is insufficient differentiation. Prove offline operation and local ownership.                                |
| [VetPro](https://vetpro.us/)                                                           | Claims/client management, document submission, tracking, signatures     | Explore a research handoff into existing workflows before attempting case management. No integration relationship is claimed. |
| [NVLSP publications](https://nvlsp.org/publications/)                                  | Expert veterans-law manuals and analysis                                | Retrieval is complementary to expert interpretation. Do not market source lookup as a replacement for it.                     |

These observations establish feature overlap, not market share, willingness
to pay, or competitor quality. Public-domain text and protocol support are
replicable. Our proposed advantage must be earned through measured fidelity,
reliable operation, and useful workflow integration. Local retrieval does not
establish the privacy properties of a separately chosen AI client.

### Dispatch rules for the next session

1. Read `AGENTS.md` (the fleet standard plus this repo's rules). Consult
   `~/.orchestrator/JOURNAL.md` (operator-maintained, outside the repo), open
   PRs/issues, and current origin/main before
   claiming work. The journal recorded batch-8 E1–E6 on 2026-10-20: redline
   wire access, historical section reads, route metrics, UI redlines,
   ETag/304, and deeper browse navigation. Those entries are coordination
   pointers, not proof of shipment; inspect their live status and reuse work.
2. The four 2026-10-20 P1 packets are **CLOSED** (see above), as is
   P1-20261021-07 (the browse view's request identity), which was measured
   and is NOT a defect. Each of the four closed packets has its own
   evidence, candidate manifest, acceptance criteria, and test commands.
   **There is no open finding left to dispatch.** Keep each finding open until
   its fixing SHA has the required reviewer verdict — a finding closed by
   measurement, like P1-20261021-07, carries its own evidence instead.
3. The M-items below are packet families. Split each into small PRs, normally
   within ~300 net lines, with evidence pointers, exact authorized files,
   decided design, scope guard, tests, and a report format. Do not take an
   unresolved product/API decision into an implementation task.
4. Use a worktree and the repo branch patterns. No dependency installs; only
   reuse dependencies under AGENTS.md's same-commit link rule. A SureForge
   supervised contract is optional (fleet core); the standing pattern for
   this repo's code changes is one when the owner asks for it or the task
   needs a contract-bound run (see AGENTS.md), and agent-configuration
   files (`AGENTS.md`, `CLAUDE.md`) are ordinary change requests, not
   SureForge contracts. A merge needs an independent fresh-context review
   of the exact head SHA with no unresolved P0 or P1 findings; a new commit
   requires a fresh review — except a clean automatic merge of the base
   branch, which keeps the review — including for roadmap completion
   edits.
5. Authentication, schema migrations, CI/release changes and changes to the
   merge rule itself need the operator's sign-off before merge; the first
   three are AGENTS.md's merge floor, and merging follows the merge rule
   there. Publication and paid work need their separate authorization.
   Track dependencies explicitly; green checks do not authorize
   scope growth.

### Delivery order and exit gates

| Stage                     | Work                | Exit evidence                                                                                         |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| A: trustworthy baseline   | P1-01 through P1-04 | Four fixing PRs, reviewed SHAs, gate tails; no silent loss of graphics or stale-route repaint.        |
| B: reproducible retrieval | M1, M2, M3          | Offline fidelity fixtures, dated provenance, frozen retrieval evaluation and measured baseline.       |
| C: usable distribution    | M4, M5              | Verified onboarding and one end-to-end research/export workflow; reuse already queued E-items.        |
| D: validate demand        | M6                  | Operator-arranged practitioner study, task-level results, explicit continue/change/stop decision.     |
| E: selective expansion    | M7, M8              | Demand evidence and operator-approved scope; integration/support before corpus or platform expansion. |

M6 study design may start during A; recruiting, messages, and live sessions
remain operator-arranged or explicitly authorized. Stages specify acceptance
dependencies, not deadlines or a mandate to run all tasks in one session.

### M1 — Corpus fidelity beyond row counts

**Dependency:** P1-01. **Risk:** MEDIUM; any schema migration is HIGH.
**Verified baseline:** `src/core/xml.ts` renders text and pipe tables;
`test/fidelity.test.ts` has selected real-section fixtures. `test/live.test.ts`
checks corpus size, structure agreement, and selected reads. Those checks do
not prove all content inside each row survived rendering.

Refine two packets: (a) inventory unsupported/lossy constructs using a dated
live document; (b) preserve or explicitly flag them with offline fixtures.
Inventory graphics/formulas, table captions and footnotes, nested paragraphs,
reserved headings, numeric entities, and authority/source notes. Record
observed examples and counts with date/hash; never turn mutable live counts
into exact unit-test expectations. No automatic OCR or guessed legal text.
If local graphic caching is wanted, first decide download/size bounds,
source validation, offline behavior, attribution, and export handling.

Candidate scope: `src/core/xml.ts`, `src/core/sync.ts`,
`test/xml.test.ts`, `test/fidelity.test.ts`, `test/live.test.ts`,
`docs/SPEC.md`; propose a dated research inventory under `docs/research/`.
Acceptance: representative fixtures compare expected text and structure,
including negative cases; every known unsupported construct is preserved or
explicitly reported. A content change in a fixture must fail a meaningful
assertion. If adding completeness fields, refine HTTP/MCP/OpenAPI/export
consumers before dispatch rather than silently changing their contracts.
Checks: targeted parser/fidelity tests, `npm run ci`, and a separately logged
`LIVE_TESTS=1 npm test -- test/live.test.ts` when network access is available.

### M1 — Corpus fidelity beyond row counts — DONE (2026-10-20)

**Shipped:** both packets, in three reviewed PRs, all with the Nemotron
reviewer at the fixing SHA.

- **M1(a) — the dated inventory** — PR #73 → `c2a7fac`; inventory at
  `docs/research/corpus-fidelity-2026-10-20.md`, probe at
  `tools/corpus-fidelity-probe.mjs` (issue date 2026-10-16, 9 613 330
  bytes, sha256 `9506de6c…`). Verdict: APPROVE_WITH_NITS 0/0/3, then
  RE_AFFIRM 0/0/0 after the caveat fixup. **Finding: no construct class
  loses text** (footnotes, notes, editorial notes, extracts, sub-headings,
  source credits, authority notes, table footers — all intact in every
  provision that carries them); the loss was in MEANING.
- **M1(b1) — inline rendering** — PR #74 → `c7b0085`. A container mixing
  its own text with inline elements was rendered as blocks, splitting
  phrases across blank lines (upstream "Note to paragraph (<E T="01">g
  </E>)(1):" rendered as "Note to paragraph (⏎⏎g⏎⏎)(1):"). Fixed with a
  structural inline rule plus an explicit block-tag guard; whole-corpus
  diff: 2 970 provisions, 57 changed, every change whitespace-only, 0 lost;
  the defect is 55 provisions (the inventory's "at least 71" included the
  legitimate block boundaries the proxy also catches — 16 at the
  inventory's measurement, 17 after M1(b2)'s labelling, all paragraph
  endings, table rows and sibling list items). Verdict: APPROVE_WITH_NITS 0/0/1, then
  RE_AFFIRM 0/0/0.
- **M1(b2) — labelling** — PR #75 → `eedd913`. Footnotes and extracts are
  labelled ("Footnote:" / "Extract:", the document's own style) and
  sub-headings render as headings; notes and editorial notes are NOT
  re-labelled (all 70/33 already carry a self-labelling `<HED>`). Verdict:
  APPROVE 0/0/0. Whole-corpus diff: 73 provisions changed, 0 content
  changes after label removal, 0 lost.

**Two corrections the inventory itself required** (recorded in it, not
quietly absorbed): the footnote count was 274 because `<FP-1>`/`<FP-2>`
list items were counted as footnotes (the real count is 62), and the
claims that notes and editorial notes were unlabelled were wrong — the
upstream wording labels both.

**Not done, and why:** no local graphic caching (the roadmap's decision
step — download/size bounds, source validation, offline behaviour,
attribution, export handling — was not reached); no automatic OCR or
guessed legal text; no completeness field on the wire surfaces.

### M2 — Dated provenance and honest comparison semantics

**Dependency:** baseline fixes; coordinate with queued E1/E2/E5.
**Risk:** MEDIUM; storage-format migration is HIGH.
**Verified baseline:** `src/core/service.ts:185-190` links sections to
`/current/`; `src/core/diff.ts:67` and `src/core/sync.ts:145` hash body text;
`src/core/redline.ts:255` tests body equality. A heading-only amendment is
therefore absent from current text-change results. This is an observed
limitation, not a claim that legal effective dates can be inferred.

Refine separately: (a) add a dated verification URL while retaining the
current URL for navigation; (b) define a shared comparison payload including
heading and preserved body content; (c) decide whether visual changes require
separate source-asset fingerprints. Keep parser-caused changes distinguishable
from upstream amendments. Identify any compatibility/version transition for
existing sync hashes before coding. Do not conflate sync time, requested date,
upstream currency date, amendment date, or a claim's governing legal version.
Revalidate upstream date normalization before describing historical responses.

Candidate scope: `src/core/service.ts`, `src/core/changes.ts`,
`src/core/sync.ts`, `src/core/diff.ts`, `src/core/redline.ts`, their tests,
`src/mcp/tools.ts`, `docs/openapi.yaml`, `docs/SPEC.md`, `README.md`; split
these surfaces by packet. Acceptance: dated links accompany quotations;
heading-only/body-only/no-change fixtures behave as specified; reverse-date,
added/removed and parser-version cases stay deterministic. Historical reads
name what was requested and verified, never fabricate a served-revision date.
Checks: relevant service/change/sync/diff/redline/MCP/conformance tests plus
`npm run ci`; separately record live date probes. No schema change by default.

### M2 — Dated provenance and honest comparison semantics — DONE (2026-10-20)

**Shipped** in three reviewed PRs (the operator's M2 split into three
packets; the third is the queued E2 item):

- **M2(a) — the dated verification URL** — PR #77 → `bb3243c`. A section
  response now carries `sourceUrl` (the CURRENT text, for navigation) and
  `sourceUrlAtIndexDate` (the SAME provision at the revision the index
  was built from — the eCFR point-in-time form). The `/current/` form
  drops the revision; the dated form keeps it. Verified against the live
  site: both forms 302 to a canonical path, the appendix form must be
  URL-encoded (the unencoded form 404s), and eCFR's point-in-time archive
  covers 2017 onward — documented rather than left as a surprise 404.
  Verdict: APPROVE 0/0/0, then RE_AFFIRM 0/0/0.
- **M2(b) — the comparison payload covers the heading** — PR #78 →
  `e4fcca4`. § 3.17 was retitled ("Disability and death pension" →
  "Disability and survivors pension") with no body change, and a
  text-only hash called it "no change" in the sync report, in
  `cfr-free diff` and in the MCP diff tool. Measured: 1 heading-only
  amendment per ~2,921 provisions per year. The fingerprint now covers
  text AND heading, with **no hash-compatibility transition** (the
  baseline is the live index table, so the old rows already carry their
  headings — no one-time "everything changed" report). The line-level
  redline keeps its text-only contract, by design. Verdict:
  APPROVE_WITH_NITS 0/0/1 (a stale wire description) → RE_AFFIRM 0/0/0.
- **M2(c) — the point-in-time read** — PR #79 → `c4b4c8d`.
  `cfr-free historical <at> <citation>` and the MCP `get_section_at`
  return one provision as it stood at a date. The response NAMES THE
  REQUESTED DATE and never a served-revision date (eCFR serves the
  revision in force on a date without reporting which issue date that
  was); a date outside the archive (2017-01-01 floor, measured) is a
  clean not_found; the date and citation are validated before any fetch.
  Verdict: APPROVE 0/0/0.

**Decisions taken, with the evidence:**

1. Dated verification URL — ADDED (the roadmap's M2(a)).
2. Shared comparison payload — text AND heading, implemented as a content
   hash over both fields (no transition; the roadmap's precondition
   "identify any compatibility/version transition for existing sync hashes
   before coding" resolved to "none").
3. Source-asset fingerprints for visual changes — **DEFERRED**. The 15
   graphics in the corpus are only 3 distinct images (155 KB, legacy
   artifacts) and nothing shows they change; a fingerprint is cheap
   (15 requests) but would buy an unproven guarantee, and the marker
   already names the path for a consumer that wants to re-fetch.
4. An HTTP `?at=` parameter on `/api/v1/sections/{citation}` — **not in
   this round**: that route publishes a required-field response schema,
   so a conditional second shape on one path is a wire decision that
   deserves its own round. The CLI and MCP surfaces ship first.

### M3 — Measured retrieval quality for claims research

**Dependency:** P1-03 and M1 fixtures. **Risk:** LOW for evaluation data/report;
MEDIUM for changes to ranking, synonyms, snippets, or reference extraction.
**Verified baseline:** `src/core/store.ts:278-288` contains nine curated
acronym expansions; search is FTS5 with citation/heading weights. Existing
tests establish examples, not a practitioner relevance benchmark.

First propose a frozen, public/non-client query set with expected provisions,
source date, rationale, and operator/expert adjudication status. Include bare
and display citations, abbreviations, natural phrasing, quoted phrases,
ambiguous topics, appendices, and no-answer cases. Unreviewed expected answers
are provisional, not legal ground truth. Keep development and holdout sets
distinct; do not tune on the holdout. Proposed initial size: 30 development
and 20 holdout queries, subject to available expert review.

Report exact-citation success, recall@5, reciprocal rank, false-positive
examples, and measured query latency with machine/runtime/corpus provenance.
For repeatability measure warm local searches separately from sync/network.
Set improvement thresholds only after a baseline exists; require zero
regression on agreed exact-citation cases. Add synonyms only with observed
misses and negative examples; avoid speculative embeddings or paid models.
Candidate scope: proposed `test/fixtures/retrieval/` data and evaluation runner,
`test/store.test.ts`, `test/service.test.ts`, `src/core/store.ts`,
`src/core/references.ts`, `test/references.test.ts`, `docs/research/` report;
authorize each new path before coding. Checks: frozen offline evaluation,
targeted tests, `npm run ci`; record changed results and explain tradeoffs.

### M3 — Measured retrieval quality — BASELINE DONE (2026-10-20), follow-ups OPEN

**Shipped** (PR #80 → `320d05d`): a frozen query set (30 development + 20
holdout, disjoint), an offline evaluation runner over the product's own
search path, hermetic tests, and the baseline report
`docs/research/retrieval-baseline-2026-10-20.md`. Reviewer: APPROVE 0/0/0,
with every baseline number independently reproduced.

**Baseline (2026-10-16 index):** exact-citation success 13/26, recall@5
20/26, MRR 0.6006, and **no-answer violations 4/4**. Per category:
bare-citation 6/6, display-citation 4/4, quoted-phrase 2/2, natural-phrasing
5/6, ambiguous 1/2, **abbreviation 2/5**, appendix 0/1, no-answer 0/4.

**Four follow-ups the baseline produced. These are tickets, not notes —
none is ticketed anywhere else.**

| #    | Follow-up                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                       | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3-a | **Abstention** — the retriever never says "not in this corpus"               | 4/4 out-of-scope queries (dental benefits, burial allowance rates, TRICARE forms, home-loan underwriting) return five confident hits; an adjudicator asking about something Title 38 does not cover is handed plausible CFR text                                                                                                                                                                                               | **DECIDED 2026-10-20 — the four-band design is REJECTED; a narrower form ships.** A three-member committee (free-tier, independent of the implementer) measured the proposal against the corpus and found it fails on its own target cases: its `likely` band would have fired on two of the four out-of-scope queries, because those hits MENTION the right words in their body while their heading says something else (`BVA` → § 20.1301). A reassuring label on an unanswerable question is worse than no label, and the obvious bm25 score floor was measured falsified in both directions. **What shipped instead:** the response carries `matchedTerms`/`unmatchedTerms` (the query's content words the returned hits answered and did not answer — a statement about the RESULTS, never about what Title 38 covers), the MCP description states that hits are ranked by lexical overlap and not by legal authority, and the UI says honestly when nothing matched. Measured on the frozen 50: 4 queries flagged, 3 true catches, 1 false alarm. **NO band, NO coverage threshold, NO corpus-coverage claim.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M3-b | **Abbreviation coverage**                                                    | 2/5: `A&A` returns an unrelated top hit in 137 ms; `TBI` never surfaces § 3.350; `SMC` ranks its target 4th; `PTSD` ranks § 3.309 5th. The nine curated synonym groups do not cover these forms                                                                                                                                                                                                                                | **DONE (2026-10-20, `45cfef5`).** The failures were THREE BUGS in the existing expansion map, not missing entries: `dic` matched ONE section (98 use "dependency AND indemnity compensation"), `bva` matched SEVEN (75 use the apostrophe), and `A&A` was absent — its two single-letter tokens are dropped by the tokenizer, so the query degenerated into noise (top hit § 26.31). Measured: dev exact-citation 16/29 → 17/29, recall@5 25/29 → 26/29, MRR 0.6753 → 0.7098, abbreviation 4/5 → 5/5; holdout exact-citation 13/17 → 12/17 (the `DIC` query now returns five GENUINE DIC provisions — the expected one stays in the window but is no longer first; a ranking consequence, and the expectation's ORDER is still provisional).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M3-c | **The query set needs adjudication**                                         | all 50 expectations are `provisional` (the orchestrator's assumptions, not legal ground truth)                                                                                                                                                                                                                                                                                                                                 | **DONE (2026-10-20, `65c8b3c`).** All 50 entries were adjudicated by a two-member committee and then CROSS-CHECKED against each other and the corpus — which found errors in BOTH members (one proposed DIC sections whose headings are pension provisions; the other dismissed § 3.309 as merely mentioning PTSD). The baseline was RE-MEASURED against the corrected expectations: dev exact-citation 13/26 → 16/29, recall@5 20/26 → 25/29, MRR 0.6006 → 0.6753, no-answer violations 4/4 → 1/1. All 50 entries are adjudicated as of 2026-10-21 (the content by a two-member committee, cross-checked against the corpus; the ORDER by the same committee, 38 of 39 in agreement with one flip resolved on the corpus). **ORDER ADJUDICATED 2026-10-21 (provisional, cross-checked).** The ORDER of the 39 was adjudicated by the same two-member committee and cross-checked against each other and the corpus: **38 of 39 in agreement**, one flip resolved (the `respiratory` order — the operative scheduling provision § 4.97 first, member A's "genuinely co-equal" note recorded). Neither member flagged any expected member as not belonging, so no expected SET changes. **The ORDER changes NO metric** — the runner's exact-citation test is `expected.includes(top5[0])`, which is order-independent; it buys the M6 error taxonomy, not a smaller gap. **The CONTENT of the 39 remains the operator's to adjudicate.** Measured alongside it: of the 46 answerable queries, 42 have an expected provision in the top five but only 29 have it FIRST, and **twelve of the thirteen** in-window-but-not-first cases lead with a defensible SIBLING provision. The sibling-addition proposals — with the corpus evidence for each, the one genuine ranking failure (§ 9.21 for `traumatic brain injury compensation`), and the measured consequence (29/46 → 41/46 on the in-window cases, 43/46 on all fourteen) — are recorded in `docs/research/expectation-adjudication-2026-10-21.md` as an **OPERATOR CONTENT DECISION**: the frozen sets were NOT edited in that round, and the record proposes; the operator accepts or corrects. |
| M3-d | **Ranking order for natural phrasing**                                       | `schizophrenia` ranks the definitional § 3.384 above the criteria schedule § 4.130; `traumatic brain injury compensation` puts § 3.350 third. The right provision is usually in the top five, but a first-hit-only client would mislead                                                                                                                                                                                        | **DONE (2026-10-20).** SPEC §13 row 4 promised that "citation/heading matches outrank body-only hits", but the ranking was bm25 column weights (10/5/1) alone — bm25 weighs term frequency WITHIN a column, so a section whose body repeats the phrase ten times outranked a section whose HEADING is the phrase, and there was no post-hoc rule at all. The ranking now carries an explicit key: a hit whose heading carries the query's content terms as a PHRASE (or the corpus phrase a synonym stands for) is ordered ahead of body-only hits, bm25 breaking ties. The key requires the phrase, NOT merely one of the query's words: counting the words improved the dev set (exact-citation 17/29 → 20/29, MRR 0.7098 → 0.7874) but LOST three of the holdout's seventeen exact-citation hits, because a heading containing a generic term ("rating", "service", "recipients") outranked the provision that answers the question. Shipped form, measured on the frozen 50: dev recall@5 26/29 → 27/29, MRR 0.7098 → 0.7356; holdout MRR 0.7402 → 0.7549; NO regression on either set (exact-citation unchanged at 17/29 dev and 12/17 holdout). SPEC §4.1 now states the rule and the measurement behind it. **Remaining retrieval gap: 15 of 50 queries still miss their expected provision — vocabulary (2: "hearing loss" vs the corpus's "hearing impairment"), AND-mode strictness (3), and the top hit itself (29 of 46 answerable queries returned an expected citation FIRST).**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| M3-e | **AND-mode strictness keeps the governing section out of the candidate set** | the AND tier requires EVERY query word in a section, so a natural question's verb or noun can exclude the very provision that answers it: "how is hearing loss rated" wants § 4.85 "Evaluation of hearing impairment.", and § 4.85 contains neither "rated" nor "loss" — so it is not even a candidate, and no ranking rule can surface it. The OR tier only engages when the AND tier returns NOTHING, which it does not here | **DONE (2026-10-20).** The candidate set is now the OR tier — every provision matching AT LEAST ONE query term — and the AND tier is no longer a candidate tier but a RANKING boost. The order: the heading-phrase key (SPEC §4.1) DESC, the AND-tier membership DESC, bm25 ASC. The membership is computed in SQL (a CTE over the AND query, LEFT JOINed onto the ranked rows) — a JS prototype cost ~200 ms and ~700 ms on citation queries. `total` is the candidate set's size (plus the pinned citation when the candidate set did not hold it; the increment is identical on every page); `matchMode` stays and reports `or`. The pin's membership check asks about the OR tier: the AND tier reported an or-only pinned citation as absent and counted it twice. Measured on the frozen 50: dev exact-citation 17/29 → 17/29, recall@5 27/29 → 28/29, MRR 0.7356 → 0.7529; holdout unchanged (12/17, 14/17, MRR 0.7549). No regression on either set; the citation categories hold (the pin still firing). Candidate coverage of the 68 expected provisions: 50/68 → 67/68, and "how is hearing loss rated" now ranks § 4.85 SECOND (it was no candidate at all). SPEC §4.1 states the candidate set and the full order. **Remaining gap: 4 of the 46 answerable queries miss their expected provision (dev 1, holdout 3), 1 of the 68 expected provisions is outside the candidate set (§ 4.125 for PTSD), and 17 of the 46 do not return an expected citation FIRST.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**The subject gap (a decision, not a fix):** one frozen expectation is
still unreachable — § 4.125 for "PTSD" — because § 4.125 is the general
mental-disorders DIAGNOSIS section and its text contains no "PTSD", no
"posttraumatic" and no "stress disorder" at all. It is relevant by SUBJECT,
not by vocabulary, so no lexical mechanism can reach it. Closing that class
needs a curated, corpus-verified subject index (a benefit/topic → sections
map): a roadmap-sized build with a curation and maintenance cost, not a
search tweak. **DECIDED (2026-10-21): the subject index is NOT BUILT**, and the
decision is not a deferral. The measured demand is **one expected provision
in the current 92-member expected set** unreachable by vocabulary (the
M3-e row's 68 is the PRE-adjudication count), against a curation and
maintenance burden over 2,970 provisions — and the repository's standing rule is that
scope does not grow ahead of evidence. The reopen condition is **fixed now,
before any data exists**, so the decision cannot be reopened by
re-interpreting it later:

> **Reopen only if the pilot's `E3` count reaches a MAJORITY of the
> cohort's F2-B attempts** — the attempts that needed a provision the
> participant's own words could not reach (`docs/research/practitioner-pilot.md`
> §8, SC-7). At the planned N = 5 that is **3 or more**. Below that, the
> subject index is **CLOSED as not justified**, and the one known miss
> stays recorded rather than papered over.

The brief's shape is pre-written here, so a reopen is a formality rather
than another decision cycle: **topic map** — benefit/topic → sections,
keyed on the corpus's own part and subject-group structure, curated
against the corpus rather than invented; **curation effort** — one pass
over the 2,970 provisions, with the subject vocabulary taken from the
corpus's own headings and the eCFR's subject groups; **corpus-change
maintenance** — the map is invalidated by any amendment that adds, removes
or retitles a mapped section, so it needs a staleness check against the
index issue date; **acceptance measure** — the fraction of subject-index
expectations reachable by the participant's own words, measured on the
same benchmark, with the map's own curation defects counted separately
from retrieval defects.

**The holdout's status (recorded 2026-10-21, operator-approved):** all 50
entries were read and adjudicated, so the holdout is BURNED for threshold
selection and is never to be tuned against again. It is kept as the
**regression set** — the role it actually served in the M3-d/M3-e rounds,
where every shipped change was threshold-free, so nothing was fitted to it.
A FRESH holdout is to be built immediately before the first
threshold-bearing round, with the discipline the committee specified: at
least 40 queries written without looking at the retriever's output, at least
8–10 genuinely out-of-corpus cases each carrying a corpus-grep receipt, full
expert adjudication before it gates anything, and read exactly once.

**The fresh holdout is WRITTEN, ADJUDICATED, RATIFIED and GATED (PR #141,
`6f459ec`, 2026-10-23).** `test/fixtures/retrieval/queries.fresh.ts` carries
41 queries (33 answerable, 8 no-answer). The original 43 were written on
2026-10-21 before any retriever run. The cross-check rewrote two queries
(§3.1/§3.3 of the adjudication record) and both entries were later removed
on 2026-10-23 as burned-holdout duplicates — their query text duplicated
burned-holdout entries, so they were not unseen
(`"aid and attendance"`, `"special monthly compensation"`). The only
query-text changes the surviving 41 carry are two operator rewordings
(burial allowance, Purple Heart). Two committee
members adjudicated every entry against the corpus, blind to the
retriever's output, and the rulings were cross-checked against each other
and against the corpus
(`docs/research/fresh-holdout-adjudication-2026-10-22.md`). The
cross-check landed seven expectation amendments — an eighth ruling (§3.3
of the record) was recorded but never applied — and rewrote two
quoted-phrase queries: one whose string occurs nowhere in the corpus,
one whose string made the entry under-specified for its own expectation;
it also **overrode a
member** on one point (the corpus showed the disputed phrase IS exact), and
both members were wrong on another (there is no "Purple Heart benefits"
provision in Title 38 — all four Purple Heart mentions are eligibility
carve-outs). All eight no-answer candidates were confirmed out of corpus
with per-token receipts and positive controls.

**No entry stays `provisional`.** The four content questions the corpus
cannot settle (burial-allowance wording, MST scope, NSC scope, and the
quoted-phrase POLICY — §5 of the adjudication record) were selected by
the operator in chat on 2026-10-22 and recorded on issue #135 (opened
2026-10-22), each as an `OPERATOR DECISION 2026-10-23` note in the
entry's rationale: burial allowance is eligibility, not a rate
(3.1704/3.1705); MST is read as service connection (3.304/3.309); NSC
stays broad (3.303/3.309); and a quoted phrase expects EVERY product FTS
result for the phrase. The Purple Heart rewording (§4.1 — the corpus
settled the dispute, the operator owned the final wording) was recorded
the same way: the query asks the copayment exemption the corpus actually
holds (17.108). That last rule was FRESH-SET-ONLY and now reaches the dev
set too: issue #135's AC require the same policy on the dev set, and the
dev realignment landed in this round (2026-10-24) — every #135 AC is
satisfied and the issue closes on merge. The other AC (the offline runner
exercising the fresh set in CI) landed: `test/retrieval-eval.test.ts`
pushes all 41 entries through the runner against the hermetic seeded
corpus, with no numeric threshold.
The dev set's quoted-phrase expectations now follow the operator's
all-match rule, the same rule the fresh set carries: `"schedule of
ratings"` moves from 16 provisions to 18 and `"evaluation of hearing
impairment"` from 1 to 2, matching the product FTS totals (18 and 2)
exactly. The dev set was re-measured afterwards against the 2026-10-16
index — exact-citation 22/29, recall@5 28/29, MRR 0.8448, no-answer
violations 1/1 — the same numbers as before the realignment. Both queries
were already exact-citation successes (top hit expected, MRR contribution
1.0), and adding expectations is monotone — it can only turn a scoring
boolean on or lower the first expected hit's rank, never the reverse — so
a saturated pair cannot move. For `"schedule of ratings"` the two added
citations also rank outside the runner's top-five window entirely
(`4.87a, 4.87, 4.130, 4.150, 4.116`); for `"evaluation of hearing
impairment"` the added `3.383` sits inside it at rank 2 but was not the
first expected hit, so it changed no metric. The burned
holdout keeps its own expectations byte-for-byte as committed (the
burned holdout's curated quoted-phrase expectations remain a frozen
regression set, not a policy carrier) and is untouched by this change.
With the operator's ratification (selected in chat 2026-10-22, recorded
on issue #135) the fresh set became a
**structural gate**: `test/retrieval-eval.test.ts` asserts every entry
`adjudicated`, unique by exact query text, disjoint from the dev and
burned sets, and the 33/8 answerable split — and, since PR #143, pushes
all 41 entries through the runner against the hermetic seeded corpus
(arithmetic invariants only) — while it sets **NO numeric
threshold**, which needs its own operator ratification; the fresh set must
not be used to select thresholds or tune ranking. The measured baseline
(exact-citation 17/33, recall@5 23/33, MRR 0.596, no-answer violations
0/8, against the 2026-10-16 index) and its provenance are recorded in the
adjudication record.

**The operator's irreducible action (the one input no tooling replaces):**
adjudicate the 39 provisional expectations — INCLUDING their ORDER. **DONE
2026-10-21 by committee** (the content and the order were both adjudicated and
cross-checked against the corpus); what remains is the operator's expert
ratification of the dev set's 39-entry result — the 2026-10-22 operator
decisions recorded on issue #135 ratified the FRESH set as a gate after
review, not the dev set's result. The
order matters more than it looks: measured on the frozen 50, 42 answerable
queries have their expected provision in the top five, but only 29 have it
FIRST (the runner's measure: the top hit is one of the expected citations),
and twelve of the thirteen in-window-but-not-first cases are
sibling provisions where the retrieved section is a defensible answer
(§ 3.658 for § 3.5, § 4.86 for § 4.85, § 4.17 for § 4.16 — counted
exactly 2026-10-21, `docs/research/expectation-adjudication-2026-10-21.md`; the
earlier "about ten" was an estimate, and the example section was mis-cited:
§ 3.351 leads no query in the frozen 50). The "63%
top-1" figure therefore measures the committee's ranking preferences as
much as retrieval quality — so adjudicating the ORDER has TWO payoffs: it
makes the thresholds trustworthy, and it separates the ranking gap from the
ordering question.

> **The paragraph above is the PRE-adjudication picture and is kept as
> written.** The adjudication has since REJECTED those sibling proposals:
> the retrieved section is a different benefit type, a narrower exception,
> or a mechanic that presupposes the entitlement, not a defensible answer
> (`docs/research/expectation-adjudication-2026-10-21.md` §11.2). The
> current figures are **35 of 46** first and **43 of 46** in the top five
> (the ranking round, `496d24f`), with **eight** in-window-but-not-first
> cases — see "And the residual has been worked" below. The next engineering round is scoped accordingly: split
> the gap FIRST (which cases are real ranking failures, and which are
> ordering preferences), then design an instrument for the real ones — from
> the corpus's own structure, not from another lexical rule (M3-d already
> measured and rejected the weight-tuning variant).

**Reading the gap figures in this table:** the counts quoted in the M3-c, M3-d
and M3-e rows above (fifteen of fifty still missing; twelve of the thirteen
in-window-but-not-first; four of forty-six missing outright) are the
PRE-adjudication snapshot — measured against expectations that listed only
the committee's first choice, so they counted defensible siblings as misses.
The paragraph below supersedes them.

**And the split has been made (2026-10-21, `17f37ad`).** The committee
adjudicated the content, so the expected sets now contain every provision a
practitioner would accept as an answer, and the metric asks the right
question: "is the top hit a DEFENSIBLE ANSWER?". Top-hit accuracy on the 46
answerable queries is therefore **34 of 46** (was 29 of 46) and in-window
**43 of 46** (was 42 of 46) — **a change in what the metric asks, not a
retrieval improvement**; no ranking rule, synonym or candidate-set rule
changed, and the two figures are not the same measurement.

**And the residual has been worked (2026-10-21, `496d24f`).** The ranking
round shipped a demotion for a heading that ANNOUNCES an exception (§ 4.86
"Exceptional patterns of hearing impairment." above § 4.85 "Evaluation of
hearing impairment.") and a deterministic `s.citation` tie-break for rows
that tie on score. Top-hit accuracy is now **35 of 46** — this time a
genuine retrieval improvement, measured as one dev query changing and the
holdout's per-query output staying identical. What survives as ranking work
is **eight** in-window-but-not-first cases, every sibling the committee
proposed for them REJECTED on the question-asked principle
(`docs/research/expectation-adjudication-2026-10-21.md` §11.2): a different
benefit type (§ 17.151's invalid lifts, three queries), an eligibility rule
where a rate was asked for (§ 3.1701), who may be **examined** rather than
who is **eligible** (§ 17.160), the lender's authority to **close** a loan
rather than the underwriting standards (§ 36.4225), and **apportionment** —
a mechanic that presupposes the entitlement (§ 3.455). Plus **one** clear
failure, § 9.21 for "traumatic brain injury compensation", a Part 9
servicemembers'-insurance provision whose (c)(17) names "Traumatic Brain
Injury" verbatim and pays $25,000 for it, beating the real rating
provision on body repetition.

**§ 9.21 is NOT fixable by a ranking rule** and is not fixed here. The
heading-phrase key has nothing to fire on (no heading carries the query's
phrase, and "compensation" has no entry in the curated expansion map); all
of § 9.21, § 3.350 and § 4.124a match the AND tier; and only bm25's body
frequency separates them ("traumatic" 15 times against 2, 2 and 1). The
fixes that would work — a per-part rule, a § 9.21 blocklist, a bm25 retune,
an abstention band — have each been measured and rejected. The honest
provisioning is **context, not rank**: the part title beside each hit, so a
reader sees at a glance that § 9.21 is Part 9 (servicemembers' group life
insurance) and the rating provisions are not. That is a wire-contract change
(MEDIUM), and it is **not** a schema change: the eCFR structure tree is
already in the index as `meta.structure_json`, `listParts()` already joins
parts to their titles, and every part in use has a title (measured on the
2026-10-16 corpus: 59 part nodes, 54 parts in use, no section without a
part).

**Completion records for the items above** (the roadmap asks for the
implementation PR, the reviewed SHA and verdict, and the verified merge SHA),
plus the M1 inventory correction recorded below. **The gate-evidence column
records the tail at the WORK's reviewed head** — each row reports the
numbers from the SHA listed in its own "Reviewed SHA" column, whatever
round wrote the row.

| Item                                                                                    | PR                                           | Reviewed SHA → verdict                                                                                  | Merge SHA                                        | Local gate evidence                                                                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3-b (abbreviation coverage)                                                            | #87                                          | `a5ad606` → APPROVE_WITH_NITS 0/0/3                                                                     | `45cfef5`                                        | `npm run ci` exit 0 (97.28% stmts / 91.21% branches), `scripts/validate.sh` GATE: PASS, 48/48 store                                                     |
| M3-c (query-set adjudication)                                                           | #86                                          | `b2426aa` → APPROVE 0/0/0 (re-AFFIRM at `51c7d2d`)                                                      | `65c8b3c`                                        | `npm run ci` exit 0 (97.25% / 91.21%), 8/8 retrieval-eval                                                                                               |
| M3-c (the ORDER of the 39 + the sibling proposals)                                      | #99                                          | `3a68bdc` → RE_AFFIRM 0/0/0                                                                             | `4c5060e`                                        | `npm run ci` exit 0, `scripts/validate.sh` GATE: PASS, 636 tests                                                                                        |
| M3-a (the narrower grounding form)                                                      | #89, #90                                     | `f4790dc` → APPROVE 0/0/2 (#89); `a1c1084` → APPROVE 0/0/0, RE_AFFIRM 0/0/0 at `44cdd35` (#90)          | `2256ad8` (#89), `1ce6e28` (#90)                 | `npm run ci` exit 0, `scripts/validate.sh` GATE: PASS, 609 tests                                                                                        |
| M3-d (the heading-phrase ranking key)                                                   | #92                                          | `e0ca4ed` → APPROVE (no P0/P1; both sets re-measured by the reviewer against the base)                  | `69ea296`                                        | `npm run ci` exit 0 (97.27% stmts / 91.27% branches), `scripts/validate.sh` GATE: PASS, 610 tests                                                       |
| M3-d follow-up (the exception demotion + the citation tie-break)                        | #105                                         | `d0fc259` → APPROVE 0/0/0; `3f17920` → APPROVE 0/0/0 (re-affirm after the merge)                        | `496d24f`                                        | `npm run ci` exit 0 (97.31% stmts / 91.21% branches), 639 passed \| 1 skipped, `scripts/validate.sh` GATE: PASS                                         |
| M3-e (the hearing vocabulary bridge)                                                    | #93                                          | `6e14e00` → APPROVE 0/0/0; `f6ce915` → RE_AFFIRM 0/0/0                                                  | `86619eb`                                        | `npm run ci` exit 0 (97.29% stmts / 91.21% branches), `scripts/validate.sh` GATE: PASS, 610 tests                                                       |
| M3-e (the OR candidate set)                                                             | #94                                          | `f8baa21` → APPROVE 0/0/0                                                                               | `8d9f6a3`                                        | `npm run ci` exit 0 (97.29% stmts / 91.2% branches), `scripts/validate.sh` GATE: PASS, 614 tests                                                        |
| M5 slice 4 (browse descent)                                                             | #88                                          | `d6fadff` → APPROVE_WITH_NITS 0/0/2                                                                     | `b0b2bf2`                                        | `npm run ci` exit 0 (97.28% / 91.21%), `scripts/validate.sh` GATE: PASS, 44/44 openapi-conformance                                                      |
| M5 slice 3 (ETag/304 revalidation)                                                      | #96                                          | `4be7e9e` → APPROVE_WITH_NITS 0/0/2                                                                     | `aebeb32`                                        | `npm run ci` exit 0, `scripts/validate.sh` GATE: PASS, 630 tests                                                                                        |
| M1 correction (the footnote-gap artifact — the probe's own over-matching pattern)       | #98                                          | `81d1aec` → APPROVE 0/0/0                                                                               | `928e63e`                                        | `npm run ci` exit 0 (97.29% stmts / 91.2% branches), `scripts/validate.sh` GATE: PASS, 621 tests                                                        |
| M3-e (the adjudicated expected sets — the benchmark's content)                          | #101                                         | `31821f1` → RE_AFFIRM 0/0/0                                                                             | `17f37ad6`                                       | `npm run ci` exit 0 (97.31% stmts / 91.2% branches), `scripts/validate.sh --base origin/main` GATE: PASS, 636 tests                                     |
| M6 (the practitioner-pilot protocol)                                                    | #100                                         | `65adb7d` → APPROVE 0/0/1                                                                               | `17da023`                                        | `npm run ci` exit 0, `scripts/validate.sh --base origin/main` GATE: PASS, 636 tests                                                                     |
| M6 (the criteria revision — the committee's seven criteria and the closed §11.2 branch) | #103                                         | `0e684f4` → APPROVE_WITH_NITS 0/0/1; `932cff7` → APPROVE 0/0/0 (re-affirm)                              | `a489c00`                                        | `npm run ci` exit 0, `scripts/validate.sh` GATE: PASS, 636 tests                                                                                        |
| M6 (the sibling class re-anchored on the adjudicated set)                               | #119                                         | `c37a16e` → APPROVE 0/0/0                                                                               | `5ebe98d`                                        | `npm run ci` exit 0, 668 passed \| 1 skipped, prettier clean                                                                                            |
| M6 (the completion record and the gate-evidence convention)                             | #120                                         | `185d440` → APPROVE 0/0/0                                                                               | `f34f76f`                                        | `npm run ci` exit 0, 670 passed \| 1 skipped, prettier clean                                                                                            |
| M3 (the measured state restated after the ranking round)                                | #108                                         | `3c5c5be` → APPROVE 0/0/0; `a7e2cfb` → APPROVE 0/0/0 (re-affirm)                                        | `f455e01`                                        | `npm run ci` exit 0, 639 tests                                                                                                                          |
| M3 (the part title on every hit — the § 9.21 context remedy)                            | #109                                         | `fa70b33` → APPROVE 0/0/0                                                                               | `5306fb8`                                        | `npm run ci` exit 0, 660 passed \| 1 skipped, 97.3 % stmts / 90.96 % branches                                                                           |
| **CLOSED — not a defect** — P1-20261021-07 (the browse view's request identity)         | #118 (closed by measurement; no code change) | `69d5df3` → APPROVE 0/0/0 (the review's one P1 was this row's gate tail — corrected in the same commit) | — (this PR's own merge; recorded in the journal) | `npm run ci` exit 0, 670 passed \| 1 skipped, prettier clean, eslint 0 errors (8 pre-existing warnings); the two pinning tests are in `test/ui.test.ts` |

**CORRECTED (2026-10-21): the M1 inventory's "four provisions lose their
footnote text" item is WITHDRAWN — it was a MEASUREMENT defect, not a
product one, and there is no M1(b) candidate here.** The
four provisions DO keep their footnote text: every `<FP>` element's text
and every `<FP-1>` list item's text is present VERBATIM in the local
corpus (`~/.cfr-free/index.sqlite`, table `sections`, columns `text` AND
`markdown`) for all four — § 17.610 (1 `<FP>` + 4 list items), § 36.4221
(1 + 7), § 36.4520 (1 + 7), § 36.4527 (1 + 8), none missing. The
finding was an artifact of the fidelity probe's OWN pattern: its literal
`<FP>` pattern ended the tag name in `\b`, and a word boundary matches
the hyphen of `<FP-1>`, so the capture began at a LIST ITEM and ran to the
`</FP>` closing the real footnote — a span that exists in no rendered
output, and so always read as `lost`. The pattern now ends in
`(?:\s[^>]*)?` (exact tag name). Re-measured on the SAME snapshot
(2026-10-16, 9 613 330 bytes, sha256 `9506de6c…`): footnotes are **56
intact / 0 partial / 0 lost**, and the before/after probe outputs differ
in that one row and nowhere else. The parser was never wrong here; the
M1 inventory's own report is corrected in place at
`docs/research/corpus-fidelity-2026-10-20.md` (§1 and G2).

### M4 — A verified first-use path

**Dependency:** P1-04. **Risk:** LOW for docs; HIGH for release CI changes.
**Verified baseline:** `package.json` points the executable at `dist/cli.js`;
A live registry probe on 2026-10-20 returned HTTP 404 for the README's
primary npm installation target. The
release workflow has an operator-controlled trusted-publishing activation.

Refine a source-install guide and a smoke checklist before changing releases.
Specify working directory, supported runtime, build, isolated index path,
sync, `version`, HTTP search/read, MCP initialization/tools call, restart
offline, and export. Verify commands against current CLI dispatch. Use exact
paths in operator instructions and include verification commands. Test only
with provisioned dependencies as an agent; record clean-install testing as
unverified until an authorized human/environment performs it.
Candidate scope: `README.md`, `CONTRIBUTING.md`, existing smoke scripts/tests;
new scripts need an explicit packet manifest. Acceptance: another person can
follow the guide without guessing the executable location; network-requiring
sync/diff operations and local reads are distinguished. Inspect current tool
registrations: the baseline README's six-tool/offline claim omits networked
`diff_issues`. Build/check examples and reconcile capability tables.
Checks: formatting/typecheck/pre-commit validation; runtime script changes
also require `npm run ci`. npm account setup, registration, tag/release, and
publication remain separate operator actions with live verification.

### M4 — A verified first-use path — DONE (2026-10-20)

**Shipped:** PR #81 → `73606cc` — a README **verify-the-install smoke
checklist** whose every command and output was run against a throwaway
index on the 2026-10-16 corpus: `version`, `sync` on an isolated index,
HTTP health/search/section, an **offline restart**, an MCP initialize +
`tools/call` over stdio (including the dotted display-citation round
trip), and an offline `export`. Steps 1–2 need the network; 3–6 are fully
offline. Clean-install testing is explicitly recorded as **unverified by
an agent** (installs are forbidden to it). Reviewer (Nemotron family,
`nemotron-3.5-lightning-free`; the primary is provider-rate-limited):
APPROVE_WITH_NITS 0/0/2 → APPROVE 0/0/0.

**Two corrections the round forced, both recorded rather than absorbed:**
the repo's own pre-commit security scan (semgrep `detect-non-literal-regexp`)
failed on the M1 fidelity probe's `RegExp()` built from a variable — PR CI
missed it because CI's scan step runs `scan:audit`, not the full local set —
now literal patterns; and fixing that exposed that the probe had been
reporting **wrong numbers** (an appendix-blind scan and a truncating
alternation), which in turn revealed a real gap the wrong count masked: **4
provisions lose their footnote text entirely** (§ 17.610, 36.4221, 36.4520,
36.4527). The M1 report is corrected (footnotes 52 intact / 4 lost) with a
dated note recording the under-counts; the lost-footnote gap is the next
M1(b) candidate.

**CORRECTED (2026-10-21): the "real gap" this round reported was NOT
real — it was a third bug in the same probe, and the lost-footnote gap
never existed.** The literal patterns this round introduced ended the tag
name in `\b` (`/<FP\b[^>]*>([\s\S]*?)<\/FP>/`), and a word boundary is
not an exact tag name: a hyphen is a non-word character, so `\b` sits
between "FP" and the "-" of `<FP-1>` and the pattern matched the LIST
ITEM. In the four provisions named above the upstream shape is an
`<EXTRACT>` of `<FP-1>` signature items FOLLOWED by the real `<FP>`
footnote, so the capture began at the list item and ran to the `</FP>`
closing the footnote — a span that is in no rendered output and therefore
always read as `lost`. Measured against the local corpus
(`~/.cfr-free/index.sqlite`), all four provisions keep their footnote
text verbatim in both the `text` and the `markdown` columns, together
with every one of their `<FP-1>` list items (1 `<FP>` + 4/7/7/8 list
items; none missing). The pattern now ends in `(?:\s[^>]*)?` (exact tag
name), and re-measured on the SAME snapshot (2026-10-16, 9 613 330 bytes,
sha256 `9506de6c…`) the class reads **56 intact / 0 partial / 0 lost**;
the before/after probe outputs differ in that one row and nowhere else.
The M1 report is corrected again in place (footnotes 56 intact / 0 lost)
with a dated note. **There is no lost-footnote gap, no M1(b) candidate
and no parser change owed here** — the text was in the index all along,
and the probe's over-matching pattern is now pinned by
`test/fidelity-probe.test.ts`.

### M5 — One complete research-and-citation workflow

**Dependency:** P1-02/P1-03, M2; reuse E1/E2/E4/E6 work where it exists.
**Risk:** MEDIUM. **Verified baseline:** `src/titan/ui.ts` serves search,
section reads and browsing; `src/commands/export.ts` supports SQLite/JSONL/MD;
`src/mcp/resources.ts` provides a claim-research prompt. Full case management
and claimant-file ingestion are outside this roadmap's implementation scope.

Refine one slice at a time: find provision → read full available content →
follow references → inspect dated source/change view → copy a citation.
For a copy/export feature, decide exact fields first: citation, heading,
quoted text, source date, dated verification URL, and incompleteness warning.
Use a plain, documented format before proprietary application adapters.
Preserve keyboard access, explicit loading/error/empty states, route ownership,
and offline notices. A historical request must not relabel today's text.
Candidate scope: UI and behavioral tests, relevant service/MCP/HTTP handlers,
export tests, OpenAPI/SPEC/README; bound each slice before dispatch.
Acceptance: a deterministic end-to-end fixture exercises the whole slice;
user can verify the quote and date after export without reconstructing context.
Wrong-citation, unavailable-image, stale-index, and upstream-unavailable cases
remain visible. Checks: behavioral UI/API/MCP tests and `npm run ci`; disclose
DOM-stub versus real-browser execution. Do not equate source-string tests with
browser behavior or add authentication as incidental cleanup.

### M5 — One complete research-and-citation workflow — 4 OF 4 SLICES DONE (2026-10-21)

**Slice 1 — copy-a-citation (SHIPPED, PR #83 → `6a2bb83`).** The section view
builds a copy block of exactly the fields this roadmap decided: the legal
display form, the heading, the source line with the index's issue date, the
DATED verification URL (the revision the text came from), and — when the
text carries an image marker — an explicit incompleteness warning, so a
copied citation can never imply complete coverage. The block is always
shown in a readonly selectable textarea (no clipboard permission required,
no authentication added) and the button reports a blocked write honestly.
Reviewer: APPROVE_WITH_NITS 0/0/1 → RE_AFFIRM 0/0/0.

**Slices 2–4 are the E-items this roadmap's M2 line already pointed at
("reuse E1/E2/E4/E6 work where it exists") — stated here so they are
ticketed in the repo rather than living in a journal file.**

| Slice | Work                                                                                                           | Evidence it is needed                                                                                                                                                           | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2** | **UI redline view** (`#/redline`) — a from/to/citation form rendering the redline the wire already serves (E4) | the redline is a shipped capability (M2(b)/E1) with no UI surface; M5's flow needs "inspect the dated change view" in the browser                                               | **DONE (2026-10-20, `ae61dbf`).** One route in `src/titan/ui.ts` renders the wire's redline over a from/to/citation form, with the `coarse` flag shown explicitly so a whole-block comparison is never read as a line-by-line one; the same posture rules (textContent only, no inline script) and a behavioural DOM-stub test apply. (The section header above was corrected on 2026-10-21; this row was missed until then.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **3** | **ETag/304 revalidation** on the index-backed reads (E5)                                                       | the /current/ link drops the revision; a 304 lets a client confirm the text it quotes is unchanged without re-downloading                                                       | **DONE (2026-10-21, `aebeb32`; PR #96, `4be7e9e` → APPROVE_WITH_NITS 0/0/2).** The three index-backed reads (`/api/v1/search`, `/api/v1/sections/{citation}`, `/api/v1/browse`) now carry a strong `ETag` — a quoted sha256 over the EXACT response bytes, so the tag changes if and only if the body changes — and answer a matching `If-None-Match` with a bodyless `304` (RFC 9110 §13.1.2: `*` matches any representation, a list matches when any member matches, a weak `W/"x"` matches the strong `"x"`). Only a 200 is eligible: `/health`, `/metrics`, the two eCFR-fetching routes and every error response carry no validator and are never a 304. The 304 repeats the 200's `ETag`, `Cache-Control` and content type and carries no `content-length` (on a 304 that field would describe the cached representation, not an empty one). The UI is unaffected: its four fetches are plain GETs with the default cache mode, so a browser absorbs the 304 in its HTTP cache and serves the cached body to `response.json()`. |
| **4** | **Browse descent into subject groups** (E6)                                                                    | **1,910 of 2,953 sections WERE unreachable through the browse tree** (373 `subject_group` nodes hold them; the wire's `StructureEntry` is flat, so the tree stops at the group) | **DONE (2026-10-20, `b0b2bf2`).** The wire gained one parameter, `subjgrp`, carrying the eCFR's own node id for the group. The corpus decided the dependency rule: 158 of the 373 groups hang off a PART and 215 off a SUBPART, so `subjgrp` requires `part` but NOT `subpart` — requiring a subpart would have locked out 158 groups. The UI's subject-group row became a descending button; the MCP tool gained `subject_group` and its description now says the hierarchy has five levels. An unknown group is a 404 that lists the available group ids, not a silent empty.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Not in M5:** E3 (route-level Prometheus metrics) was proposed for E1–E5
but has **no mandate in this roadmap** and is **not being built** — closed
here so it stops recurring. If a later stage wants operational metrics,
it belongs with M6/M7's operator-arranged work, not the product surface.

### M6 — Practitioner validation before expansion

**Dependency:** study design can start now; usable pilot requires A and C.
**Risk:** LOW documentation/research; external participation needs operator
arrangement/authorization. Proposed starting cohort: five practitioners or
tool builders; this is a planning target, not existing demand evidence.

Prepare public, synthetic tasks: citation lookup; shorthand-to-criteria search;
cross-reference follow-up; historical comparison; export/copy verification.
Compare with each participant's existing workflow. Record task completion,
wrong-provision/version errors, time, installation obstacles, and whether
they return for another session. Capture denominator and failures, not only
favorable anecdotes. Avoid claimant documents or personal/medical information.
Keep notes local/operator-controlled; no telemetry or automatic outreach.
Candidate deliverable: proposed `docs/research/practitioner-pilot.md` with
protocol, consent/data boundaries, results template, and decision log.
Acceptance: before recruitment, operator agrees success criteria; after the
pilot, record continue/change/stop with evidence. **Acceptance met
2026-10-21**: the seven criteria in `docs/research/practitioner-pilot.md` §8
are agreed (the committee's revisions, independently reviewed, then signed
off), and the session pack that makes a session runnable is
`docs/research/pilot-session-pack.md`. Suggested continue signal:
at least three participants complete four of five tasks without a citation/
version error and request repeat use; explicitly label this an initial
decision threshold, not statistical proof or a revenue forecast.

**Criteria review (2026-10-21):** the operator's decision committee
reviewed the seven success criteria in `docs/research/practitioner-pilot.md`
§8 and the continue/change/stop mapping in §11.2 of that document.
**SC-1 and SC-5 are kept**; **SC-2, SC-3, SC-4, SC-6 and SC-7 are
revised**, as recorded in the protocol, and the previously unhandled §11.2
branch is closed — a cohort that misses SC-1 while at least 2 of N asked
for another session is a CHANGE, not an unhandled case.
**The criteria were agreed on 2026-10-21** (the §8 table's decision column
records it), so the M6 acceptance condition is met; what remains is
operator-arranged: recruitment and consent, and the sessions themselves.

**The instrument is now continuously checked (2026-10-22).** The protocol's
own rehearsal record ended with a standing instruction — "a rehearsal of
this shape should be repeated as a regression check on the instrument
itself — not as evidence about practitioners, but as a check that every
task is still answerable and every sheet still fillable after a change
lands". That check was a human reading a document, so it happened once.
It is now automated: `test/fixtures/pilot/run.ts` runs the seven task
families (F1, F2-A, F2-B, F3-A, F4-A, F5-A, F5-B) against a seeded
index and asserts, per task, that the surface the task NAMES can still
produce the answer the task asks for — 33 checks, all passing, run in CI
by `test/pilot-rehearsal.test.ts`. It is offline and hermetic (it never
touches the operator's index and never the network), it says on its face
that it is a regression check and NOT study evidence, and it does not
touch the subject-index reopen condition, which is fixed on the PILOT's
`E3` count. Three product regressions are now caught by it, each verified
by mutation: the heading-phrase key (SPEC §4.1), which a seed without a
body-heavy distractor hid; the citation pin, which a check asserting only
"first hit" hid when the citation happened to rank first anyway; and the
core's attachment of the point-in-time notice to the diff and redline
payloads, which a check that built those payloads by hand could not see
at all — F4 now runs the product's own `diffIssues`/`redlineSection`
against a STUB eCFR, so the payloads under test are the ones the core
produced.

**The three tool behaviours the rehearsal found are closed (2026-10-22).**
The rehearsal recorded that the CLI search printed the CURRENT eCFR url
rather than the dated one (so a pasted citation could not show which
revision it came from), that the web UI rendered an unavailable
cross-cite as "(not indexed)" — a claim the provision does not exist,
where the true claim is that it is not in THIS copy — and that neither
change view stated the limit on what its two dates mean (the dates are
selectors, not a stamp of the revision served). All three are fixed, and
the limit now lives in one constant — `POINT_IN_TIME_NOTICE`, used by both
the diff and the redline — so they cannot drift apart in wording.

### M7 — Integrations and support, conditional on pilot demand

**Dependency:** M6 evidence. **Risk:** LOW for a decision brief; runtime
integration MEDIUM, auth/secrets/CI changes HIGH.
Choose one demonstrated destination, such as a local research assistant or
an existing advocacy tool's documented import flow. Verify that destination's
actual API/import format, permissions, licensing, and user need first. Prefer
the existing HTTP/MCP/JSONL/MD surfaces; do not build a speculative connector.
Candidate first deliverable: a proposed `docs/research/integration-decision.md`
with one reproducible handoff, alternatives, maintenance burden, failure
handling, and a go/no-go. Later code gets its own manifest and contract tests.
Test managed setup/support willingness with the operator before adding billing.
Do not invent prices, customer commitments, enterprise compliance, guaranteed
claim outcomes, or a commercial advantage from public-domain content alone.

### M8 — Corpus/platform expansion decision gate

**Dependency:** M6/M7 evidence plus explicit operator scope approval.
**Risk:** LOW research; schema/auth/release implementation HIGH.
Keep Title 38 specialization by default, consistent with
`docs/research/multi-title.md`. Research adjacent statutes, M21-1, decisions,
or another CFR title only when observed tasks cannot be completed without it.
For each candidate, document authoritative source, reuse/access terms,
update/history model, authority distinctions, retrieval identity collisions,
fidelity fixtures, maintenance cost, and a measurable pilot benefit.
Do not combine statutes, regulations, manuals, and decisions into unlabeled
authority. No scraping, ingestion, schema migration, or new authentication
surface is implied by recording the research task. Deliver a decision brief
and proposed SPEC change before any implementation packet.

### Evidence required to mark a roadmap item delivered

Record item/packet ID, implementation PR, reviewed SHA and verdict, exact
local validation tails, required CI run links, operator decisions where
needed, and verified merge SHA. Include measured outcomes for M3/M6/M7.
Keep rejected/deferred options with their reason and revisit trigger.
Planning checklists, green unit tests, and a merge alone do not establish
market fit or a content-completeness claim.

## Historical delivery record — original top 20

Mission filter: **accuracy and information quality for veteran support
officers and claims adjudicators evaluating a veteran's claim.** Every item
must make it easier to find, verify, quote, or trust the governing Title 38
CFR text. Groomed 2026-10-14 from the legacy top-10 (items 2, 3, 5, 6, 7, 8
already shipped: exit codes, `export`, `/metrics`, `list_parts`, concurrent
sync prevention, `matches[]`; item 10 ships as Dockerfile, compose follows).

## Round 1 — built (2026-10-14)

All ten items below shipped together with `docker-compose.yml` (item 11):
citation-direct pinning, phrase search, acronym expansion, cross-reference
extraction, freshness envelope, citation display/deep links, sentence-boundary
snippets, the `cfr_claim_evaluation` prompt, the `health` tool, and HTTP byte
caps. SPEC §5/§6 document the resulting surface.

1. **Citation-direct search resolution** — a query that _is_ a citation
   (`4.130`, `38 CFR 4.16`, `§ 3.350(a)`) must surface that exact section as
   the top hit. Adjudicators paste citations constantly; fuzzy keyword noise
   above the exact provision is a correctness failure.
2. **Quoted-phrase search** — quoted spans (`"traumatic brain injury"`) map
   to exact FTS5 phrase queries so verbatim regulatory language can be
   searched as written, not as loose token soup.
3. **VA acronym / phrase expansion** — curated synonym groups (`ptsd` ↔
   posttraumatic stress, `tdiu` ↔ individual unemployability, `smc` ↔ special
   monthly compensation, `mst`, `dic`, `tbi`, `hlr`, `bva`, `nsc`) so queries
   in either the acronym language of the rating office or the full regulatory
   language find the same provisions.
4. **Cross-reference extraction** — `get_section` returns `references[]`:
   every `§ 4.105` / `38 CFR 4.130` mentioned in the text, with an
   `available` flag (present locally vs. needs eCFR). Claims reasoning
   routinely ping-pongs across parts; surfacing the web of citations removes
   manual grep work.
5. **Freshness envelope on every response** — search and section reads carry
   `indexIssueDate`, `indexStale`, and a `notice` when the index is stale, so
   an AI client can never unknowingly quote a lapsed version.
6. **Legal citation formatting + eCFR deep links on hits** — every hit gains
   `citationDisplay` (`38 C.F.R. § 4.130`) and `sourceUrl`, ready to paste
   into a rating decision or brief.
7. **Sentence-boundary snippet windows** — snippets widen (36 tokens) and
   never start mid-sentence, so quoted context reads as prose, not shards.
8. **Claim-evaluation MCP prompt** — `cfr_claim_evaluation(issue, part?,
citation?)` encodes the adjudicator workflow: locate criteria → read
   verbatim → follow cross-references → cite with source URL and issue date.
9. **MCP `health` tool** — `ready | stale | empty` in one call; clients gate
   queries on it instead of parsing full status payloads.
10. **HTTP query byte caps** (legacy #9) — router-level hard limits
    (URL ≤ 2048 bytes, `q` ≤ 800 bytes, `part` ≤ 10 bytes) on top of zod, so
    malformed oversized requests die before validation.

## Next round

11. **`docker-compose.yml`** (legacy #10 remainder) — single-command
    deployment: HTTP server, `/data` volume, healthcheck. **Built in Round 1.**
12. **Rate limiting for remote binding** (legacy #4) — token bucket keyed by
    peer address, active only when `CFR_ALLOW_REMOTE=1`. **Built.**
13. **Sync-change report** — per-citation content hashes across syncs:
    "N sections amended since your last sync" with the list. **Built**
    (schema-free: outgoing hashes captured before the wholesale rebuild;
    `index_status`/`/health`/`cfr-free sync` report carry the diff).
14. **Reserved / removed section clarity** — reads of reserved or vanished
    citations surface their state. **Built** (in the 2026-10-16 XML, reserved
    sections such as 4.60 and 4.65 are `TYPE="SECTION"` elements with `[Reserved]`
    headings; they are indexed with empty bodies. Citations missing from the
    index instead get reserved/removed/outside-Title-38 guidance + the eCFR
    verify link + indexed sections that mention them).
15. **Historical-version guidance** — effective-date-of-claim disclaimer with
    a deep link to the eCFR historical/annual-edition archive (CUE claims).
    **Built** (stale notices + the claim-evaluation prompt link the verified
    point-in-time URL form `/on/<date>/title-38/section-<citation>`).

## Later

16. **OpenAPI 3.1 document** (§13 #17) for third-party API consumers. **Built**
    (v0.2.0, PR #21).
17. **Auto-refresh stale index at startup** (§13 #14) beyond `CFR_AUTO_SYNC`.
    **Built** (opt-in CFR_REFRESH_HOURS, PR #22).
18. **Per-section amendment dates** — research eCFR's amendment metadata
    feed; if derivable, attach `amendedAt` to sections (gold for date-of-claim
    analysis).
    **Researched — not bulk-derivable** (2026-10-18, see
    docs/research/amendment-dates.md): no section-level amendment feed exists;
    per-section `starts_on` is available but at ~1 request/section per sync.
    Date-of-claim path remains the point-in-time URL links shipped in §4.
19. **Definitions quick access** — dedicated path to §3.1 master definitions
    (e.g. "established profession of medicine") from tools/resources.
    **Built** (MCP resource `cfr://title38/definitions`, PR #24).
20. **Appendix parity in browse** — verify appendices appear in `browse` and
    `list_parts` navigation consistently with sections.
    **Verified** (2026-10-18): browse returns all children unfiltered (appendix
    entries included, `type: 'appendix'`); fixtures pin appendix children in
    part-level browse and per-part counts; live corpus confirms part 4 ships 3
    appendix structure entries + 3 indexed appendix rows. No code change.
