# Cross-model review rule

Defines how the orchestrator hands work to the **independent reviewer**
(NEVER the orchestrator's own model; coder and reviewer are always
different models) and how the verdict flows back.

## Reviewer stance: critical and impartial (firm but fair)

The reviewer operates as a **senior staff engineer performing the
pre-merge due diligence whose name the operator ships**: skeptical,
exhaustive, and accountable for proportion. **Firm** means the required
attack axes and the citation floor are worked in full — every axis,
every load-bearing claim. **Fair** means every finding is stated at
its true strength and graded by the harm test and the blast-radius
boundary (below) — never exaggerated into a scarier label, never
softened into silence. An APPROVE must have earned its way past real
hunting; a BLOCK must keep the harm test on every blocker. Severity
inflation and deflation are the same defect (an untruth about
magnitude) and both feed the reviewer's calibration record.

Required attack axes — the reviewer must genuinely work, not walk:

1. **Scope creep**: diff vs the packet's claimed file list and intent.
2. **Default-path equivalence**: with every new config absent, is the
   behavior byte-identical to base?
3. **Failure paths**: unhandled rejections, races, shutdown-vs-in-flight,
   rethrow out of callbacks, partial writes, closed-store misuse.
4. **Test assertion strength**: would these tests FAIL if the code under
   test actually broke? Delete-coverage test — read the assertions, not
   the test names.
5. **Test honesty**: real sleeps, network access, flaky timing,
   fixture collisions with other suites.
6. **Reachability extremes**: for every documented response/behavior,
   derive the code path that produces it; for every omitted one, argue
   it can't happen.
7. **Docs vs behavior**: SPEC/README/ROADMAP lines in the diff must match
   what the code actually does — including the orchestrator-authored
   lines.
8. **Manifest hygiene**: file list exactness, dependency leakage.

## Effort floor (mandatory in every verdict)

**What counts as substantive** (this is the tripwire's measurement —
"filler" is decided by these tests, not by feel):

1. Every candidate finding cites a specific **file:line** (or exact
   command/output) it was checked against. Entries without a citation
   are mechanically classified as filler.
2. At least **four of the required attack axes** carry a named
   observation each (what was probed, and the one strongest fact found
   or the fact that nothing was found there).
3. "Strongest case for blocking" must reference a **specific location in
   the diff** (file:line) it would attack and the evidence that would
   have to exist to flip the verdict — a vacuous paragraph fails this.
4. For trivial, mechanically-verifiable changes (e.g. a one-line version
   bump), axes 2 and 3 may be shortened, but the citations requirement
   (axis 1) never relaxes.

- Minimum **two candidate findings considered and discarded** with the
  above citation standard.
- If the verdict is APPROVE or APPROVE_WITH_NITS: the named
  **"Strongest case for blocking"** paragraph per test 3.

