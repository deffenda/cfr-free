# cfr-free — product and delivery roadmap

The OPEN work only. What has shipped is recorded in
[`docs/research/delivery-log.md`](docs/research/delivery-log.md): the
design review rounds that were `docs/SPEC.md` §10/§12/§13, and the closed
milestone records (M1–M5, the original top 20, the 2026-10-14 round).

## Open review findings — dispatch first

The six P1 findings from the 2026-10-21 implementation audit were **OPEN**
at the time of this grooming; **all six are now CLOSED** — the fixing PR,
the reviewed SHA and its verdict, the verified merge SHA and what each fix
does are in [the 2026-10-21 review handoff](docs/research/review-2026-10-21.md)
(issue #106), and the roadmap's own completion records are in the table below.
**P1-20261021-07 — the browse view's request identity — is CLOSED as NOT A
DEFECT**: it was measured, and the race cannot happen; the two tests that pin
it are in `test/ui.test.ts`, and the measurement is recorded in the same
handoff. **The list of OPEN FINDINGS below is therefore empty.** This is a
review handoff, not an implementation or a closure record.

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
Historical shipped items are preserved in the
`docs/research/delivery-log.md`. No paid service, publishing,
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
   of the exact head SHA with no unresolved P0 or P1 findings; a new
   commit — including a roadmap completion edit — requires a fresh review,
   except a clean automatic merge of the base branch, which keeps the
   review.
5. Authentication, schema migrations, CI/release changes and changes to the
   merge rule itself need the operator's sign-off before merge; all four
   are AGENTS.md's merge floor, and merging follows the merge rule
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
Stages A–C are delivered — their records are in the delivery log — so the open
work is stage D (M6) and stage E (M7, M8).

## The shipped milestones — records in the delivery log

| Milestone                                           | State                  | Record                                        |
| --------------------------------------------------- | ---------------------- | --------------------------------------------- |
| M1 — corpus fidelity beyond row counts              | shipped                | [delivery log](docs/research/delivery-log.md) |
| M2 — dated provenance and comparison semantics      | shipped                | [delivery log](docs/research/delivery-log.md) |
| M3 — measured retrieval quality for claims research | shipped                | [delivery log](docs/research/delivery-log.md) |
| M4 — a verified first-use path                      | shipped                | [delivery log](docs/research/delivery-log.md) |
| M5 — one complete research-and-citation workflow    | shipped, 4 of 4 slices | [delivery log](docs/research/delivery-log.md) |

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

**What remains open:** the operator-arranged part — recruitment and consent,
and the sessions themselves. The criteria review, the automated instrument
check and the three closed tool behaviours are delivery records; they are in
the [delivery log](docs/research/delivery-log.md).

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
