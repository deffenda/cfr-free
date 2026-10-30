/**
 * The specification's limits, and the implementation's.
 *
 * `docs/SPEC.md` is the design authority, so a limit it states has to be the
 * limit the code enforces. This branch shipped the contradiction itself:
 * across seven of its own commits `docs/SPEC.md` read `complexity ≤ 10`
 * while `eslint.config.mjs` read `15`, and only the last commit corrected
 * it. Nothing noticed, because no test read the pair.
 *
 * The guard reads the number OUT of the configuration and asks the
 * specification to state the same one, so the two cannot drift apart
 * silently in either direction: a specification that lowers the limit and a
 * configuration that lowers it are two changes, and the specification is
 * the one that has to move with it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const ESLINT_CONFIG_PATH = path.join(ROOT, 'eslint.config.mjs');
const SPEC_PATH = path.join(ROOT, 'docs', 'SPEC.md');

describe('the limits SPEC.md states', () => {
  /** The complexity limit `eslint.config.mjs` enforces. */
  function configuredComplexityLimit(): number {
    const config = readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    const found = /complexity:\s*\[\s*'error'\s*,\s*(\d+)\s*\]/.exec(config);
    expect(found, 'eslint.config.mjs must set the complexity limit as a number').not.toBeNull();
    return Number(found?.[1]);
  }

  it('states the complexity limit eslint.config.mjs enforces', () => {
    const limit = configuredComplexityLimit();
    const spec = readFileSync(SPEC_PATH, 'utf8');
    const line = spec
      .split('\n')
      .find((entry) => entry.includes('ESLint') && entry.includes('complexity'));
    expect(line, 'docs/SPEC.md must state the ESLint complexity limit').toBeDefined();
    expect(line, 'docs/SPEC.md must state the limit eslint.config.mjs enforces').toContain(
      `complexity ≤ ${limit}`,
    );
  });
});
