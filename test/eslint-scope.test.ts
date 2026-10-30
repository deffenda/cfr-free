import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

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

  it('does not let the browser script reach for Node globals', async () => {
    const result = await lintProbe(
      path.join(ROOT, 'src/titan/ui-client.js'),
      'void process.env.HOME;\n',
    );
    const rules = result.messages.map((message) => message.ruleId);
    expect(rules).toContain('no-undef');
    expect(result.messages.map((message) => message.message).join(' ')).toContain('process');
  });

  it('still lets the repository tooling reach for Node globals', async () => {
    // The narrowing must not cost the repo's own scripts their globals. Two
    // paths, because the node-globals block covers two patterns: a `.js`
    // script under `scripts/`, and any `.mjs` file in the repository.
    const js = await lintProbe(path.join(ROOT, 'scripts/probe.js'), 'void process.env.HOME;\n');
    expect(js.messages.map((message) => message.ruleId)).not.toContain('no-undef');

    const mjs = await lintProbe(path.join(ROOT, 'tools/probe.mjs'), 'void process.env.HOME;\n');
    expect(mjs.messages.map((message) => message.ruleId)).not.toContain('no-undef');
  });

  it('lets the browser script reach for the browser globals it uses', async () => {
    // The other half of the contract: the globals the script actually uses
    // must stay defined, or the narrowing would break the script.
    const result = await lintProbe(
      path.join(ROOT, 'src/titan/ui-client.js'),
      'void fetch; void document; void window; void navigator; void location; void history;\n',
    );
    expect(result.messages.map((message) => message.ruleId)).not.toContain('no-undef');
  });
});
