# AGENTS.md — operating contract for AI work on cfr-free

This file is the contract between the human owner (`@deffenda`, sole
CODEOWNER) and any AI agent operating in this repo. The repo's other rules
(`docs/SPEC.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `.github/workflows/`, the
`ci` script in `package.json`) **win** over this file on any conflict.
Operator instructions given in chat supersede this file for the current
run and are logged to the learning journal. This file only governs _how_
AI work happens; it does not redefine _what_ the project does.

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
- All required GitHub checks green (`quality (22)`, `quality (24)`,
  `security`, `docker`; `sonar` is conditional on `vars.SONAR_TOKEN`).
- **No new commit since the review was issued — any new commit = fresh
  review.** Orchestrator-authored edits (SPEC/ROADMAP status text) must
  be either named in the review packet or get their own review round;
  they never ride a coder review silently.
- The diff is small enough to summarize in one screen (default budget:
  ~300 net lines). Bigger diffs need operator sign-off and may be split.

The merge is **squash** into `main`. The subject is quoted verbatim from a
source-of-truth file or the PR title — never retyped by hand (a typo once
landed on `main`'s commit title because it was typed inline).

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

Two consecutive rounds in which the SAME reviewer model returns zero
findings is a process fault, not a success:

1. The next round switches reviewer variant (e.g.
   `opencode/nemotron-3.5-super-vl-free`) and uses the elevated rubric.
2. The orchestrator re-checks its packets for anchoring (adjudication
   text, do-not-re-raise clauses, disclosed attack plans) and strips
   them.
3. A third consecutive zero-finding round goes to the operator.

Recorded per round in the learning journal's model-performance log.

## Escalation

See [`claude/rules/owner-escalation.md`](claude/rules/owner-escalation.md).
Default: write to the operator's board, do not interrupt for judgment
calls that the rules already answer.
