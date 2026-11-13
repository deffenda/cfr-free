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
 *
 * The same shape guards the security claim in the same sentence. SPEC.md
 * said "no `eval`/`Function`/`child_process`" while `scripts/prepare.mjs`
 * and `scripts/verify-packed.mjs` run `spawnSync` — the implementation
 * carries an explicit, guarded exemption for one of them. The claim is now
 * scoped to the tree it is true of, and the scope is checked against the
 * implementation rather than against the specification.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const ESLINT_CONFIG_PATH = path.join(ROOT, 'eslint.config.mjs');
const SPEC_PATH = path.join(ROOT, 'docs', 'SPEC.md');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const SRC_DIR = path.join(ROOT, 'src');

describe('the limits SPEC.md states', () => {
  /** The complexity limit `eslint.config.mjs` enforces. */
  function configuredComplexityLimit(): number {
    const config = readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    const found = /complexity:\s*\[\s*'error'\s*,\s*(\d+)\s*\]/.exec(config);
    expect(found, 'eslint.config.mjs must set the complexity limit as a number').not.toBeNull();
    return Number(found?.[1]);
  }

  /** The line of SPEC.md that states the quality rules. */
  function qualityLine(): string {
    const spec = readFileSync(SPEC_PATH, 'utf8');
    const line = spec
      .split('\n')
      .find((entry) => entry.includes('ESLint') && entry.includes('complexity'));
    expect(line, 'docs/SPEC.md must state the ESLint complexity limit').toBeDefined();
    return line ?? '';
  }

  /** The scripts that import a child-process function. */
  function childProcessScripts(): string[] {
    return readdirSync(SCRIPTS_DIR)
      .filter((name) => name.endsWith('.mjs'))
      .filter((name) =>
        /from '(node:)?child_process'/.test(readFileSync(path.join(SCRIPTS_DIR, name), 'utf8')),
      )
      .sort();
  }

  /** The scripts `eslint.config.mjs` exempts from the computed-command rule. */
  function exemptScripts(): string[] {
    const config = readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    const found = /files:\s*\['scripts\/([^*']+\.mjs)'\]/.exec(config);
    return found?.[1] === undefined ? [] : [found[1]];
  }

  it('states the complexity limit eslint.config.mjs enforces', () => {
    const limit = configuredComplexityLimit();
    const line = qualityLine();
    expect(line, 'docs/SPEC.md must state the limit eslint.config.mjs enforces').toContain(
      `complexity ≤ ${limit}`,
    );
  });

  it('scopes the no-eval/no-child-process claim to the tree it holds for', () => {
    // The claim was "no `eval`/`Function`/`child_process`", and the
    // implementation has `spawnSync` in `scripts/` — with an explicit
    // exemption for one file. The scope is checked against the code: the
    // tree the claim covers really has none, and the scripts that do are
    // named, so a fourth one cannot appear without the specification
    // moving with it.
    const srcFiles = readdirSync(SRC_DIR, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile(),
    );
    const offenders = srcFiles.filter((entry) =>
      /child_process|\beval\s*\(|\bnew Function\b/.test(
        readFileSync(path.join(entry.parentPath, entry.name), 'utf8'),
      ),
    );
    expect(offenders, 'src/ must have no eval, no Function and no child_process').toEqual([]);
    const scripts = childProcessScripts();
    expect(scripts.length, 'the scripts that run a child process').toBeGreaterThan(0);
    const line = qualityLine();
    expect(line, 'docs/SPEC.md must scope the claim to src/').toContain(
      'no `eval`/`Function`/`child_process` in `src/`',
    );
    expect(line, 'docs/SPEC.md must state how many scripts run a child process').toContain(
      `in exactly ${scripts.length} files`,
    );
    for (const name of scripts) {
      expect(line, `docs/SPEC.md must name ${name}`).toContain(`scripts/${name}`);
    }
    const exempt = exemptScripts();
    expect(exempt.length, 'exactly one script is exempt from the computed-command rule').toBe(1);
    expect(line, 'docs/SPEC.md must name the exempt script').toContain(
      `only \`scripts/${exempt[0]}\` is exempt`,
    );
  });
});
