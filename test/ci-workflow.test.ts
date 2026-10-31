/**
 * The CI workflow guard.
 *
 * The workflows are parsed with the `yaml` package — the same parser the
 * OpenAPI contract suite uses — so the checks read the DOCUMENT's
 * structure: a job's steps, a step's `uses`, a step's `run`, a step's
 * `with`. A text guard has to re-implement YAML's rules to find the same
 * facts, and every rule it re-implements is a rule it can get wrong.
 * This file used to do exactly that: its own parser grew to nearly eight
 * hundred lines, and most of what was left was tests of that parser
 * rather than of the workflow it guards. The parser now lives in
 * `test/workflows.ts`, so the two guard files that read the workflows
 * share one reading of the documents.
 *
 * What this file covers, and why `actionlint` cannot:
 *
 *  - the gate the package declares (`npm run ci`) runs in the workflow, in
 *    the same order, one step each — no workflow linter knows what the
 *    package's own gate says;
 *  - every action is pinned to a commit SHA — a linter does not care what
 *    an action is pinned to;
 *  - every action reference names an ALLOWLISTED repository, and every
 *    container image is pinned by digest — a pin says the COMMIT is
 *    fixed, not that the repository is an action at all;
 *  - the pinned actionlint install is in an EARLIER STEP than the gate
 *    that shells out to it, AND than any step that runs actionlint by
 *    absolute GOPATH path — `GITHUB_PATH` applies to later steps only, so
 *    a fold that puts them in one step dies with `actionlint: command not
 *    found` however it is ordered inside it;
 *  - the checkout carries the tags and the history the release guard
 *    reads;
 *  - the workflow still produces every check branch protection requires.
 *
 * What `actionlint` covers, and why it is not duplicated here: GitHub's
 * expression grammar, the contexts a job may read, and the shapes GitHub
 * rejects outright. A workflow that is valid YAML but invalid to GitHub
 * yields a failed run with zero jobs, so no check ever reports — only
 * `actionlint` rules that out, and it runs inside the gate itself
 * (`npm run ci` → `npm run lint:actions`).
 *
 * The SCANNING jobs — trivy, semgrep, the image the docker job builds —
 * are guarded in `test/ci-scanner-jobs.test.ts`, as their own unit.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ci,
  jobOf,
  loadWorkflow,
  parseWorkflow,
  release,
  workflowFiles,
  type Job,
} from './workflows.js';

const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

const manifest = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
  scripts: Record<string, string>;
};

// ---------------------------------------------------------------------------
// The facts the checks read.
// ---------------------------------------------------------------------------

/**
 * An action reference pinned to a full commit SHA: `owner/repo@<40 hex>`.
 * The path may carry extra segments for an action that lives in a
 * subdirectory (`google/osv-scanner-action/osv-scanner-action`).
 */
const PINNED_ACTION = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;

/**
 * The action repositories the workflows may reference.
 *
 * A SHA pin says the COMMIT is fixed; it says nothing about whether the
 * repository is an action at all. `semgrep/semgrep` is the semgrep CLI's
 * repository: it publishes no action manifest, so `uses: semgrep/semgrep@
 * <sha>` did not name an action — GitHub fell back to building the
 * repository's root Dockerfile, whose `CMD` is `semgrep --help`, and the
 * step exited 0 without scanning anything (verified 2026-10-30). A
 * repository that is not an action is not on this list, so the reference
 * fails the check instead of the run.
 *
 * The repository is the first TWO segments of the reference: an action
 * that lives in a subdirectory of its repository (`google/osv-scanner-
 * action/osv-scanner-action`) is still that repository.
 */
const ALLOWED_ACTIONS = new Set([
  'actions/attest-build-provenance',
  'actions/checkout',
  'actions/setup-node',
  'actions/upload-artifact',
  'aquasecurity/trivy-action',
  'docker/build-push-action',
  'docker/login-action',
  'docker/metadata-action',
  'docker/setup-buildx-action',
  'docker/setup-qemu-action',
  'gitleaks/gitleaks-action',
  'google/osv-scanner-action',
]);

/**
 * A container image pinned by digest: `name@sha256:<64 hex>`.
 *
 * A tag (`semgrep/semgrep:1.183.0`) moves under the pin exactly the way
 * an action tag does — the image behind the tag can be replaced, and the
 * version in the comment is then a claim about a moment. The digest
 * names the image.
 */
const DIGEST_PINNED_IMAGE = /^[\w][\w./-]*@sha256:[0-9a-f]{64}$/;

/**
 * The actionlint COMMIT every workflow install pins.
 *
 * The pin is the commit, not the tag: every other dependency these
 * workflows fetch is SHA-pinned, and this `go install` was the one
 * unpinned fetch — a retagged upstream release would have executed in CI
 * with the runner's credentials. The human version is named in the
 * comment beside the pin, the convention the actions already follow.
 *
 * One commit across the workflows — ci.yml's quality job, ci.yml's
 * `actionlint` job and release's `ci` job — or a change is green on one
 * leg and red on another. The local leg names its own copy of the version
 * in AGENTS.md and CONTRIBUTING.md; this test reads the workflow files and
 * package.json only, so a version mentioned only in prose is unguarded
 * BY CHOICE — every workflow install must equal the constant below.
 */
const ACTIONLINT_COMMIT = '914e7df21a07ef503a81201c76d2b11c789d3fca';

/** The release the pinned commit is: named in the comment beside the pin. */
const ACTIONLINT_VERSION = 'v1.7.12';