**Mechanical weak-effort classification** (fires the tripwire when it
appears in two consecutive rounds by the same reviewer model) —
restricted to what a checklist can verify without judgment: a required
verdict field missing; fewer than two candidate findings carrying a
citation (mirrors the effort floor's minimum); a blocker carrying no
harm-test sentence; a strongest-case paragraph with no diff-location
reference.

**Semantic checks (auditor-owned; never claimed as mechanical):**
evidence-free or vacuous assertions anywhere in the verdict, harm-test
sentences present but hollow, axis observations present but
substantively empty. These require judgment and are caught by operator
audit and the cross-check round — the mechanical floor's limitation
(above) applies to them by design.

Every axis observation must also name the **specific artifact probed**
(file:line, hunk, or command) — not the axis label alone. An observation
of "Axis 1: probed scope creep; found nothing" without an artifact
reference fails the mechanical test.

**Known limitation (write this down, don't paper over it):** the
mechanical classification is a _floor_, not a proof of substance. A
determined bad-faith reviewer can pass every mechanical test with
vacuous-but-cited filler. What catches that: (a) operator packet/verdict
audit (below), and (b) the cross-check round under the elevated rubric,
where a second reviewer model works the same packet independently. The
mechanical check exists so at least SOME dodges fail cheaply; it is not
the substance judge, and auditors must not treat "mechanically
compliant" as "substantively investigated".

## Packet rules (what the reviewer receives)

The reviewer receives, in a fresh subagent context:

- The exact diff (`git diff` against the base SHA) and repo path.
- The task intent (what the change is FOR, one paragraph).
- The gates it must pass (coverage floors, audit, format) and the
  required-attack-axes list above.
- Verification pointers ONLY: paths, commands, and live endpoints the
  reviewer can execute itself.

**Banned from review packets:**

- The orchestrator's adjudications, dismissals, or "known accepted
  findings" — they anchor the reviewer and suppress independent
  judgment. If a finding is genuinely already fixed on the branch, the
  reviewer will discover that from the diff itself.
- "Do not re-raise X" clauses of any kind.
- The orchestrator's attack plan or hypotheses ("verify my claim that
  …" phrasing). State the _observed behavior to verify against_, not
  the expected conclusion.

**Enforcement (audit trail, not trust):** the packet is an audit
artifact. Its exact text is retained, append-only, in the orchestrator
journal at `~/.orchestrator/JOURNAL.md` (home-relative path; the
absolute per-machine location is recorded in each round record), and
additionally as a standalone file under `~/.orchestrator/packets/` —
named `<round-id>-<head-sha>.md` (the HEAD SHA under review — known at
packet creation), written by the orchestrator at round close. Retention:
entries are never rewritten or deleted. **Canonicality:** the journal
round record is the canonical audit artifact; files under
`~/.orchestrator/packets/` are convenience mirrors — absence or
divergence of a mirror never invalidates the journal record. Disk
retention is best-effort; record integrity is attested by the
append-only journal itself.

**Audits are operator-owned.** The operator may read any retained
packet at any time and void the round it produced. A reviewer audits a
past packet only when the operator explicitly forwards it — an explicit
delivery mechanism, never an implied standing duty. A packet found in
violation voids the reviewer round it produced: the review is re-run
from a clean packet at the same SHA.

## Elevated rubric (cross-check round)

**Trigger:** two consecutive mechanically weak-effort rounds by the same
reviewer model. The escalation is a **cross-check round**, executed
concretely:

1. The SAME original packet — unchanged, or re-issued with only
   verbatim fixes if the packet itself was audited and found
   defective — is re-sent to a **different eligible free-tier reviewer
   model** (see the model roster above): never the orchestrator's model,
   never the coder's model, and never the FIRST reviewer's model. A
   Nemotron mirror OTHER THAN the first reviewer's model is used while
   the Nemotron family's quota allows.
2. The cross-check reviewer has NEVER seen the first verdict (packet rules
   apply in full; providing the first verdict to the cross-check reviewer is
   itself an anchoring violation). It returns the standard mandate
   format verbatim.
3. **Disagreement rule (mechanical):** compare the verdict class
   (BLOCK vs non-BLOCK), the P0 counts, and the P1 counts. A different
   class, differing P0 counts, or P1 counts differing by 2 or more →
   escalate to the operator with both verdicts attached. Identical
   class and P0 count with P1 counts differing by 0 or 1 → proceed to
   the merge gate on the **better-evidenced verdict**: the one whose
   candidate findings all carry the effort floor's file:line citation
   standard; if both qualify, the one with more file:line-cited
   candidates; if NEITHER qualifies, escalate to the operator — never
   pick between two verdicts the instrument cannot read. Any P1
   discrepancy adjudicated rather than escalated is disclosed in the
   PR body.
4. **Verdict capture:** the cross-check reviewer returns its verdict as its
   final message; the orchestrator captures that message verbatim into
   the journal round record and the packet directory
   (`~/.orchestrator/packets/`) — the same capture path as every other
   round. The record names the packet, both reviewer models, and the
   comparison result.
5. The orchestrator records both verdicts, the packet identity, and the
   comparison in the journal round record (and `~/.orchestrator/packets/`
   per the audit-trail rule).

## When a review is required

**Every change that reaches `main` via PR gets a reviewer round.** The
reasoning: reviews are free-tier and cheap, and the diff with its
verdict is the paper trail the operator audits. Gate rounding:

- LOW risk: one reviewer.
- MEDIUM risk: orchestrator's own gate re-run in addition.
- HIGH risk: reviewer plus an explicit invariant-naming pass, and
  operator sign-off before merge.

## Reviewer model and availability ladder

- Primary reviewer role: the preferred free-tier model — the Nemotron
  family when its quota allows — **never the orchestrator's model, never
  the coder's model**. Fresh subagent context, model passed explicitly
  per round.
- **Model roster** (operator-maintained; current values are visible in
  this file's git history — the roster is updated by a one-line PR
  whenever a model ID changes): **free is the roster.** Any free-tier
  model may take the reviewer role, with two constraints that never
  move: **never the orchestrator's model, never the coder's model**. The
  Nemotron family remains the PREFERRED reviewer role — primary
  `opencode/nemotron-3-ultra-free`, mirrors
  `opencode/nemotron-3.5-super-vl-free` and
  `opencode/nemotron-3.5-lightning-free` — and is used whenever its
  quota allows. When it does not (as on 2026-10-21, when both **Nemotron**
  mirrors were provider-rate-limited for a whole session and the Nemotron
  primary carried every **Nemotron-family** review alone — operator
  roster decision, `~/.orchestrator/JOURNAL.md`, 2026-10-21, that
  session), the ladder falls, **with
  the IDENTICAL packet**, to any other free-tier model the operator has
  enabled (the working set is the `-free` tier) — for example
  `opencode/longcat-2.5-preview-free`, and only a model that is neither
  the orchestrator's nor the coder's — nor, for a cross-check round, the
  first reviewer's model. Paid models remain an
  operator-approved escalation only, made in chat. The rules bind ROLES,
  not IDs: if an ID is unavailable or renamed, the operator updates the
  roster and the ladder logic still holds.
- Transient upstream 5xx (e.g. 503), or an exhausted quota: retry the
  same model once, then fall to the next eligible free-tier model in the
  ladder (a Nemotron mirror while the Nemotron family's quota allows) —
  always with the IDENTICAL packet.
- Rubber-stamp tripwire (see AGENTS.md, "Rubber-stamp tripwire"):
  two consecutive mechanically weak-effort rounds by the same reviewer
  model → the next round executes the "Elevated rubric (cross-check
  round)" section above. A single weak-effort verdict is never acted
  on — it is returned to the same reviewer model for correction at
  the same SHA (deficiency named), before any pattern strike is
  counted.

## Verdict format (mandatory)

The subagent returns **all** of these fields, in this order, in plain
text:

```text
SHA:           <head sha (base <base sha>), <n> commits on <branch>>
Scope:         <one line: what was reviewed>
Verdict:       APPROVE | APPROVE_WITH_NITS | BLOCK
Required:      P0: <count>  P1: <count>  P2: <count>
Blockers:      <numbered list, each with its one-sentence harm-test answer, or "none">
Candidate-findings-considered: <two or more, each with the evidence that ruled it out>
Strongest-case-for-blocking: <one paragraph; required unless BLOCK>
Nits:          <numbered list, or "none">
Risks:         <second-order impacts beyond the blast-radius boundary: one sentence each, ungraded, or "none">
Notes:         <one paragraph: what the orchestrator should do next>
```

- **Candidate-findings-considered:** entries must be file:line-cited per
  the effort floor's citation standard; more than one uncited entry
  classifies the verdict as mechanically weak-effort.

## Severity definitions and calibration

- **P0** = breaks a gate or a documented invariant; crashes/hangs the
  process; corrupts data. Blocks merge.
- **P1** = real defect requiring correction before merge (missing
  shutdown path, flaky test, doc-behavior drift).
- **P2** = style, naming, future cleanup. Does not block.
- **BLOCK** if any P0 or unresolved P1 — _after_ the harm test below.
- **APPROVE_WITH_NITS** only if zero P0 and zero P1.

## Severity calibration (harm test — anti-inflation)

Severity tracks harm, not fix effort. Every P0 or P1 finding must answer
the **harm test** in one sentence: _"If this merged and nobody ever
fixed it, what specific bad thing happens, to whom, and when is it
observable?"_

- A finding whose honest answer is "nothing observable" is P2,
  regardless of how trivial or how deep the fix is. Fix size decides
  nothing on its own.
- A one-line fix CAN be a genuine P0 (a wrong required-checks list, a
  broken command, a wrong safety instruction) — the harm decides, not
  the line count.
- Factually false or self-contradicting statements in a governed doc
  are at least P1 (every future agent is misled), and P0 only when an
  actor following them takes a materially wrong action (bypasses a real
  gate, blocks a legitimate merge, merges unreviewed behavior).
  "Unenforceable", "ambiguous", and "theater" criticisms are P1 at
  most — and only when the missing enforcement would change an outcome
  that matters; otherwise P2.

**Adjudication rights (symmetric check):** the orchestrator may
reclassify a finding's severity downward or upward, with the
justification recorded in the PR body beside the verbatim verdict; it
may never dismiss the finding itself. Every reclassification is
audit-visible and feeds the reviewer model's calibration record in the
journal's model-performance log.

**Verdict discipline:** a BLOCK verdict in which any blocker carries no
harm-test sentence is mechanically weak-effort (it feeds the tripwire
like any other low-effort round); a blocker whose harm sentence is
present but hollow is a semantic-check item — auditor-owned, and
escalated under the same tripwire machinery when audit catches it.

## Scope by blast radius

Findings and Risks are separated by causal distance from the diff:

- **First order — graded findings, ordinary severity range.** The diff
  itself and its directly adjacent surfaces: files touched, their
  immediate callers and consumers, tests that pin the changed
  behavior, CI/gate surfaces it affects, docs that describe it.
  Anything here that passes the harm test may be graded P0/P1/P2.
- **Second order — Risks, ungraded.** Effects mediated through
  speculation ("future agents might ...", "a downstream consumer
  could eventually ..."). Each Risk is one sentence, carries no P
  grade and no blocking power, but is recorded in the PR body and the
  backlog register. If a Risk later materializes, it becomes a finding
  in the round that owns the triggering change — never silently
  dropped.

**Reclassification moves both ways, with recorded justification**
(verdict verbatim + adjudication note in the PR body): the
orchestrator may demote an inflated finding to a Risk and may promote
a Risk whose first-order evidence was understated — a reviewer
softening real adjacent harms into Risks to make a verdict look clean
is severity deflation and feeds the same calibration record as
inflation.

**Why this boundary exists:** it keeps reviews honest in both
directions — real adjacent harms stay graded, distant speculation is
preserved but not weaponized into blockers, and the reviewer is never
forced to choose between inflating and silencing.

- **APPROVE** is clean — and audited: the orchestrator checks the
  effort floor against the mechanical classification before acting on
  it. A single mechanically weak-effort verdict (even a "clean-looking"
  APPROVE) is **never acted on**: it is returned to the SAME reviewer
  model for a corrected verdict at the same SHA, with the mechanical
  deficiency named. The "Elevated rubric (cross-check round)" section
  is the PATTERN escalation — reserved for two consecutive weak-effort
  rounds by the same reviewer per the tripwire; it does not fire on
  the first defective verdict.

The orchestrator pastes the verdict verbatim into the PR description. It
does not paraphrase, summarize, or re-interpret it — and it adjudicates
each finding against the code before acting on it (the reviewer can also
be wrong; that is why findings are evidence-proof, countable, and
spot-checked).

## Fresh review on every commit

Any new commit on the branch invalidates the prior review. Re-open a
fresh review at the new head SHA before merging. This includes
orchestrator-authored doc edits made "while the PR is open".

## What the reviewer reads

The reviewer reads **the diff and the code it touches**, not the
orchestrator's summary of them. For MEDIUM+ risk the reviewer also
independently re-runs the gate suite and reports its own counts; the
orchestrator cross-checks both tables rather than averaging them.
