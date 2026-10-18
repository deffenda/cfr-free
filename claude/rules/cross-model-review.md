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

- At least **two candidate findings the reviewer considered and
  discarded, with the evidence that ruled each out**. "None found" is not
  an acceptable filling of this requirement.
- If the verdict is APPROVE or APPROVE_WITH_NITS: a named paragraph,
  **"Strongest case for blocking"** — the reviewer's best argument for
  BLOCK and what evidence would flip the verdict.

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

## When a review is required

**Every change that reaches `main` via PR gets a reviewer round.** The
reasoning: reviews are free-tier and cheap, and the diff with its
verdict is the paper trail the operator audits. Gate rounding:

- LOW risk: one reviewer.
- MEDIUM risk: orchestrator's own gate re-run in addition.
- HIGH risk: reviewer plus an explicit invariant-naming pass, and
  operator sign-off before merge.

## Reviewer model and availability ladder

- Primary: `opencode/nemotron-3-ultra-free` (fresh subagent context,
  model passed explicitly).
- Transient upstream 5xx (e.g. 503): retry the same model once, then
  fall to a sibling free variant (`opencode/nemotron-3.5-super-vl-free`,
  `opencode/nemotron-3.5-lightning-free`) with the IDENTICAL packet.
- Rubber-stamp tripwire (see AGENTS.md): two consecutive zero-finding
  rounds by the same reviewer model → next round uses a sibling variant.
- Never the orchestrator's model; never the coder's model.

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

- **P0** = breaks a gate or a documented invariant; crashes/hangs the
  process; corrupts data. Blocks merge.
- **P1** = real defect requiring correction before merge (missing
  shutdown path, flaky test, doc-behavior drift).
- **P2** = style, naming, future cleanup. Does not block.
- **BLOCK** if any P0 or unresolved P1.
- **APPROVE_WITH_NITS** only if zero P0 and zero P1.
- **APPROVE** is clean — and audited: the orchestrator checks that the
  effort floor was actually met before acting on it. An APPROVE with an
  empty candidate-findings list is returned for re-review under the
  elevated rubric.

The orchestrator pastes the verdict verbatim into the PR description. It
does not paraphrase, summarize, or re-interpret it — and it adjudicates
each finding against the code before acting on it (the reviewer can also
be wrong; that is why findings are evidence-prof, countable, and
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
