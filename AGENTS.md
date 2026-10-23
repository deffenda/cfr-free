# Agent instructions: cfr-free

<!-- prettier-ignore-start -->
<!-- fleet-core:begin (generated: edit the fleet source, not this block) -->
## Fleet core

Applies to every repository in the fleet. It is generated from one source; repository-specific rules go outside the markers.

### Evidence
- Read live state before stating it: fetch the remote, read the default branch, run the command. A number or an "X is missing" taken from a doc or a stale checkout is a claim to verify. A figure in a doc carries its date and how it was read.
- Find the root cause before proposing a remedy. For an unreachable or hung host, check its network interface and the previous boot's log before blaming memory.
- Give one account of a fact. If two places disagree, fix or flag one.
- Say plainly what you did not verify.

### Changes
- One bounded task per change request. Stay in scope: no drive-by edits and no agent scratch files committed.
- Run the repository's validation (named below) before pushing.
- A change request merges when a fresh-context review of the exact head has no unresolved P0 or P1 findings and every required check is green. A new commit needs a new review; a clean automatic merge of the base branch keeps the review.
- At most three open non-draft change requests per repository. While the fleet backlog check reports a backlog, finish and land existing work and start nothing new.
- Fix a finding that takes minutes in the current change; fold the rest into an existing tracking issue. A session closes at least as many issues as it opens on its own initiative; tickets the owner asks for in chat are separate.

### Safety
- Never print, log or commit tokens, passwords or keys. Use the credential helper the repository names.
- One writer per checkout: separate worktrees for separate writers. Do not force-push, rebase or delete a branch another session may own.
- Private repositories run CI on self-hosted runners only. A job that must not share a host (for example signing) runs on a dedicated self-hosted runner group, never on a GitHub-hosted runner without the owner's approval.
- Ask the owner only for a step no agent can do or for a spend or legal commitment; decide and record everything else.

### Layout
- AGENTS.md is the canonical agent file; where a CLAUDE.md exists it only imports it. Keep this file under 200 lines.
- Name this repository's validation command, merge rule and changelog rule outside the markers. Rules kept outside the repository are not visible here: if a task seems to need one, ask rather than guess.
- Shared skills are installed per machine from the fleet skills hub. Name the ones this repository expects below.

### Forge: GitHub
- Prefer REST (`gh api repos/OWNER/REPO/...`) to GraphQL for single reads: the rate-limit pools are shared by every session on the account.
- Required checks and review rules are branch protection or rulesets; read them with `gh api`. Review-thread resolution needs GraphQL.
<!-- fleet-core:end -->
<!-- prettier-ignore-end -->

## Repository-specific

- Public repository: every file here, and anything an agent writes into it (code, comments, commit messages, pull request text), is world-readable. Never add host names, user names, IP addresses, keys, tokens or other real data.
- Operator: `@deffenda` is the sole CODEOWNER and holds merge, tag, money and publishing authority. Operator instructions given in chat supersede these files for the current run.
- Authority: `docs/SPEC.md` is the design authority; `CONTRIBUTING.md`, the workflows in `.github/workflows/` and the scripts win on technical build, test and CI content. Do not edit `docs/SPEC.md` so that it contradicts the implementation; change both in the same reviewed diff.
- Validation: `npm run ci` (format check, lint, typecheck, coverage tests, build, `scan:audit`). While developing, run the one file you changed (`npx vitest run test/<file>`), not the full gate. A docs-only change still needs the four tests that read docs: `markdown-tables`, `no-conflict-markers`, `openapi-conformance` and `install-paths`.
- Workflow files: run `npm run lint:actions` (`actionlint`, install with `brew install actionlint`) before pushing any change under `.github/workflows/`. CI cannot report an invalid workflow file: GitHub answers it with a failed run that has zero jobs, so no check ever reports and the pull request cannot go green. It is deliberately not part of `npm run ci`.
- Push discipline: CI runs on every push, and a run that a later push supersedes taught nothing (measured 2026-10-22: 102 of 211 `pull_request` runs in a week tested a commit replaced before merge). Commit locally and push once per review round.
- Merge: the fleet core's merge rule applies, and merge is a human operation. Required checks on `main` are `quality (22)`, `quality (24)` and `security`; `docker` runs in CI but is not required. There is no hosted code-scanning job: the local gates are the scanning floor. Branch protection is strict, so when `gh pr view` reports `BLOCKED`, run `gh pr update-branch` and wait for checks. A diff over about 300 net lines is split or needs the operator's sign-off. No new commit after the review: any new commit needs a fresh review.
- Squash subject: take it from the pull request title programmatically (`gh pr view`), never retype it. After merging, check the commit on `origin/main` with `gh api repos/<owner>/<repo>/commits/<sha> --jq .commit.message`; `gh pr view` has returned an empty merge-commit headline after a merge.
- Changelog: this repository keeps no changelog file.
- Evidence: a claim in a review, report or pull request body must be measurable in the repo or reproducible live. A gate claim ("N tests pass") needs the local output, and "CI passes" needs a green run link. If a test asserts on the text of another file, surface it. Do not invent rules, files, fixtures or commands.
- Dependencies: an agent does not install dependencies to do its job; it reports the need. A worktree has no `node_modules`: link the main checkout's `node_modules` only after confirming it is at the same commit, and remove the link after the gate run.
- Ask the owner first for: paid-model runs, publishing or release actions (`npm publish`, tag pushes beyond what CI does), force-removing a worktree, deleting a branch outside the auto-delete path, rewriting history, and any bypass of a branch protection.
- SureForge: code changes run through a SureForge supervised contract that lives outside this repository, in a clean linked worktree on an unprotected branch. Inside a run, agents do not commit, push, switch branches, stash or change Git config. SureForge refuses contracts whose scope includes agent-configuration files (`AGENTS.md`, `CLAUDE.md`); changes to those are hand-made pull requests.
- Skills: this repository expects no hub skills.
