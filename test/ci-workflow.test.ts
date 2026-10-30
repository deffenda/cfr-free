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
 * rather than of the workflow it guards.
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
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const WORKFLOWS_DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const SECURITY_SCAN_PATH = fileURLToPath(new URL('../tools/security-scan.sh', import.meta.url));

// ---------------------------------------------------------------------------
// The workflows, parsed.
// ---------------------------------------------------------------------------

/** One step of a job, as the document declares it. */
interface Step {
  /** The step's name, or its action, or its position — for a failure message. */
  readonly label: string;
  /** The action the step runs, when it runs one. */
  readonly uses: string | undefined;
  /** The command the step runs, when it runs one. */
  readonly run: string | undefined;
  /** The step's inputs. */
  readonly with: Record<string, unknown>;
}

/** One job, as the document declares it. */
interface Job {
  /** The mapping key the job is written under. */
  readonly key: string;
  /** The job's display name — the name a check reports under. */
  readonly name: string;
  readonly steps: readonly Step[];
  /** The job's matrix, when it has one. */
  readonly matrix: Record<string, unknown> | undefined;
  /** The container image the job runs in, when it names one. */
  readonly image: string | undefined;
  /** The runner label the job runs on — a label, or a list of them. */
  readonly runsOn: string | undefined;
}

/** One workflow file, parsed. */
interface Workflow {
  readonly file: string;
  /** The raw text — for the few checks that read a COMMENT. */
  readonly text: string;
  readonly jobs: readonly Job[];
}

interface RawStep {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

interface RawJob {
  readonly name?: string;
  readonly steps?: readonly RawStep[];
  readonly strategy?: { readonly matrix?: Record<string, unknown> };
  readonly container?: string | { readonly image?: string };
  readonly 'runs-on'?: string | readonly string[];
}

/**
 * The image a job's `container:` names — a bare string, or a mapping
 * with an `image:` key. Undefined when the job names no container.
 *
 * The container is a JOB-level key: GitHub's workflow schema has no
 * step-level `container`, so a step cannot name an image of its own.
 */
function containerImage(container: RawJob['container']): string | undefined {
  if (typeof container === 'string') return container;
  return container?.image;
}

/** Parse one workflow file into its jobs and steps. */
function loadWorkflow(file: string): Workflow {
  const text = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
  const parsed = parseYaml(text) as { readonly jobs?: Record<string, RawJob> };
  const jobs = Object.entries(parsed.jobs ?? {}).map(([key, job]) => ({
    key,
    name: job.name ?? key,
    steps: (job.steps ?? []).map((step, index) => ({
      label: step.name ?? step.uses ?? `step ${index + 1}`,
      uses: step.uses,
      run: step.run,
      with: step.with ?? {},
    })),
    matrix: job.strategy?.matrix,
    image: containerImage(job.container),
    runsOn: runnerLabel(job['runs-on']),
  }));
  return { file, text, jobs };
}

/**
 * The runner a job runs on, as text: a label, or the labels of a list.
 *
 * `runs-on` takes either a single label or a list of them, and a label
 * that says `arm` says the job runs on an arm64 runner — which is what
 * the semgrep job must not do.
 */
function runnerLabel(runsOn: RawJob['runs-on']): string | undefined {
  if (runsOn === undefined) return undefined;
  return Array.isArray(runsOn) ? runsOn.join(' ') : runsOn;
}

/** Every workflow file, in a stable order. */
const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map((name) => loadWorkflow(name));

const ci = loadWorkflow('ci.yml');
const release = loadWorkflow('release.yml');

const manifest = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
  scripts: Record<string, string>;
};

/** The job of a workflow, by its mapping key. */
function jobOf(workflow: Workflow, key: string): Job | undefined {
  return workflow.jobs.find((job) => job.key === key);
}

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
 * The semgrep invocation CI and the local sweep both run, exactly.
 *
 * The two sides agreeing is not enough: a change that narrowed BOTH of
 * them — adding `--exclude '**'`, or dropping the rule set — would
 * agree perfectly and scan nothing. So the invocation is pinned here, to
 * the one that is known to scan: `--config auto` reads a real rule set,
 * `--error` turns a finding into a failure, and nothing excludes the
 * tree the scan reads.
 *
 * The local sweep is `tools/security-scan.sh`'s own semgrep line; CI's is
 * the `semgrep` job's `run:`. Both are compared against this.
 */
