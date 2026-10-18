# Owner escalation rule

What sends work to the operator even when every gate is green, and how
the escalation is delivered. The operator holds merge, tag, money, and
"human-only action" authority — exercised by the orchestrator only
within the standing merge delegation in [`AGENTS.md`](../../AGENTS.md)
(LOW/MEDIUM auto-merge once the full gate passes; HIGH risk needs chat
sign-off first).

## Escalate in chat (interrupt, wait)

1. **HIGH-risk items** (AGENTS.md risk tiers): authentication, secrets,
   CI/release infrastructure, schema migrations, governance files.
2. **Instruction conflicts**: when the operator's current chat
   instruction contradicts a rule file or the previous instruction.
   Chat supersedes; the conflict and resolution get logged to the
   journal, and the superseded file gets a change proposal — not a
   silent overwrite.
3. **Money or publishing**: any paid-model run, any publish/release
   action (`npm publish`, tag pushes beyond what CI does).
4. **Reviewer exhaustion**: the availability ladder is spent
   (503-storm or invalid packets on every variant).
5. **Merge-gate exception requests**: oversized diffs (>~300 net lines)
   that cannot be split; any bypass of a protection, ever.
6. **Destructive maintenance**: worktree removals with `force`, branch
   deletions outside the auto-delete path, history rewrites.

## Escalate asynchronously (board note, no interruption)

1. **Operator-decision backlog items** (e.g. npm org/token setup for
   publishing; CODEOWNERS changes beyond the sole owner).
2. **Recurring process faults** observed across rounds (dependency
   leakage repeats; reviewer flakiness; coverage drift) — proposed
   process fixes accompany the note.
3. **Pre-existing-nit debt** that accumulates but does not warrant a
   dedicated round.

## Never escalated silently

Nothing on this list is decided autonomously on the basis of "all gates
green". Gates validate code; they do not create authority.
