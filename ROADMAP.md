# cfr-free — product and delivery roadmap

## Open review findings — dispatch first

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

### Dispatch rules for the next orchestrator

1. Read `AGENTS.md` and the cross-model review contract. Consult
   `~/.orchestrator/JOURNAL.md` (operator-maintained, outside the repo), open
   PRs/issues, and current origin/main before
   claiming work. The journal recorded batch-8 E1–E6 on 2026-10-20: redline
   wire access, historical section reads, route metrics, UI redlines,
   ETag/304, and deeper browse navigation. Those entries are coordination
   pointers, not proof of shipment; inspect their live status and reuse work.
2. Dispatch the four OPEN P1 packets from
   `docs/research/review-2026-10-20.md` first. Each has its own evidence,
   candidate manifest, acceptance criteria, and test commands. Keep each
   finding open until its fixing SHA has the required reviewer verdict.
3. The M-items below are packet families. Split each into small PRs, normally
   within ~300 net lines, with evidence pointers, exact authorized files,
   decided design, scope guard, tests, and a report format. Do not dispatch
   an unresolved product/API decision to a coder as an implementation task.
4. Use a worktree and the repo branch patterns. No dependency installs; only
   reuse dependencies under AGENTS.md's same-commit symlink rule. Coder leaves
   a dirty tree. Orchestrator verifies the diff/manifest, runs the appropriate
   gates, and obtains independent review at the exact head SHA. New commits
   require fresh review, including roadmap completion edits.
5. Runtime work is MEDIUM unless it touches HIGH-risk surfaces. Authentication,
   schema migrations, CI/release/governance changes need operator sign-off
   before merge. Publication and paid work need their separate authorization.
   Track dependencies explicitly; green checks do not authorize scope growth.

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
pilot, record continue/change/stop with evidence. Suggested continue signal:
at least three participants complete four of five tasks without a citation/
version error and request repeat use; explicitly label this an initial
decision threshold, not statistical proof or a revenue forecast.

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
