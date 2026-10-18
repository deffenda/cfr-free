# Cross-model review rule

Defines how the orchestrator hands work to the **independent reviewer**
(NEVER the orchestrator's own model; coder and reviewer are always
different models) and how the verdict flows back.

## Reviewer stance: hostile, by default

The reviewer's job is to find reasons to **block**, not to confirm
correctness. An APPROVE verdict carries the burden of proof; a zero-finding
APPROVE is a process warning (see AGENTS.md's tripwire), not a compliment.

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
appears in two consecutive rounds by the same reviewer model): any
required verdict field missing; more than one candidate finding lacking
a citation; a strongest-case paragraph with no diff-location reference;
evidence-free assertions anywhere in the verdict.

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
   defective — is re-sent to a **mirror-variant reviewer model** (see
   the model roster above).
2. The mirror reviewer has NEVER seen the first verdict (packet rules
   apply in full; providing the first verdict to the mirror reviewer is
   itself an anchoring violation). It returns the standard mandate
   format verbatim.
3. **Disagreement rule (mechanical):** compare only the verdict class
   (BLOCK vs non-BLOCK) and the P0 counts of the two rounds. A
   different class, or differing P0 counts, escalates to the operator
   with both verdicts attached. Identical class and P0 count but P1
   counts differing by 2 or more also escalate; small P1 discrepancies
   are adjudicated by the orchestrator and disclosed. Identical class,
   P0 count, and compatible P1 counts → proceed to the merge gate on
   the **better-evidenced verdict**: the one whose candidate findings
   all carry the effort floor's file:line citation standard; if both
   qualify, the one with more file:line-cited candidates.
4. **Verdict capture:** the mirror reviewer returns its verdict as its
   final message; the orchestrator captures that message verbatim into
   the journal round record and the packet directory (`~/.orchestrator/
packets/`) — the same capture path as every other round. The record
   names the packet, both reviewer models, and the comparison result.
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

- Primary reviewer role: a Nemotron-family free variant, **never the
  orchestrator's model, never the coder's model**. Fresh subagent
  context, model passed explicitly per round.
- **Model roster** (operator-maintained; current values are visible in
  this file's git history — the roster is updated by a one-line PR
  whenever a model ID changes): primary
  `opencode/nemotron-3-ultra-free`; mirror variants
  `opencode/nemotron-3.5-super-vl-free`,
  `opencode/nemotron-3.5-lightning-free`. The rules bind ROLES, not IDs:
  if an ID is unavailable or renamed, the operator updates the roster
  and the ladder logic still holds.
- Transient upstream 5xx (e.g. 503): retry the same model once, then
  fall to any mirror variant with the IDENTICAL packet.
- Rubber-stamp tripwire (see AGENTS.md, "Rubber-stamp tripwire"):
  two consecutive mechanically weak-effort rounds by the same reviewer
  model → the next round executes the "Elevated rubric (cross-check
  round)" section above.

## Verdict format (mandatory)

The subagent returns **all** of these fields, in this order, in plain
text:

```
SHA:           <head sha (base <base sha>), <n> commits on <branch>>
Scope:         <one line: what was reviewed>
Verdict:       APPROVE | APPROVE_WITH_NITS | BLOCK
Required:      P0: <count>  P1: <count>  P2: <count>
Blockers:      <numbered list, each with its one-sentence harm-test answer, or "none">
Candidate-findings-considered: <two or more, each with the evidence that ruled it out>
Strongest-case-for-blocking: <one paragraph; required unless BLOCK>
Nits:          <numbered list, or "none">
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

**Verdict discipline:** a BLOCK verdict in which any blocker fails the
harm test is itself classified as mechanically weak-effort (a severity
that cannot be defended in one evidence sentence is an evidence-free
assertion) — it feeds the rubber-stamp tripwire like any other
low-effort round, in either severity direction.

- **APPROVE** is clean — and audited: the orchestrator checks the effort
  floor against the mechanical classification before acting on it; a
  mechanically weak-effort verdict (even a "clean-looking" APPROVE) is
  returned for re-review under the "Elevated rubric (cross-check
  round)" section above.

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
