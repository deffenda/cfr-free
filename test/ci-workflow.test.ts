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
 *  - the pinned actionlint install is in an EARLIER STEP than the gate
 *    that shells out to it, and GOPATH's bin dir is on PATH for the steps
 *    that follow — `GITHUB_PATH` applies to later steps only, so a fold
 *    that puts them in one step dies with `actionlint: command not found`
 *    however it is ordered inside it;
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
  }));
  return { file, text, jobs };
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
const GATE_COMMAND = /(?:^|[\s;&|(`'"])npm run\s+(?:ci|lint:actions)(?![\w:.-])/;

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
    expect(refs, 'the semgrep job does not run semgrep').toContain('semgrep/semgrep');
    // The same scan the local sweep runs: the tree for dependencies,
    // secrets and misconfiguration.
    const with_ = trivy?.steps.find((step) => step.uses?.includes('trivy-action'));
    expect(String(with_?.with['scan-type'] ?? ''), 'the trivy job must scan the tree').toBe('fs');
    expect(
      String(with_?.with['severity'] ?? ''),
      'the trivy job must scan the same severities',
    ).toBe('HIGH,CRITICAL');
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