/** The install of the pinned actionlint, as a command. */
const ACTIONLINT_INSTALL = 'go install github.com/rhysd/actionlint/cmd/actionlint@';

/**
 * The checks branch protection on `main` requires. Keep in step with it.
 *
 * The list is FOUR checks, not three: `actionlint` is a required check too
 * (it is its own workflow job), and a guard that names only the three it
 * remembered under-states the merge floor the same way the documentation
 * did.
 */
const REQUIRED_CHECKS = ['quality (22)', 'quality (24)', 'security', 'actionlint'] as const;

/**
 * The gate the shared gate command is: `npm run ci` or `npm run
 * lint:actions`, the two spellings a step uses to run what runs locally
 * under `npm run ci` — in command position anywhere in a run value. The
 * command must stand alone as a word: `npm ci` is an install, and
 * `npm run ci:extra` is another script.
 *
 * The match is textual, not shell-aware: a value that only PRINTS the
 * command (`echo "npm run ci"`) counts as a consumer too — treating a step
 * that may run the gate as one that does is the safe direction, since the
 * finding it can raise is a missing install, never a skipped gate.
 */
const NPM_RUN_COMMAND = /(?:^|[\s;&|(`'"])npm run\s+([\w:.-]+)/g;

/**
 * A bare `npm test` in command position: npm's own spelling of the `test`
 * script, which the `npm run <script>` form does not match. The word
 * `test` must END there, so `npm run test:coverage` — a different script,
 * matched by the form above — is not read as the bare form.
 */
const NPM_TEST_COMMAND = /(?:^|[\s;&|(`'"])npm test\b/g;

/**
 * The scripts a run value invokes, in the order they sit: the `npm run
 * <script>` forms and the bare `npm test`, which npm resolves to the
 * `test` script.
 */
function invokedScripts(run: string): string[] {
  const found = [
    ...[...run.matchAll(NPM_RUN_COMMAND)].map((match) => ({
      index: match.index ?? 0,
      script: match[1] ?? '',
    })),
    ...[...run.matchAll(NPM_TEST_COMMAND)].map((match) => ({
      index: match.index ?? 0,
      script: 'test',
    })),
    ...[...run.matchAll(YARN_RUN_COMMAND)].map((match) => ({
      index: match.index ?? 0,
      script: match[1] ?? '',
    })),
  ];
  return found.sort((a, b) => a.index - b.index).map((entry) => entry.script);
}

/**
 * A `yarn <script>` command in command position: yarn's spelling of the
 * `npm run <script>` form, resolving the same script names — `yarn test`
 * is the `test` script, `yarn test:coverage` the script of that name.
 * The name must END there, so `yarn testing` is not the `test` script.
 */
const YARN_RUN_COMMAND = /(?:^|[\s;&|(`'"])yarn[ \t]+(?:run)?[ \t]*([\w:.-]+)/g;

/**
 * A `vitest run` invocation in command position: `npx vitest run …`, or a
 * bare `vitest run …`. The tail of the match is the command's own
 * arguments, which may name FILE FILTERS.
 *
 * The spelling matters: the derived gate set names npm SCRIPTS, and a job
 * that invokes vitest directly — the spelling `live-e2e.yml` already uses
 * — named no script at all, so it was not a gate job and no checkout depth
 * was demanded of it. A `vitest run` over the WHOLE suite runs the
 * release guard, so it is one.
 *
 * The `--run` spelling counts too: `vitest --run` is the same command
 * without the `run` subcommand, and it runs the same suite.
 */
const VITEST_RUN_COMMAND =
  /(?:^|[\s;&|(`'"])(?:npx)?[ \t]*vitest[ \t]+(?:run|--run)\b([^\n;&|)]*)/g;

/**
 * The options that select tests by NAME rather than by file: `-t` and
 * `--testNamePattern`. Such a run does not narrow the FILE set, so the
 * whole suite — the release guard included — is what runs.
 */
const NAME_PATTERN_OPTIONS = new Set(['-t', '--testNamePattern']);

/**
 * A `vitest` invocation's own words, with a quoted string kept as ONE
 * token: a test-name pattern (`-t "release guard"`) is two words to the
 * shell but one argument to vitest.
 */
function vitestTokens(tail: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  for (const char of tail) {
    if (quote) {
      if (char === quote) {
        quote = '';
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * The file filters a `vitest` invocation names, and whether it selected
 * tests by NAME.
 *
 * Every positional token is a filter, not just the first: a run may name
 * several files, and it reaches the release guard when ANY of them is the
 * guard's own file. A token right after an option is that option's VALUE
 * (`--exclude test/live.test.ts`), not a filter: such a run still covers
 * the whole suite but one file, so it is treated as no filter at all.
 */
function vitestFileFilters(tail: string): { filters: string[]; namePattern: boolean } {
  const tokens = vitestTokens(tail);
  const filters: string[] = [];
  let namePattern = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!token.startsWith('-')) {
      filters.push(token);
      continue;
    }
    if (NAME_PATTERN_OPTIONS.has(token.split('=')[0] ?? token)) namePattern = true;
    if (!token.includes('=')) {
      const next = tokens[index + 1];
      if (next !== undefined && !next.startsWith('-')) index += 1;
    }
  }
  return { filters, namePattern };
}

/**
 * Whether a filter names a WHOLE SET of files rather than one file: a glob
 * (any name holding a `*` or a `?`), a directory (`test`, `test/`), or a
 * name with no file extension at all. Such a filter reaches every file
 * under it, the release guard included.
 */
function namesAWholeSuite(token: string): boolean {
  if (/[*?[\]{}]/.test(token)) return true;
  if (token.endsWith('/')) return true;
  if (/\.[A-Za-z0-9]+$/.test(token)) return false;
  return true;
}

/**
 * Whether a `vitest` invocation's tail reaches the file that holds the
 * release guard.
 *
 * A whole-suite run is a gate run: the release guard is one of its files,
 * and a shallow checkout leaves it asserting nothing. A run with explicit
 * file filters runs THOSE files only, so it is a gate run when one of them
 * is the release guard's own file.
 */
function vitestReachesReleaseGuard(tail: string): boolean {
  const { filters, namePattern } = vitestFileFilters(tail);
  // A name pattern selects by NAME, not by file: the file set stays whole.
  if (namePattern) return true;
  // No filter at all: the whole suite runs, the release guard included.
  if (filters.length === 0) return true;
  for (const filter of filters) {
    if (filter.includes('install-paths')) return true;
    if (namesAWholeSuite(filter)) return true;
  }
  return false;
}

/**
 * Whether a run value invokes vitest over the file that holds the
 * release guard — either the whole suite, or that file itself.
 */
function runsReleaseGuardSuite(run: string): boolean {
  for (const match of run.matchAll(VITEST_RUN_COMMAND)) {
    if (vitestReachesReleaseGuard(match[1] ?? '')) return true;
  }
  return false;
}

/**
 * The depth a `fetch-depth` value asks for, with a LITERAL expression
 * resolved.
 *
 * GitHub evaluates `${{ … }}` before the action reads the input, so
 * `fetch-depth: ${{ 0 }}` asks for depth 0 exactly as `fetch-depth: 0`
 * does, and reading the raw text would fail a workflow that is correct.
 * Only a LITERAL is resolved — an expression that names something else
 * (`${{ inputs.depth }}`, `${{ matrix.depth }}`) cannot be read out of the
 * workflow text at all, so the value is returned as written and the guard
 * says what it can and cannot read.
 */
function resolveFetchDepth(value: string): string {
  const expression = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(value);
  if (expression === null) return value;
  const literal = expression[1] ?? '';
  if (/^\d+$/.test(literal)) return literal;
  const quoted = /^["'](\d+)["']$/.exec(literal);
  return quoted === null ? value : (quoted[1] ?? '');
}

/**
 * The gate command as TEXT, without the "in command position" rule: the
 * question this answers is only whether a workflow NAMES the gate at all,
 * so a mention in a comment counts.
 */
const GATE_NAMED = /npm run\s+(?:ci|lint:actions)(?![\w:.-])/;

/**
 * A command appending GOPATH's bin dir to GITHUB_PATH: the echoed content
 * must name `go env GOPATH` — an echo appending the wrong directory sets a
 * PATH the bare `actionlint` is not on — and the redirect must end the
 * line, so a note or echo QUOTING the redirect is documentation, not PATH
 * setup.
 */
const GITHUB_PATH_ECHO =
  /^\s*-?\s*(?:run:)?\s*echo\b.*go env GOPATH.*>>\s*"?\$(?:GITHUB_PATH|\{GITHUB_PATH\})"?\s*$/;

/** An actionlint run by absolute GOPATH path — no PATH lookup involved. */
const ACTIONLINT_BY_PATH = /\$\(go env GOPATH\)\/bin\/actionlint/;

/** The `npm run …` suffixes of the package's own gate, in order. */
function localGateCommands(script: string): string[] {
  return script
    .split('&&')
    .map((command) => command.trim())
    .filter((command) => command.length > 0)
    .map((command) => command.replace(/^npm run /, ''));
}

/**
 * The scripts that make a job a GATE job: `npm run ci` itself and every
 * step the `ci` script runs, plus the two scripts that run the whole test
 * suite on their own.
 *
 * DERIVED from package.json, not hard-coded. The hard-coded list was
 * `ci|lint:actions`, and it went stale the moment the gate grew a step:
 * a job that runs only `npm run test:coverage` — which runs the release
 * guard, and so needs the tags a shallow checkout does not carry — was
 * not a gate job at all, so the checkout-depth guard never saw it. A
 * step of the `ci` script that is no script of its own (a raw command)
 * invokes no gate command and is not one.
 *
 * `test` and `validate` are added on top of that derivation, because the
 * `ci` script names NEITHER of them: it runs `test:coverage`. Both run
 * the test file that holds the release guard — `test` runs the whole
 * vitest suite, `validate` runs the suite over the changed set — so a
 * job running either with a shallow checkout leaves the release guard
 * asserting nothing. That is CR-01's shape, one script name away, so
 * the set names them. Each is read from the manifest, so a rename drops
 * it rather than leaving a name behind that names nothing.
 */
const GATE_SCRIPTS = [
  ...new Set([
    'ci',
    ...['test', 'validate'].filter((name) => name in manifest.scripts),
    ...localGateCommands(manifest.scripts['ci'] ?? '')
      .map((step) => step.split(/\s+/)[0] ?? '')
      .filter((step) => step in manifest.scripts),
  ]),
];

/**
 * The scripts that invoke actionlint: `npm run ci` (which runs
 * `npm run lint:actions`) and every gate step whose own command runs
 * actionlint. DERIVED from package.json, so renaming the actionlint
 * script cannot leave the guard behind. A job running one of these shells
 * out to a bare `actionlint`, which the runner does not ship — so it
 * needs the pinned install and the PATH echo in an earlier step. A job
 * running any other gate step does not, and demanding the install of it
 * would fail a workflow that is correct.
 */
const ACTIONLINT_SCRIPTS = [
  ...new Set([
    'ci',
    ...GATE_SCRIPTS.filter((name) => (manifest.scripts[name] ?? '').includes('actionlint')),
  ]),
];

/** The `npm run …` suffixes a job's steps run, in order. */
function workflowRunSteps(job: Job): string[] {
  const steps: string[] = [];
  for (const step of job.steps) {
    const match = /^npm run (\S+)$/.exec((step.run ?? '').trim());
    if (match !== null) steps.push(match[1] ?? '');
  }
  return steps;
}

/**
 * The `node:` matrix value as text: a literal list, or the expression a
 * workflow writes to pick its legs per event.
 */
function matrixExpression(matrix: Record<string, unknown> | undefined): string {
  const node = matrix?.['node'];
  if (Array.isArray(node)) return node.map(String).join(', ');
  return typeof node === 'string' ? node : '';
}

/**
 * The version lists a `node:` matrix expression expands to, in source order:
 * the first entry is what a `pull_request` run gets, the second what the
 * other events get.
 */
function matrixArms(matrix: Record<string, unknown> | undefined): string[][] {
  return [...matrixExpression(matrix).matchAll(/fromJSON\('(\[[^']*\])'\)/g)].map((match) => {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
}

/**
 * The versions a `pull_request` run gets — the arm that has to carry every
 * check branch protection requires. Deliberately not the union: a version
 * present only in the push arm would still be missing from the pull request
 * that branch protection is waiting on.
 */
function pullRequestNodes(matrix: Record<string, unknown> | undefined): string[] {
  const literal = matrix?.['node'];
  if (Array.isArray(literal)) return literal.map(String);
  return matrixArms(matrix)[0] ?? [];
}

/** The steps of a job that append GOPATH's bin dir to GITHUB_PATH. */
function pathEchoSteps(job: Job): number[] {
  const found: number[] = [];
  job.steps.forEach((step, index) => {
    for (const line of (step.run ?? '').split('\n')) {
      if (GITHUB_PATH_ECHO.test(line)) found.push(index);
    }
  });
  return found;
}

/** The steps of a job that install the pinned actionlint. */
function installSteps(job: Job): number[] {
  const found: number[] = [];
  job.steps.forEach((step, index) => {
    if ((step.run ?? '').includes(ACTIONLINT_INSTALL)) found.push(index);
  });
  return found;
}

/**
 * The repository an action reference names: the first TWO segments before
 * the `@`, because an action that lives in a subdirectory of its
 * repository is still that repository.
 */
function actionRepository(uses: string): string {
  const before = uses.split('@')[0] ?? '';
  return before.split('/').slice(0, 2).join('/');
}

/** The steps of a job that run a gate command. */
function gateConsumerSteps(job: Job): number[] {
  const found: number[] = [];
  job.steps.forEach((step, index) => {
    const run = step.run ?? '';
    const invoked = invokedScripts(run);
    if (invoked.some((name) => GATE_SCRIPTS.includes(name)) || runsReleaseGuardSuite(run)) {
      found.push(index);
    }
  });
  return found;
}

/**
 * The steps of a job that shell out to actionlint — the gate steps that
 * need the pinned install and the PATH echo, as opposed to the gate
 * steps that need neither.
 */
function actionlintConsumerSteps(job: Job): number[] {
  const found: number[] = [];
  job.steps.forEach((step, index) => {
    const invoked = invokedScripts(step.run ?? '');
    if (invoked.some((name) => ACTIONLINT_SCRIPTS.includes(name))) found.push(index);
  });
  return found;
}

/**
 * The text before the first parenthesis that is not inside backticks — a
 * check name may carry one of its own (`quality (22)`), and the list
 * ends where the parenthetical begins.
 */
function beforeParenthetical(text: string): string {
  let inCode = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '`') inCode = !inCode;
    else if (!inCode && char === '(') return text.slice(0, index);
  }
  return text;
}

// ---------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------

describe('ci.yml — the workflow the merge gate depends on', () => {
  it('runs the local gate commands verbatim, in order, one step each', () => {
    // The workflow runs the gate as seven separate steps, so a failure
    // names itself: four of the five failures in the week to 2026-10-22
    // surfaced only as "Run npm run ci". The steps must be the package's
    // own gate, in its order — a step that ran `npm run lint --fix`, or
    // dropped the audit, would be a different gate wearing the same name.
    const local = localGateCommands(manifest.scripts['ci'] ?? '');
    const quality = jobOf(ci, 'quality');
    expect(quality, 'ci.yml has no `quality` job').toBeDefined();
    expect(workflowRunSteps(quality as Job)).toEqual(local);
  });

  it('installs the pinned actionlint before any job runs the shared gate', () => {
    // Silent failure this prevents: `npm run ci` runs `npm run
    // lint:actions`, so every JOB that invokes the shared gate needs the
    // pinned actionlint install — and a bare PATH invocation the
    // GITHUB_PATH echo — in an earlier step. The step rule is deliberately
    // stricter than line order: `GITHUB_PATH` applies only to subsequent
    // steps, so install, echo and gate folded into one step still die with
    // `actionlint: command not found` however they are ordered inside it.
    //
    // The rule is about the steps that SHELL OUT TO ACTIONLINT, and those
    // are derived from the manifest: a job that runs only `npm run
    // test:coverage` runs a gate command, but it never calls actionlint,
    // so demanding the install of it would fail a workflow that is
    // correct. A gate command that does call actionlint — `npm run ci`,
    // `npm run lint:actions` — still needs it.
    const findings: string[] = [];
    for (const workflow of workflowFiles) {
      for (const job of workflow.jobs) {
        const consumer = actionlintConsumerSteps(job)[0];
        if (consumer === undefined) continue;
        const where = `${workflow.file}: job \`${job.key}\``;
        const installs = installSteps(job).filter((index) => index < consumer);
        if (installs.length === 0) {
          findings.push(`${where}: runs the gate with no pinned actionlint install before it`);
        }
        // The gate shells out to a BARE `actionlint`, which the runner does
        // not ship: GOPATH's bin dir must be on PATH for the later steps.
        // An actionlint run by absolute path needs no PATH at all.
        const byPath = job.steps.some((step) => ACTIONLINT_BY_PATH.test(step.run ?? ''));
        if (!byPath && pathEchoSteps(job).filter((index) => index < consumer).length === 0) {
          findings.push(
            `${where}: bare gate with no \`>> "$GITHUB_PATH"\` echo appending $(go env GOPATH)/bin`,
          );
        }
      }
    }
    expect(findings, 'a job runs the gate without actionlint on PATH').toEqual([]);
  });

  it('installs the pinned actionlint before any job runs it by absolute GOPATH path', () => {
    // Silent failure this prevents: an actionlint run by ABSOLUTE path
    // (`"$(go env GOPATH)/bin/actionlint"`) reads no PATH, so the
    // GITHUB_PATH echo does not apply to it — but the BINARY still has to
    // have been installed by an EARLIER step, or the step dies with "No
    // such file or directory". This is the rule the gate-consumer rule
    // above applies, for the other spelling of the same invocation; it
    // used to be there and was dropped when the guard was rewritten.
    const findings: string[] = [];
    let seen = 0;
    for (const workflow of workflowFiles) {
      for (const job of workflow.jobs) {
        const absolute = job.steps.findIndex((step) => ACTIONLINT_BY_PATH.test(step.run ?? ''));
        if (absolute === -1) continue;
        seen += 1;
        const installs = installSteps(job).filter((index) => index < absolute);
        if (installs.length === 0) {
          findings.push(
            `${workflow.file}: job \`${job.key}\`: GOPATH-path actionlint with no pinned install before it`,
          );
        }
      }
    }
    expect(seen, 'no GOPATH-path actionlint found — this guard passes on nothing').toBeGreaterThan(
      0,
    );
    expect(
      findings,
      'a job runs actionlint by absolute path with no pinned install before it',
    ).toEqual([]);
  });

  it('sees a gate consumer in every workflow that names the gate', () => {
    // Silent failure this prevents: the rules above — the install order,
    // the GITHUB_PATH echo — hold NOTHING when the guard sees no gate
    // consumer at all. A detection rule that stopped matching `npm run ci`
    // would leave every rule below it holding nothing and the whole file
    // green. The count is asserted per workflow: a workflow that NAMES
    // the gate must SHOW a consumer.
    //
    // The converse is NOT asserted: `GATE_COMMAND` is a subset of
    // `GATE_NAMED`, so a workflow that names the gate cannot fail to
    // match the narrower pattern in a way that makes the other side
    // mean anything — it would be a tautology, and a tautology that
    // reads like an assertion is worse than none.
    //
    // The first assertion is what keeps the per-workflow one from going
    // vacuous: if the pattern that RECOGNISES the gate ever stopped
    // matching, every workflow would be skipped and the count would
    // never be checked at all.
    const naming = workflowFiles.filter((workflow) => GATE_NAMED.test(workflow.text));
    expect(
      naming.length,
      'no workflow names the gate — the guard would hold nothing',
    ).toBeGreaterThan(0);
    for (const workflow of naming) {
      const consumers = workflow.jobs.reduce(
        (count, job) => count + gateConsumerSteps(job).length,
        0,
      );
      expect(consumers, `${workflow.file}: no gate consumer seen`).toBeGreaterThan(0);
    }
  });

  it('installs one identical actionlint version everywhere it is installed', () => {
    // Silent failure this prevents: ci.yml's quality job, ci.yml's
    // actionlint job and release.yml's ci job each install actionlint
    // themselves. If one drifts to another version, the legs lint with
    // different rule sets — a change green on one leg goes red on
    // another, surfacing as an unrelated-looking failure on whichever
    // leg moves last. There must be at least one occurrence, all
    // carrying the commit pinned in this file; zero occurrences would
    // make this guard pass on nothing.
    const installs: { file: string; commit: string }[] = [];
    for (const workflow of workflowFiles) {
      for (const job of workflow.jobs) {
        for (const step of job.steps) {
          for (const line of (step.run ?? '').split('\n')) {
            const found = /go install github\.com\/rhysd\/actionlint\/cmd\/actionlint@(\S+)/.exec(
              line,
            );
            if (found !== null) installs.push({ file: workflow.file, commit: found[1] ?? '' });
          }
        }
      }
    }
    expect(installs.length, 'no actionlint install found').toBeGreaterThan(0);
    for (const install of installs) {
      const message = `${install.file}: actionlint @${install.commit}`;
      // The pin is a COMMIT, not a tag: a retagged release would otherwise
      // run in CI with the runner's credentials.
      expect(install.commit, message).toBe(ACTIONLINT_COMMIT);
      expect(install.commit, message).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('names the actionlint release beside the pinned commit', () => {
    // The commit alone says nothing to a reader: the comment beside it
    // carries the version, the way the pinned actions carry theirs. The
    // comment is not part of the document the YAML parser sees, so this
    // check reads the raw text — a comment IS text.
    let pinned = 0;
    for (const workflow of workflowFiles) {
      for (const line of workflow.text.split('\n')) {
        if (!line.includes(`actionlint@${ACTIONLINT_COMMIT}`)) continue;
        pinned += 1;
        expect(
          line,
          `${workflow.file}: the pinned actionlint install must name its release`,
        ).toContain(`# ${ACTIONLINT_VERSION}`);
      }
    }
    expect(
      pinned,
      'no pinned actionlint install found — this guard passes on nothing',
    ).toBeGreaterThan(0);
  });

  it('names the pinned actionlint commit in AGENTS.md and CONTRIBUTING.md', () => {
    // The local gate and CI have to lint the same way, so the version the
    // docs tell a developer to install has to be the one the workflows
    // install. The workflows pin the COMMIT, so the docs name the commit
    // too: a retagged release would otherwise be what a developer
    // installs and what CI refuses to run — and the two would differ
    // silently, because both read as "v1.7.12".
    for (const file of ['AGENTS.md', 'CONTRIBUTING.md']) {
      const text = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
      expect(text, `${file} must name the actionlint commit the workflows install`).toContain(
        `actionlint@${ACTIONLINT_COMMIT}`,
      );
    }
  });

  it('names every required check in docs/SPEC.md', () => {
    // SPEC.md is the design authority, and it named THREE of the FOUR
    // checks branch protection requires — the same under-statement the
    // merge floor had in AGENTS.md. The list is the four, and this keeps
    // the specification in step with the merge floor it documents.
    const spec = readFileSync(fileURLToPath(new URL('../docs/SPEC.md', import.meta.url)), 'utf8');
    const line = spec
      .split('\n')
      .find((entry) => entry.includes('Branch protection on') && entry.includes('required checks'));
    expect(line, 'docs/SPEC.md must state the required checks').toBeDefined();
    // The LIST, not the sentence: `security` and `actionlint` are named
    // again in the parenthetical, and `docker` is named as NOT required.
    const after = (line ?? '').split('required checks ')[1] ?? '';
    const list = beforeParenthetical(after);
    const named = list
      .split(/, |\+ /)
      .map((part) => /`([^`]+)`/.exec(part)?.[1] ?? '')
      .filter((name) => name !== '')
      .sort();
    expect(named, 'docs/SPEC.md must name exactly the required checks').toEqual(
      [...REQUIRED_CHECKS].sort(),
    );
  });

  it('names every required check in AGENTS.md', () => {
    // AGENTS.md is the file an agent reads to decide which checks to wait
    // for. It named THREE of the FOUR checks branch protection requires,
    // and the guard that was supposed to keep the list in step repeated
    // the same three — so the two agreed with each other and disagreed
    // with the merge floor. The list is now the four, and this test keeps
    // the prose and the guard in step with each other.
    const agents = readFileSync(fileURLToPath(new URL('../AGENTS.md', import.meta.url)), 'utf8');
    const sentence = agents.split('\n').find((line) => line.includes('Required checks on'));
    expect(sentence, 'AGENTS.md must state the required checks').toBeDefined();
    // The LIST, not the file: a check named anywhere else in AGENTS.md
    // would satisfy a "does the file mention it" test even when the list
    // itself still names only three of the four.
    const listed = sentence?.split('Required checks on `main` are ')[1]?.split(';')[0] ?? '';
    const named = [...listed.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '').sort();
    expect(named, 'AGENTS.md must name exactly the required checks').toEqual(
      [...REQUIRED_CHECKS].sort(),
    );
  });

  it('still produces every check branch protection requires', () => {
    // The matrix legs become the check names, so the matrix has to contain
    // the versions branch protection names — and every other job's name is
    // a check name too, so the ones that are not required are checked
    // against the same list.
    const quality = jobOf(ci, 'quality');
    expect(quality, 'ci.yml has no `quality` job').toBeDefined();
    const security = jobOf(ci, 'security');
    expect(security?.name, 'ci.yml has no `security` job').toBe('security');
    const produced = new Set<string>();
    for (const node of pullRequestNodes(quality?.matrix)) produced.add(`quality (${node})`);
    for (const job of ci.jobs) {
      // A job whose name is an EXPRESSION reports under the expanded name,
      // which is the matrix's business, not this check's.
      if (job.key === 'quality' || job.name.includes('{{')) continue;
      produced.add(job.name);
    }
    for (const required of REQUIRED_CHECKS) {
      expect(produced, `required check "${required}" would never report`).toContain(required);
    }
  });

  it('narrows the push-to-main run — an intensity knob, not a correctness invariant', () => {
    // A squash merge keeps the tree byte-identical to the pull_request head
    // (verified on PRs #128, #130, #131, #132), so a push to `main` need
    // not repeat both legs and the container build the pull request
    // already ran. The condition lives in the matrix because a job-level
    // `if` cannot read `matrix` — doing that invalidates the workflow.
    const quality = jobOf(ci, 'quality');
    expect(matrixExpression(quality?.matrix)).toMatch(
      /^\$\{\{ github\.event_name == 'pull_request' && fromJSON\('\[22, 24\]'\) \|\| fromJSON\('\[22\]'\) \}\}$/,
    );
    const arms = matrixArms(quality?.matrix);
    expect(arms[0], 'a pull_request run must keep both legs').toEqual(['22', '24']);
    expect(arms[1], 'a push to main runs the floor version only').toEqual(['22']);
  });
});

describe('the workflow files — what the merge gate runs', () => {
  it('pins every action to a full commit SHA', () => {
    // Silent failure this prevents: a tag reference (`actions/checkout@v4`)
    // runs whatever the upstream repository points at that day. The
    // workflow still reads the same and the run is still green, so the
    // unpinned step stays invisible until the upstream moves. The version
    // belongs in a COMMENT beside the pin, where a reader can see it.
    let pinned = 0;
    for (const workflow of workflowFiles) {
      for (const job of workflow.jobs) {
        for (const step of job.steps) {
          if (step.uses === undefined) continue;
          pinned += 1;
          expect(
            PINNED_ACTION.test(step.uses),
            `${workflow.file}: job \`${job.key}\`: action not pinned to a full 40-hex commit SHA — ${step.uses}`,
          ).toBe(true);
        }
      }
    }
    expect(pinned, 'no `uses:` step found — this guard passes on nothing').toBeGreaterThan(0);
  });

  it('references only allowlisted action repositories', () => {
    // Silent failure this prevents: a SHA pin says the COMMIT is fixed,
    // not that the repository is an action at all — the semgrep job that
    // referenced the CLI's repository as if it were an action reported
    // green while scanning nothing. The allowlist catches that offline.
    const findings: string[] = [];
    let referenced = 0;
    for (const workflow of workflowFiles) {
      for (const job of workflow.jobs) {
        for (const step of job.steps) {
          if (step.uses === undefined) continue;
          referenced += 1;
          const repository = actionRepository(step.uses);
          if (!ALLOWED_ACTIONS.has(repository)) {
            findings.push(
              `${workflow.file}: job \`${job.key}\`: \`${step.uses}\` is not an allowlisted action repository`,
            );
          }
        }
      }
    }
    expect(referenced, 'no `uses:` step found — this guard passes on nothing').toBeGreaterThan(0);
    expect(findings, 'a workflow references an action repository outside the allowlist').toEqual(
      [],
    );
  });

  it('pins every container image by digest', () => {
    // Silent failure this prevents: a container image pinned by TAG
    // (`semgrep/semgrep:1.183.0`) moves under the pin exactly the way an
    // action tag does — the image behind the tag can be replaced, and the
    // version in the comment is then a claim about a moment rather than
    // about the image. The digest names the image.
    const findings: string[] = [];
    let images = 0;
    for (const workflow of workflowFiles) {
      for (const job of workflow.jobs) {
        if (job.image === undefined) continue;
        images += 1;
        if (!DIGEST_PINNED_IMAGE.test(job.image)) {
          findings.push(
            `${workflow.file}: job \`${job.key}\`: container image not pinned by digest — ${job.image}`,
          );
        }
      }
    }
    expect(images, 'no container image found — this guard passes on nothing').toBeGreaterThan(0);
    expect(findings, 'a container image is not pinned by digest').toEqual([]);
  });

  it('checks out the full history the gates read', () => {
    // Silent failure this prevents: `actions/checkout` clones with
    // `--depth 1` and fetches NO tags by default, so `git tag` returns
    // nothing and the release guard (test/install-paths.test.ts) asserts
    // nothing at all. It stayed green in CI for exactly that reason
    // (measured 2026-10-29: a depth-1 clone of the public repository
    // reports zero tags, so the guard's loop never ran). The jobs that
    // run the gate must therefore check out the full history and its tags.
    //
    // The `security` job is here for the same reason and a second one:
    // gitleaks scans COMMITS, so a shallow checkout leaves every commit
    // before the tip unscanned — and the job still reports green.
    //
    // The gate jobs are DERIVED from the workflows, not named: the jobs
    // whose run values invoke a gate command are read out of the files
    // themselves, so a gate job added later — one that checks out shallow
    // — fails HERE instead of leaving the release guard vacuous in that
    // job. Naming the two jobs the workflows happen to have today would
    // guard those two and nothing else.
    const gateJobs = [
      ...workflowFiles.flatMap((workflow) =>
        workflow.jobs
          .filter((job) => gateConsumerSteps(job).length > 0)
          .map((job) => ({ file: workflow.file, job: job.key })),
      ),
      { file: 'ci.yml', job: 'security' },
    ];
    let checked = 0;
    for (const { file, job } of gateJobs) {
      const workflow = loadWorkflow(file);
      const found = jobOf(workflow, job);
      expect(found, `${file}: no \`${job}\` job`).toBeDefined();
      const checkout = (found?.steps ?? []).find((step) =>
        step.uses?.startsWith('actions/checkout'),
      );
      expect(checkout, `${file}: job \`${job}\` has no checkout step`).toBeDefined();
      expect(
        resolveFetchDepth(String(checkout?.with['fetch-depth'] ?? '')),
        `${file}: job \`${job}\` must check out the full history`,
      ).toBe('0');
      checked += 1;
    }
    // The guard passes on nothing if the parser saw no gate job at all:
    // a change that hides every run value would leave the loop empty
    // and this test green.
    expect(
      checked,
      'no gate job found in any workflow — this guard passes on nothing',
    ).toBeGreaterThan(0);
  });

  it('reads a fetch-depth value that carries a trailing comment', () => {
    // The value may carry a trailing comment (`fetch-depth: 0 # why`) — YAML
    // reads the comment as a comment, so it is stripped before the value is
    // read; without that, a job whose depth is right is reported as
    // wrong. Until now the strip was pinned only INDIRECTLY, by the one
    // comment in release.yml; neutralise that comment and the strip could
    // be removed with the suite still green. This pins it DIRECTLY.
    const withComment = [
      'jobs:',
      '  quality:',
      '    steps:',
      '      - name: Check out',
      '        uses: actions/checkout@abc123',
      '        with:',
      '          fetch-depth: 0 # the tags the release guard reads',
      '      - uses: actions/setup-node@def456',
    ].join('\n');
    const workflow = parseWorkflow(withComment, 'literal.yml');
    const checkout = workflow.jobs[0]?.steps.find((step) =>
      step.uses?.startsWith('actions/checkout'),
    );
    expect(checkout, 'the literal workflow has no checkout step').toBeDefined();
    expect(
      String(checkout?.with['fetch-depth'] ?? ''),
      'a fetch-depth value with a trailing comment must read as the value',
    ).toBe('0');
  });

  it('runs the release guard in EVERY job that publishes a tarball', () => {
    // The npm job is disabled today — its trusted-publishing variable does
    // not exist — so the tarball people actually download is made by the
    // GitHub release job. A guard in the disabled job guards nothing.
    for (const key of ['github-release', 'publish-npm']) {
      const job = jobOf(release, key);
      expect(job, `release.yml has no \`${key}\` job`).toBeDefined();
      const runs = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');
      expect(runs, `release.yml: job \`${key}\` does not verify the packed tarball`).toContain(
        'verify-packed.mjs',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The derived gate set — the spellings that reach the release guard.
// ---------------------------------------------------------------------------

/**
 * How a job is recognised as a GATE job — the spellings that run the
 * release guard without naming an npm script, and the checkout depth a
 * gate job is read as asking for.
 */
describe('the derived gate set — the spellings that reach the release guard', () => {
  /** The jobs of a synthetic workflow that run the gate. */
  function gateJobs(run: string): string[] {
    const workflow = parseWorkflow(
      ['jobs:', '  gate:', '    steps:', `      - run: ${run}`].join('\n'),
      'literal.yml',
    );
    return workflow.jobs.filter((job) => gateConsumerSteps(job).length > 0).map((job) => job.key);
  }

  it('reads every spelling that reaches the release guard as a gate job', () => {
    // The classification, pinned on the matcher itself. Every spelling
    // below RUNS the release guard: a filter that names it, a filter SET
    // that names it among others, a directory, a glob, a test-name
    // pattern, and the `--run` spelling without the `run` subcommand. A
    // job that uses one of them runs the guard, so it must carry the tags
    // a shallow checkout does not have.
    const gate = [
      'npx vitest run',
      'npx vitest --run',
      'npx vitest run test/install-paths.test.ts',
      'npx vitest run test/live.test.ts test/install-paths.test.ts',
      'npx vitest run test/',
      'npx vitest run test',
      'npx vitest run test/**',
      'npx vitest run **/*.test.ts',
      'npx vitest run -t "release guard"',
      'npx vitest run --exclude test/live.test.ts',
    ];
    for (const run of gate) {
      expect(runsReleaseGuardSuite(run), `${run} must be read as a gate run`).toBe(true);
      expect(gateJobs(run), `${run} must make the job a gate job`).toEqual(['gate']);
    }

    // The CONTROL: a run filtered to another file runs that file only, so
    // it does not reach the release guard and is not a gate job. This is
    // the spelling `live-e2e.yml` uses, and it must not be forced to
    // carry the tags.
    // The same suite, run through yarn's spelling of the `test` script:
    // a SCRIPT invocation rather than a vitest one, so it is read by the
    // derived script set instead of the matcher — and it is a gate job.
    expect(gateJobs('yarn test')).toEqual(['gate']);

    const control = 'npx vitest run test/live.test.ts';
    expect(runsReleaseGuardSuite(control), `${control} must not be read as a gate run`).toBe(false);
    expect(gateJobs(control)).toEqual([]);
  });

  it('reads a fetch-depth written as a literal expression', () => {
    // GitHub evaluates `${{ … }}` before the action reads the input, so
    // `fetch-depth: ${{ 0 }}` asks for depth 0 exactly as `fetch-depth: 0`
    // does. Reading the raw text failed a workflow that is correct — the
    // guard was expression-blind in the unsafe direction, rejecting a
    // legitimate spelling instead of reading it.
    const expression = [
      'jobs:',
      '  quality:',
      '    steps:',
      '      - name: Check out',
      '        uses: actions/checkout@abc123',
      '        with:',
      '          fetch-depth: ${{ 0 }}',
    ].join('\n');
    const workflow = parseWorkflow(expression, 'literal.yml');
    const checkout = workflow.jobs[0]?.steps.find((step) =>
      step.uses?.startsWith('actions/checkout'),
    );
    expect(checkout, 'the literal workflow has no checkout step').toBeDefined();
    expect(
      resolveFetchDepth(String(checkout?.with['fetch-depth'] ?? '')),
      'a fetch-depth written as a literal expression must read as the value',
    ).toBe('0');

    // An expression that names something else cannot be read out of the
    // workflow text, so it is returned as written — the guard says what
    // it can and cannot read rather than guessing.
    expect(resolveFetchDepth('${{ inputs.depth }}')).toBe('${{ inputs.depth }}');
  });
});
