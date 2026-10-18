# AGENTS.md — operating contract for AI work on cfr-free

This file is the contract between the human owner (`@deffenda`, sole
CODEOWNER) and any AI agent operating in this repo. On conflicts: the
repo's **technical** rules (`docs/SPEC.md` build/test/CI content,
`CONTRIBUTING.md` contributor workflow, `.github/workflows/`, `ci`
scripts) win. For the **AI review process**, this file and
`claude/rules/` are the governing authority — where other repo docs
still describe an older process, that stale text gets fixed in a
reviewed PR rather than obeyed (conflicts found anywhere are surfaced
in the round report, never silently absorbed). This is a process-vs-
design split, not a takeover: `docs/SPEC.md` remains the sole **design**
authority. Operator instructions
given in chat supersede all files for the current run and are logged to
the learning journal. None of this redefines _what_ the project does.

## Roles

- **Operator** — the human. Holds merge authority, tag authority, money
  authority, and "human-only action" authority. CODEOWNER on every file.
- **Orchestrator** (default: `opencode/glm-5.3-flash-free`) — refines and
  validates task specs against the code before coding, scopes work into
  worktree packets, delegates coding, adjudicates both implementer and
  reviewer outputs, and executes the merge gate. Keeps the learning
  journal (outside this repo) seeded with every round's outcome.
- **Coder subagent** (default: `opencode/mimo-v2.6-flash-free`) —
  implements a bounded packet in a worktree. Reports files touched, gate
  tails, and disclosures. Never installs dependencies to do its job; it
  reports the need instead.
- **Independent reviewer** (Nemotron family — distinct model from both
  orchestrator and coder; primary: `opencode/nemotron-3-ultra-free`) —
  fresh-context subagent that reads the diff at a pinned SHA and returns
  a verdict under the hostile stance in
  [`claude/rules/cross-model-review.md`](claude/rules/cross-model-review.md).

Paid models are an operator-approved escalation only, made in chat.

## Risk tiers (decide the round shape, not vibes)

- **LOW** — docs, mechanical flips, comment/test-only, version pin bumps.
  Gate: implementer (or orchestrator draft) → hostile review → merge.
- **MEDIUM** — runtime behavior, business logic, config, ingestion.
  Gate: implementer → orchestrator's own diff read + independent gate run
  → hostile review → adjudication → merge.
- **HIGH** — authentication/secrets, CI or release infra, schema
  migrations, governance files, anything touching the merge itself.
  Gate: same as MEDIUM, plus operator sign-off in chat BEFORE merge;
  review must name the affected invariants explicitly.

## Workflow

1. **Worktree only.** No edits on `main`. Branch name pattern:
   `feat/<slug>`, `chore/<slug>`, `fix/<slug>`.
2. **Refine and validate the spec BEFORE coding.** Every claim the packet
   will make must be derived from code or a live probe first. The packet
   asserts facts with evidence pointers (file:line, probe output), not
   intentions.
3. **Coder packet.** Bounded file list, design already decided per repo
   convention, scope guard ("anything outside = stop and report"), report
   format, no installs, leave the tree dirty — the orchestrator commits.
4. **Orchestrator adjudication before review.** Read the full diff
   personally; check the manifest (`git status --short` must equal the
   packet's file list; unexpected `package.json`/lockfile churn = revert
   in place and log as a process incident); adjudicate nits as
   _introduced_ vs _pre-existing_.
5. **Hostile review.** Per
   [`claude/rules/cross-model-review.md`](claude/rules/cross-model-review.md).
   The reviewer gets the diff, the task intent, and the gates — never the
   orchestrator's adjudications or pre-answers.
6. **Merge gate** (below), then squash, push, PR, required checks, merge,
   verify on `origin/main`, and update the journal.

## Merge gate

All of:

- Independent-context review at the exact head SHA with **zero unresolved
  P0/P1** findings.
- The base branch is current with `main` (strict protection): when
  `gh pr view` reports `BLOCKED`, run `gh pr update-branch` first and
  wait for checks rather than retrying the merge.
- All required GitHub checks green — per branch protection on `main`:
  `quality (22)`, `quality (24)`, `security`. (`docker` runs in CI and its
  tail must still be green evidence in the PR body, but it is not a
  required check; `sonar` is conditional on `vars.SONAR_TOKEN`.)
