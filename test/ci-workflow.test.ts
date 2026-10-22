import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The CI workflow, the local gate, and branch protection must not drift.
 *
 * Three facts are load-bearing, and all three fail silently:
 *
 *  1. Branch protection on `main` requires the checks `quality (22)`,
 *     `quality (24)` and `security` (read from
 *     `repos/deffenda/cfr-free/branches/main/protection` on 2026-10-22).
 *     A renamed job or a narrowed matrix removes a required check, and
 *     GitHub then waits forever for a check that will never report: the
 *     pull request can never go green.
 *  2. The `quality` job must run the same commands, in the same order, as
 *     `npm run ci`. That script is the local gate; once the two diverge,
 *     "green locally" stops meaning "green in CI", and the divergence is
 *     invisible until a merge fails.
 *  3. Those commands are split into one step each so a failure names
 *     itself. Four of the five CI failures in the week to 2026-10-22
 *     surfaced only as "Run npm run ci", sending the reader back to a
 *     local reproduction to learn which sub-step broke. Folding them back
 *     into one step restores that blindness.
 *
 * This reads the workflow as text rather than parsing YAML: the file is
 * owned by this repo, the assertions are about specific lines, and a
 * text guard needs no dependency. The cost is that a reformat which
 * changes the matched lines fails the guard — which is the intended
 * behaviour for a file whose exact step list is the contract.
 */

const WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

/** The checks branch protection on `main` requires. Keep in step with it. */
const REQUIRED_CHECKS = ['quality (22)', 'quality (24)', 'security'] as const;

const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
  scripts: Record<string, string>;
};

/** The `npm run …` steps of `npm run ci`, in order. */
function localGateCommands(script: string): string[] {
  return script
    .split('&&')
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .map((step) => step.replace(/^npm run /, ''));
}

/** The `run: npm run …` steps of a workflow text, in file order. */
function workflowRunSteps(text: string): string[] {
  return [...text.matchAll(/^\s+run: npm run (\S+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** The node versions in the `quality` matrix. */
function matrixNodes(text: string): string[] {
  const match = /^\s+node: \[([^\]]+)\]\s*$/m.exec(text);
  const list = match?.[1];
  return list === undefined
    ? []
    : list
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

describe('ci.yml — the workflow the merge gate depends on', () => {
  it('runs the local gate commands verbatim, in order, one step each', () => {
    const script = manifest.scripts.ci;
    expect(script, 'package.json has no `ci` script').toBeDefined();
    const local = localGateCommands(script ?? '');
    expect(local.length).toBeGreaterThan(1);
    expect(workflowRunSteps(workflow)).toEqual(local);
  });

  it('still produces every check branch protection requires', () => {
    // The matrix legs become the check names, so the matrix has to contain
    // the versions branch protection names.
    expect(workflow).toMatch(/^ {2}security:$/m);
    expect(workflow).toMatch(/^ {4}name: security$/m);
    expect(workflow).toMatch(/name: quality \(\$\{\{ matrix\.node \}\}\)$/m);
    const produced = new Set([
      ...matrixNodes(workflow).map((node) => `quality (${node})`),
      'security',
    ]);
    for (const required of REQUIRED_CHECKS) {
      expect(produced, `required check "${required}" would never report`).toContain(required);
    }
  });

  it('narrows the push-to-main run — an intensity knob, not a correctness invariant', () => {
    // A squash merge keeps the tree byte-identical to the pull_request
    // head (verified on PRs #128, #130, #131, #132), so the push run on
    // `main` need not repeat both legs and the container build the pull
    // request already ran. Losing this condition costs minutes, never
    // correctness — which is why it is asserted here rather than left to
    // a comment, but asserted as text rather than as behaviour.
    expect(workflow).toMatch(/if: github\.event_name == 'pull_request' \|\| matrix\.node == 22$/m);
    expect(workflow).toMatch(/^ {4}if: github\.event_name == 'pull_request'$/m);
  });

  it('can fail: the step extractor reports what it is given', () => {
    // The guard above passes vacuously if the extractor silently matches
    // nothing. This pins the extractor to a known text so a broken regex
    // fails here instead of turning the real assertions into no-ops.
    const sample = [
      '      - run: npm ci --ignore-scripts',
      '      - name: format (prettier)',
      '        run: npm run format:check',
      '      - name: lint (eslint)',
      '        run: npm run lint',
      '      - run: |',
      '          docker run --rm cfr-free:ci version',
    ].join('\n');
    expect(workflowRunSteps(sample)).toEqual(['format:check', 'lint']);
    expect(matrixNodes('        node: [22, 24]\n')).toEqual(['22', '24']);
    expect(matrixNodes('      no matrix here\n')).toEqual([]);
  });
});
