/**
 * The CI scanning jobs.
 *
 * CI runs five scanners: npm audit, gitleaks and osv-scanner in the
 * `quality` and `security` jobs, and trivy and semgrep in jobs of
 * their own. The finding behind those jobs was that a container or a
 * static-analysis problem surfaced only on a developer machine that
 * happened to have the scanners installed; the finding behind these
 * guards is that a scanner job can report GREEN over a scan that never
 * happened.
 *
 * That is what these guards are for, and each one names the failure it
 * prevents:
 *
 *  - a scanner job with NO checkout scans an empty workspace, finds
 *    nothing and exits 0 (ci.yml:164-165);
 *  - two scanners that AGREE can agree on scanning nothing, so the
 *    invocation is pinned, not merely compared;
 *  - a scanner that scans for nothing at all — the scanner SET is
 *    pinned on both sides, and so is the exit code that turns a finding
 *    into a failure;
 *  - a job whose `if:` switches the whole scan off;
 *  - a local sweep that stopped failing;
 *  - a digest pin says WHICH image; the comment beside it says which
 *    RELEASE, and the two can drift apart;
 *  - the semgrep job runs in an Alpine container, which the runner
 *    supports only on an x64 runner;
 *  - the image the docker job builds is the image CR-35's fix asks for,
 *    and nothing scanned it.
 *
 * The gate itself — the steps, the pins, the allowlist — is guarded in
 * `ci-workflow.test.ts`. This file is the scanning jobs, as their own
 * unit, so that a change to CI's scanning surface reads as one.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ci, jobOf, type Step } from './workflows.js';

const SECURITY_SCAN_PATH = fileURLToPath(new URL('../tools/security-scan.sh', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

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
 * The trivy invocation the local sweep runs, as one line of arguments.
 *
 * The script writes it across several lines with a trailing backslash, so
 * the continuation lines are joined before the arguments are read. The
 * lines are walked rather than matched: a regular expression over them
 * would nest a quantifier inside a quantifier, and the lint refuses one.
 */
