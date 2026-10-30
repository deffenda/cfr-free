import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { UI_JS } from '../src/titan/ui.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The result ESLint returns for one linted file. */
type LintResult = Awaited<ReturnType<ESLint['lintText']>>[number];

/**
 * The lint scope of the browser script.
 *
 * `src/titan/ui-client.js` runs in the operator's browser. If Node's globals
 * are visible to it, the gate cannot catch `process.env.HOME` — the script
 * would pass the lint and then throw a ReferenceError in the browser, which
 * is exactly the class of defect CR-03 exists to eliminate.
 *
 * Flat config MERGES `languageOptions.globals` across every matching block
 * rather than replacing them, so a block matching every `.js` file elsewhere
 * in the config silently hands Node's globals to the browser script. These
 * tests pin that it does not.
 */
describe('the browser script lint scope', () => {
  const eslint = new ESLint({ cwd: ROOT });

  /** The one lint result ESLint returns for a probe. */
  async function lintProbe(filePath: string, source: string): Promise<LintResult> {
    const [result] = await eslint.lintText(source, { filePath });
    if (result === undefined) throw new Error(`eslint returned no result for ${filePath}`);
    return result;
  }

  it('lints the very bytes the browser is served', async () => {
    // The gate's whole value here is that the file the linter reads is the
    // file the browser runs. If the script were re-inlined into
    // `src/titan/ui.ts` as a template literal while
    // `src/titan/ui-client.js` stayed on disk, the linter would keep
    // checking the clean file while the browser got the inlined copy —
    // and the gate would stay green over a defective script.
    const onDisk = readFileSync(path.join(ROOT, 'src/titan/ui-client.js'), 'utf8');
    expect(UI_JS, 'the served script must be the file the linter reads, byte for byte').toBe(
      onDisk,
    );

    // And the bytes the linter sees must carry the correctness rules: a
    // defect in the served script must be reported against it.
    const result = await lintProbe(path.join(ROOT, 'src/titan/ui-client.js'), UI_JS);
    expect(result.messages.map((message) => message.ruleId)).not.toContain('eqeqeq');
  }, 30_000);

  it('does not let the browser script reach for Node globals', async () => {
    const result = await lintProbe(
      path.join(ROOT, 'src/titan/ui-client.js'),
      'void process.env.HOME;\n',
    );
    const rules = result.messages.map((message) => message.ruleId);
    expect(rules).toContain('no-undef');
    expect(result.messages.map((message) => message.message).join(' ')).toContain('process');
  }, 30_000);

  it('still lets the repository tooling reach for Node globals', async () => {
    // The narrowing must not cost the repo's own scripts their globals. Two
    // paths, because the node-globals block covers two patterns: a `.js`
    // script under `scripts/`, and any `.mjs` file in the repository.
    const js = await lintProbe(path.join(ROOT, 'scripts/probe.js'), 'void process.env.HOME;\n');
    expect(js.messages.map((message) => message.ruleId)).not.toContain('no-undef');

    const mjs = await lintProbe(path.join(ROOT, 'tools/probe.mjs'), 'void process.env.HOME;\n');
    expect(mjs.messages.map((message) => message.ruleId)).not.toContain('no-undef');
  }, 30_000);

  it('applies the correctness rules to the browser script', async () => {
    // `CORRECTNESS_RULES` in `eslint.config.mjs` is spread into the browser
    // block, so the browser script gets the same defect-catching rules as
    // the TypeScript sources. That spread is the ONLY thing that carries
    // them: `js.configs.recommended` does not enable `eqeqeq` or `no-var`,
    // so a browser block without the spread would lint 800+ lines of
    // browser JavaScript and catch nothing — the blind spot CR-03 exists
    // to close, reopened by a one-line deletion.
    const result = await lintProbe(
      path.join(ROOT, 'src/titan/ui-client.js'),
      'var probe = 1;\nif (probe == 1) {}\n',
    );
    const rules = result.messages.map((message) => message.ruleId);
    expect(rules, 'the correctness rules must reach the browser script').toContain('eqeqeq');
    expect(rules, 'the correctness rules must reach the browser script').toContain('no-var');
  }, 30_000);

  it('lets the browser script reach for the browser globals it uses', async () => {
    // The other half of the contract: the globals the script actually uses
    // must stay defined, or the narrowing would break the script.
    const result = await lintProbe(
      path.join(ROOT, 'src/titan/ui-client.js'),
      'void fetch; void document; void window; void navigator; void location; void history;\n',
    );
    expect(result.messages.map((message) => message.ruleId)).not.toContain('no-undef');
  }, 30_000);
});