const SEMGREP_INVOCATION = 'scan --config auto --error --quiet';

/**
 * The semgrep image CI runs, pinned by digest.
 *
 * The digest names the image; the version in the comment beside the pin
 * is a claim about a moment. Pinning the digest HERE as well means the
 * image the comment names and the image CI pulls cannot drift apart
 * silently: a repin that leaves the comment behind fails here, and a
 * repin that changes the comment fails there.
 */
const SEMGREP_IMAGE_DIGEST =
  'sha256:2e45517a85e13a9cca14a2a00df6bb48affd66b8ebfae1b0991cd57578362fb0';

/** The release the pinned digest is: named in the comment beside the pin. */
const SEMGREP_IMAGE_VERSION = '1.183.0';

/**
 * The scanner jobs, and the step in each that does the scanning.
 *
 * The checkout matters as much as the scan: a scanner job with no
 * checkout scans an EMPTY workspace, finds nothing and exits 0 — the
 * "reported green over a scan that never happened" failure this branch
 * exists to remove (ci.yml:164-165).
 */
const SCANNER_JOBS = [
  {
    job: 'trivy',
    /** The step that runs the scanner. */
    scan: (step: Step): boolean => step.uses?.includes('trivy-action') ?? false,
  },
  {
    job: 'semgrep',
    /** The step that runs the scanner. */
    scan: (step: Step): boolean => (step.run ?? '').includes('semgrep scan'),
  },
] as const;

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
const GATE_COMMAND = /(?:^|[\s;&|(`'"])npm run\s+(?:ci|lint:actions)(?![\w:.-])/;

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

/** The steps of a job that run the shared gate. */
function gateConsumerSteps(job: Job): number[] {
  const found: number[] = [];
  job.steps.forEach((step, index) => {
    if (GATE_COMMAND.test(step.run ?? '')) found.push(index);
  });
  return found;
}

/** The command a step runs, trimmed, or the empty string. */
function runOf(step: Step | undefined): string {
  return step?.run?.trim() ?? '';
}

/**
 * The semgrep invocation the local sweep runs, as text: the arguments
 * after `semgrep` on the sweep's own semgrep line.
 */
function localSemgrepScan(): string {
  const script = readFileSync(SECURITY_SCAN_PATH, 'utf8');
  return /semgrep (scan --config[^\n]*)/.exec(script)?.[1]?.trim() ?? '';
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
    const findings: string[] = [];
    for (const workflow of workflowFiles) {
      for (const job of workflow.jobs) {
        const consumers = job.steps
          .map((step, index) => ({ step, index }))
          .filter(({ step }) => GATE_COMMAND.test(step.run ?? ''));
        const consumer = consumers[0];
        if (consumer === undefined) continue;
        const where = `${workflow.file}: job \`${job.key}\``;
        const installs = installSteps(job).filter((index) => index < consumer.index);
        if (installs.length === 0) {
          findings.push(`${where}: runs the gate with no pinned actionlint install before it`);
        }
        // The gate shells out to a BARE `actionlint`, which the runner does
        // not ship: GOPATH's bin dir must be on PATH for the later steps.
        // An actionlint run by absolute path needs no PATH at all.
        const byPath = job.steps.some((step) => ACTIONLINT_BY_PATH.test(step.run ?? ''));
        if (!byPath && pathEchoSteps(job).filter((index) => index < consumer.index).length === 0) {
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

  it('keeps gitleaks and osv-scanner in the security job', () => {
    // Silent failure this prevents: the `security` job losing one of its
    // scanners. The check still reports, still passes, and branch
    // protection still sees a green `security` — while secrets or
    // dependency advisories go unscanned.
    const security = jobOf(ci, 'security');
    expect(security, 'ci.yml has no `security` job').toBeDefined();
    const steps = (security?.steps ?? []).map((step) => step.uses ?? '');
    expect(steps.join('\n'), 'the security job no longer runs gitleaks').toContain(
      'gitleaks/gitleaks-action',
    );
    expect(steps.join('\n'), 'the security job no longer runs osv-scanner').toContain(
      'google/osv-scanner-action',
    );
  });

  it('runs trivy and semgrep in CI', () => {
    // The finding was that a container or SAST problem surfaced only on a
    // developer machine that happened to have the scanners installed: CI
    // ran three of the five scanners the local sweep runs, and the other
    // two existed nowhere but the local path.
    //
    // Neither job is a REQUIRED check, and that is deliberate: the
    // vulnerability database trivy reads and the rule registry semgrep's
    // `auto` config reads both move without this repository changing, so a
    // merge floor that depends on either can move under it. They run on
    // every pull request, so a finding is VISIBLE — promoting them to
    // required is the operator's call, and it changes the merge floor.
    const trivy = jobOf(ci, 'trivy');
    const semgrepJob = jobOf(ci, 'semgrep');
    expect(trivy, 'ci.yml has no `trivy` job').toBeDefined();
    expect(semgrepJob, 'ci.yml has no `semgrep` job').toBeDefined();
    const refs = [...(trivy?.steps ?? []), ...(semgrepJob?.steps ?? [])]
      .map((step) => step.uses ?? '')
      .join('\n');
    expect(refs, 'the trivy job does not run trivy').toContain('aquasecurity/trivy-action');
    // The semgrep job runs the scanner from the PUBLISHED CONTAINER
    // IMAGE, pinned by digest — not from an action reference to the
    // CLI's repository, which publishes no action manifest (the allowlist
    // guard above is what keeps that out).
    expect(semgrepJob?.image ?? '', 'the semgrep job does not run the semgrep image').toContain(
      'semgrep/semgrep',
    );
    const semgrepStep = (semgrepJob?.steps ?? []).find((step) =>
      (step.run ?? '').includes('semgrep scan'),
    );
    expect(semgrepStep, 'the semgrep job does not run a semgrep scan').toBeDefined();
    // The same scan the local sweep runs: the tree for dependencies,
    // secrets and misconfiguration.
    const with_ = trivy?.steps.find((step) => step.uses?.includes('trivy-action'));
    expect(String(with_?.with['scan-type'] ?? ''), 'the trivy job must scan the tree').toBe('fs');
    expect(
      String(with_?.with['severity'] ?? ''),
      'the trivy job must scan the same severities',
    ).toBe('HIGH,CRITICAL');
  });

  it('checks out the code each scanner job scans', () => {
    // Silent failure this prevents: a scanner job with NO checkout scans
    // an empty workspace, finds nothing and exits 0 — the "reported green
    // over a scan that never happened" failure this branch exists to
    // remove (ci.yml:164-165). The checkout has to come BEFORE the scan
    // as well: a scan step above the checkout reads the workspace before
    // the code is in it, and reports the same clean result.
    for (const { job, scan } of SCANNER_JOBS) {
      const found = jobOf(ci, job);
      expect(found, `ci.yml has no \`${job}\` job`).toBeDefined();
      const steps = found?.steps ?? [];
      const scanIndex = steps.findIndex(scan);
      expect(scanIndex, `ci.yml: job \`${job}\` does not run its scanner`).toBeGreaterThanOrEqual(
        0,
      );
      const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith('actions/checkout'));
      expect(
        checkoutIndex,
        `ci.yml: job \`${job}\` has no checkout step — it would scan an empty workspace`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        checkoutIndex,
        `ci.yml: job \`${job}\` must check out the code before it scans it`,
      ).toBeLessThan(scanIndex);
    }
  });

  it('scans with semgrep for real, in CI and in the local sweep', () => {
    // The guard used to pin that CI and the local sweep AGREE, and to pin
    // neither side's arguments: adding `--exclude '**'` to BOTH, or
    // narrowing both to `--severity ERROR`, left the whole suite green.
    // Two scanners that agree on scanning nothing agree perfectly. The
    // invocation is pinned to the one known to scan.
    const localScan = localSemgrepScan();
    expect(localScan, 'tools/security-scan.sh no longer runs a semgrep scan').not.toBe('');
    expect(localScan, 'the local sweep must run the pinned semgrep invocation').toBe(
      SEMGREP_INVOCATION,
    );
    const semgrepStep = (jobOf(ci, 'semgrep')?.steps ?? []).find((step) =>
      (step.run ?? '').includes('semgrep scan'),
    );
    expect(runOf(semgrepStep), 'the CI semgrep scan must be the pinned semgrep invocation').toBe(
      `semgrep ${SEMGREP_INVOCATION}`,
    );
    // The pin itself, so it cannot be weakened from here either:
    // `--config auto` reads a real rule set, `--error` turns a finding
    // into a failure, and nothing excludes the tree the scan reads.
    expect(SEMGREP_INVOCATION, 'the pinned invocation must read a rule set').toContain(
      '--config auto',
    );
    expect(SEMGREP_INVOCATION, 'the pinned invocation must fail on a finding').toContain('--error');
    expect(
      SEMGREP_INVOCATION,
      'the pinned invocation must not exclude the tree it scans',
    ).not.toMatch(/--exclude(?:-rule)?\b/);
  });

  it('pins the semgrep image to the digest the comment names', () => {
    // A digest pin says WHICH image; the comment beside it says which
    // RELEASE. They are separate claims, and a repin that leaves the
    // comment behind turns the comment into a claim about a moment — or
    // about a different image entirely. Both are pinned here.
    const semgrepJob = jobOf(ci, 'semgrep');
    expect(semgrepJob?.image ?? '', 'the semgrep job must run the pinned semgrep image').toBe(
      `semgrep/semgrep@${SEMGREP_IMAGE_DIGEST}`,
    );
    const line = ci.text.split('\n').find((entry) => entry.includes(SEMGREP_IMAGE_DIGEST));
    expect(line, 'the pinned semgrep digest must appear in ci.yml').toBeDefined();
    expect(
      line,
      'the pinned semgrep digest must name its release in the comment beside it',
    ).toContain(`# ${SEMGREP_IMAGE_VERSION}`);
  });

  it('keeps the semgrep job on an x64 runner', () => {
    // The semgrep job runs in the published container image, which is
    // Alpine, and GitHub's runner supports JavaScript actions in an
    // Alpine container only on an x64 runner: an arm64 label fails the
    // job at runtime with NotSupportedException — after the checkout, so
    // the failure would name the runner rather than the scan.
    const semgrepJob = jobOf(ci, 'semgrep');
    expect(semgrepJob, 'ci.yml has no `semgrep` job').toBeDefined();
    expect(semgrepJob?.runsOn, 'the semgrep job must name its runner').toBeDefined();
    expect(semgrepJob?.runsOn ?? '', 'the semgrep job must run on an x64 runner').not.toMatch(
      /arm/i,
    );
  });

  it('checks out the tags the release guard reads', () => {
    // Silent failure this prevents: `actions/checkout` clones with
    // `--depth 1` and fetches NO tags by default, so `git tag` returns
    // nothing and the release guard (test/install-paths.test.ts) asserts
    // nothing at all. It stayed green in CI for exactly that reason
    // (measured 2026-10-29: a depth-1 clone of the public repository
    // reports zero tags, so the guard's loop never ran). The jobs that
    // run the gate must therefore check out the full history and its tags.
    const gateJobs = [
      { file: 'ci.yml', job: 'quality' },
      { file: 'release.yml', job: 'ci' },
    ];
    for (const { file, job } of gateJobs) {
      const workflow = loadWorkflow(file);
      const found = jobOf(workflow, job);
      expect(found, `${file}: no \`${job}\` job`).toBeDefined();
      const checkout = (found?.steps ?? []).find((step) =>
        step.uses?.startsWith('actions/checkout'),
      );
      expect(checkout, `${file}: job \`${job}\` has no checkout step`).toBeDefined();
      expect(
        String(checkout?.with['fetch-depth'] ?? ''),
        `${file}: job \`${job}\` must check out the full history and its tags`,
      ).toBe('0');
    }
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
