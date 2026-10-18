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
journal at `~/.orchestrator/JOURNAL.md` (the documented location and
retention policy: entries are never rewritten or deleted; each round's
record carries the packet's file list, the banned-content check
statement, and the verdict). Audits are performed by the **operator** or
the REVIEWER OF THE NEXT round — never solely by the person who wrote
the packet. A packet found in violation voids the reviewer round it
produced: the review is re-run from a clean packet at the same SHA.

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
  model → next round uses a mirror variant, the elevated rubric, and a
  mirror-variant cross-check pass.

## Verdict format (mandatory)

The subagent returns **all** of these fields, in this order, in plain
text:

```
SHA:           <exact base SHA + note: uncommitted on <branch>>
Scope:         <one line: what was reviewed>
Verdict:       APPROVE | APPROVE_WITH_NITS | BLOCK
Required:      P0: <count>  P1: <count>  P2: <count>
Blockers:      <numbered list, or "none">
Candidate-findings-considered: <two or more, each with the evidence that ruled it out>
Strongest-case-for-blocking: <one paragraph; required unless BLOCK>
Nits:          <numbered list, or "none">
Notes:         <one paragraph: what the orchestrator should do next>
```

- **Candidate-findings-considered:** entries must be file:line-cited per
  the effort floor's citation standard; more than one uncited entry
  classifies the verdict as mechanically weak-effort.
- **P0** = breaks a gate or a documented invariant; crashes/hangs the
  process; corrupts data. Blocks merge.
- **P1** = real defect requiring correction before merge (missing
  shutdown path, flaky test, doc-behavior drift).
- **P2** = style, naming, future cleanup. Does not block.
- **BLOCK** if any P0 or unresolved P1.
- **APPROVE_WITH_NITS** only if zero P0 and zero P1.
- **APPROVE** is clean — and audited: the orchestrator checks the effort
  floor against the mechanical classification before acting on it; a
  mechanically weak-effort verdict (even a "clean-looking" APPROVE) is
  returned for re-review under the
  elevated rubric.

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