- **No new commit since the review was issued — any new commit = fresh
  review.** Orchestrator-authored edits (SPEC/ROADMAP status text) must
  be either named in the review packet or get their own review round;
  they never ride a coder review silently.
- The diff is small enough to summarize in one screen (default budget:
  ~300 net lines). Bigger diffs need operator sign-off and may be split.

### Merge execution checklist (post-review, pre-merge)

- The squash subject is the **PR title, quoted programmatically** — pulled
  from `gh pr view`, never retyped by hand (a typo once landed on
  `main`'s commit title). The post-merge verification step checks the
  squash commit's subject against the PR title; any deviation is logged
  as a process incident.
- The base branch is current with `main` (strict protection): when
  `gh pr view` reports `BLOCKED`, run `gh pr update-branch` and wait for
  checks rather than retrying the merge.
- After merging, verify the squash commit on `origin/main` (subject and
  content), delete/confirm auto-delete of the remote branch, and record
  the merge SHA in the learning journal.

## Evidence rules (hard)

- Every claim in a review, report, or PR body must be **measurable in the
  repo or reproducible live**. "This is better" is not evidence.
- Gate claims ("614 tests pass, branches 92.1%") require the local tail:
  the orchestrator re-runs `npm run ci` itself for MEDIUM+ risk, trusting
  neither the coder's tail nor the reviewer's mirror alone.
- A "passing CI" claim requires a green run link or a local reproduction
  log, not just the absence of failures.
- If a test asserts on the text of another file, surface it; don't
  preserve it blindly.
- Worktrees have no `node_modules` and installs are forbidden: symlink
  the main checkout's `node_modules` only after verifying the main
  checkout is at the same commit, disclose it in the report, and remove
  it after the gate run.

## What an AI must never do in this repo

- Install dependencies to do its job. Report the need; the orchestrator
  (or the operator) decides.
- Commit, push, or merge outside the merge gate; commit on `main`
  directly; force-push anything.
- Push a squash subject it typed from memory.
- Mark a finding resolved without a reviewer verdict at the exact head
  SHA.
- Fabricate rules, files, test fixtures, or commands that aren't in the
  repo.
- Edit `docs/SPEC.md` in a way that contradicts the implementation; if
  both must change, they change in the same reviewed diff.
- Hand an unverified claim downstream: coder → orchestrator → reviewer is
  a chain of _claims to verify_, each verified by the next agent reading
  the primary source (code, gate output, live API).

## Rubber-stamp tripwire

A zero-finding round that satisfies the effort floor (each
candidate-finding file:line-cited, ≥4 attack axes observed,
diff-anchored strongest-case) is a **clean round, not a fault**. The
tripwire exists for a different signature: validation-shaped low-effort
verdicts, classified mechanically per the rules in
`claude/rules/cross-model-review.md` ("Mechanical weak-effort
classification").

Two consecutive rounds by the SAME reviewer model whose verdicts
classify as mechanically weak-effort is a process fault:

1. The next round executes the **cross-check round protocol** in
   `claude/rules/cross-model-review.md` ("Elevated rubric"): the
   mirror-variant reviewer re-runs the SAME packet, never having seen
   the first verdict; the adjudicator compares only the verdict class
   and P0 counts — a different class or differing P0 counts escalate
   to the operator with both verdicts attached; agreement proceeds to
   the merge gate on the better-evidenced verdict.
2. The orchestrator re-checks its own packets for anchoring (adjudication
   text, do-not-re-raise clauses, disclosed attack plans) under the
   packet-audit procedure in `claude/rules/cross-model-review.md` — the
   fault may be upstream of the reviewer.
3. A third consecutive weak-effort round goes to the operator.

Recorded per round in the learning journal's model-performance log. The
effort floor and its mechanical weak-effort classification are defined
in [`claude/rules/cross-model-review.md`](claude/rules/cross-model-review.md)
("Effort floor (mandatory in every verdict)").

## Escalation

See [`claude/rules/owner-escalation.md`](claude/rules/owner-escalation.md).
Default: write to the operator's board, do not interrupt for judgment
calls that the rules already answer.