function localTrivyScan(): string {
  const lines = readFileSync(SECURITY_SCAN_PATH, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.includes('trivy fs'));
  if (start < 0) return '';
  const parts: string[] = [];
  for (const line of lines.slice(start)) {
    parts.push(line.replace(/\\\s*$/, ''));
    if (!line.trimEnd().endsWith('\\')) break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** The trivy step that scans the working tree, or undefined. */
function trivyFsStep(): Step | undefined {
  return (jobOf(ci, 'trivy')?.steps ?? []).find(
    (step) => step.uses?.includes('trivy-action') === true && step.with['scan-type'] === 'fs',
  );
}

/**
 * The scanners CI runs, and the job each runs in, as the WORKFLOW says.
 *
 * The sweep's header states the same mapping; the guard compares the two,
 * so the header cannot drift into prose that names the wrong job.
 */
function scannerJobs(): Record<string, string> {
  const jobRunning = (matches: (step: Step) => boolean): string =>
    ci.jobs.find((job) => job.steps.some(matches))?.key ?? '(no job runs it)';
  return {
    'npm audit': jobRunning((step) => (step.run ?? '').includes('scan:audit')),
    gitleaks: jobRunning((step) => (step.uses ?? '').includes('gitleaks/gitleaks-action')),
    'osv-scanner': jobRunning((step) => (step.uses ?? '').includes('osv-scanner-action')),
    'trivy (fs)': jobRunning(
      (step) => step.uses?.includes('trivy-action') === true && step.with['scan-type'] === 'fs',
    ),
    'trivy (image)': jobRunning(
      (step) => step.uses?.includes('trivy-action') === true && step.with['scan-type'] === 'image',
    ),
    semgrep: jobRunning((step) => (step.run ?? '').includes('semgrep scan')),
  };
}

/**
 * The mapping the sweep's header states, as its `scanner -> job` lines.
 */
function headerJobs(): Record<string, string> {
  const header = readFileSync(SECURITY_SCAN_PATH, 'utf8').split('# Usage:')[0] ?? '';
  const entries: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const match = /^\s*#\s*(.+?)\s*->\s*(\S+)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) entries[match[1]] = match[2];
  }
  return entries;
}

/**
 * The local sweep, run with STUB scanners on PATH.
 *
 * Each stub is a shell script that exits with the given code, so the
 * sweep exercises its own accounting — the FAIL line, the failure count
 * and the exit code — without a network, a real scanner or a real
 * `npm audit`. The `curl` stub answers the reachability probes, so the
 * network-scanner branches run too and nothing reaches the network.
 */
function runLocalSweep(exitCodes: Record<string, number>): {
  status: number | null;
  stdout: string;
} {
  const stubDir = mkdtempSync(join(tmpdir(), 'cfr-scan-'));
  try {
    const codes = {
      npm: 0,
      gitleaks: 0,
      'osv-scanner': 0,
      trivy: 0,
      semgrep: 0,
      curl: 0,
      ...exitCodes,
    };
    for (const [name, code] of Object.entries(codes)) {
      writeFileSync(join(stubDir, name), `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 });
    }
    const result = spawnSync('bash', [SECURITY_SCAN_PATH], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${stubDir}:${process.env['PATH'] ?? ''}` },
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout };
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
}

describe('the CI scanning jobs', () => {
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

  it('scans with trivy for real, in CI and in the local sweep', () => {
    // The same hole the semgrep guard closes, one scanner over: a scanner
    // set that BOTH sides narrow together — to `vuln` alone — agrees
    // perfectly and scans nothing but dependencies. The secret and the
    // Dockerfile-misconfiguration coverage is the whole point of the
    // container half of CR-35, so the set is pinned on both sides.
    //
    // The exit code is pinned with it: `exit-code: '0'` (or `--exit-code
    // 0`) reports green over a HIGH finding, which is the "reported green
    // over a scan that never happened" failure this branch exists to
    // remove.
    const local = localTrivyScan();
    expect(local, 'tools/security-scan.sh no longer runs a trivy scan').not.toBe('');
    expect(local, 'the local sweep must scan for secrets and misconfiguration too').toContain(
      '--scanners vuln,secret,misconfig',
    );
    expect(local, 'the local sweep must fail on a finding').toContain('--exit-code 1');
    const step = trivyFsStep();
    expect(
      String(step?.with['scanners'] ?? ''),
      'the trivy job must scan for secrets and misconfiguration too',
    ).toBe('vuln,secret,misconfig');
    expect(String(step?.with['exit-code'] ?? ''), 'the trivy job must fail on a finding').toBe('1');
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
    // The properties the pin has to keep — checked against the FILES, not
    // against the constant: a change that narrowed both sides together
    // (the constant, ci.yml and the sweep) would otherwise agree
    // perfectly and scan nothing. `--config auto` reads a real rule set,
    // `--error` turns a finding into a failure, and nothing excludes the
    // tree the scan reads.
    for (const [label, invocation] of [
      ['the local sweep', localScan],
      ['the CI semgrep scan', runOf(semgrepStep)],
    ]) {
      expect(invocation, `${label} must read a rule set`).toContain('--config auto');
      expect(invocation, `${label} must fail on a finding`).toContain('--error');
      expect(invocation, `${label} must not exclude the tree it scans`).not.toMatch(
        /--exclude(?:-rule)?\b/,
      );
    }
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

  it('scans the built image in the docker job', () => {
    // CR-35's prescribed fix covers "the filesystem and the built image".
    // The filesystem half is the `trivy` job; the image half is here,
    // because the docker job is the only one that has the image.
    //
    // The scan reads the base image's OS packages (`vuln-type: os`), and
    // the reason is measured rather than assumed: the runtime image
    // carries `package.json` but NOT `package-lock.json`, so a
    // whole-image scan resolves the manifest's devDependencies against
    // the registry and reports them as shipped. On the image built from
    // this tree that is ten HIGH findings, none of them in the image
    // (measured 2026-10-30). The image's Node layer is covered by the
    // committed lockfile instead — `npm audit` and the `trivy` job's
    // filesystem scan both read it — and the Dockerfile by the `misconfig`
    // scanner.
    const docker = jobOf(ci, 'docker');
    expect(docker, 'ci.yml has no `docker` job').toBeDefined();
    const steps = docker?.steps ?? [];
    const scanIndex = steps.findIndex((step) => step.uses?.includes('trivy-action'));
    expect(scanIndex, 'the docker job does not scan the image it builds').toBeGreaterThanOrEqual(0);
    const scan = steps[scanIndex];
    expect(String(scan?.with['scan-type'] ?? ''), 'the docker job must scan the image').toBe(
      'image',
    );
    expect(
      String(scan?.with['image-ref'] ?? ''),
      'the docker job must scan the image it builds',
    ).toBe('cfr-free:ci');
    expect(
      String(scan?.with['vuln-type'] ?? ''),
      'the image scan must read the base image’s OS packages',
    ).toBe('os');
    // The scanner set, the severities and the exit code are pinned with
    // the rest of the image scan: `severity: LOW` reports nothing and no
    // check objects, `scanners: secret` scans the wrong thing, and
    // `exit-code: '0'` reports green over a HIGH finding in the image.
    expect(
      String(scan?.with['scanners'] ?? ''),
      'the image scan must read the image’s vulnerabilities',
    ).toBe('vuln');
    expect(
      String(scan?.with['severity'] ?? ''),
      'the image scan must scan the same severities',
    ).toBe('HIGH,CRITICAL');
    expect(String(scan?.with['exit-code'] ?? ''), 'the image scan must fail on a finding').toBe(
      '1',
    );
    // The build has to come first: the scan reads the image the build
    // produced.
    const buildIndex = steps.findIndex((step) => (step.run ?? '').includes('docker build'));
    expect(buildIndex, 'the docker job does not build the image').toBeGreaterThanOrEqual(0);
    expect(scanIndex, 'the docker job must scan the image it builds').toBeGreaterThan(buildIndex);
  });

  it('runs the docker job on pull requests', () => {
    // The image scan lives in the docker job, so a job-level `if:` that
    // never matches switches the whole scan off — and every check still
    // reports green, because a job that does not run reports nothing.
    const docker = jobOf(ci, 'docker');
    expect(docker?.if, 'the docker job must run on pull requests').toBe(
      "github.event_name == 'pull_request'",
    );
  });

  it('fails the local sweep when a scanner finds something', () => {
    // `npm run scan` is the local gate (AGENTS.md:48) and is NOT part of
    // `npm run ci`, so nothing in CI would notice a sweep that stopped
    // failing. The sweep runs here with STUB scanners on PATH: the stubs
    // stand in for the scanners, so the test is hermetic, fast, and never
    // runs a real scanner or reaches the network.
    //
    // The two failure paths are exercised SEPARATELY, because each counts
    // its own failure: the `run_or_skip` helper and the osv-scanner
    // branch have a counter each, and a sweep with one of them broken
    // still fails through the other.
    for (const codes of [{ npm: 1 }, { 'osv-scanner': 3 }]) {
      const failing = runLocalSweep(codes);
      expect(
        failing.status,
        `the sweep must fail when ${Object.keys(codes)[0] ?? 'a scanner'} reports findings`,
      ).not.toBe(0);
      expect(failing.stdout, 'the sweep must say that a scanner failed').toContain('FAIL');
    }
    // The control: the same sweep, with every stub passing, exits 0 —
    // so the assertions above are a failure and not a permanent non-zero.
    const passing = runLocalSweep({});
    expect(passing.status, 'the sweep must pass when every scanner passes').toBe(0);
  }, 30_000);

  it('names the CI jobs the sweep’s header names', () => {
    // The header says where CI runs each scanner. It was prose — "the
    // first three in the `quality` and `security` jobs" — and prose is not
    // checkable: npm audit runs in `quality` and gitleaks and osv-scanner
    // in `security`, and nothing said so. The header now states the
    // mapping, and the WORKFLOW is the truth it is compared against.
    expect(headerJobs(), 'the sweep’s header must name the job CI runs each scanner in').toEqual(
      scannerJobs(),
    );
  });
});
