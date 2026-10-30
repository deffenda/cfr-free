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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ci, jobOf, type Step } from './workflows.js';

const SECURITY_SCAN_PATH = fileURLToPath(new URL('../tools/security-scan.sh', import.meta.url));

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
    // The build has to come first: the scan reads the image the build
    // produced.
    const buildIndex = steps.findIndex((step) => (step.run ?? '').includes('docker build'));
    expect(buildIndex, 'the docker job does not build the image').toBeGreaterThanOrEqual(0);
    expect(scanIndex, 'the docker job must scan the image it builds').toBeGreaterThan(buildIndex);
  });
});
