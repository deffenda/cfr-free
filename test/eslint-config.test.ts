/**
 * The ESLint configuration guard.
 *
 * `eslint.config.mjs` is the repository's own security floor: the rules it
 * enables are what stands between a defect in the tooling and a defect in
 * the operator's install. Two things can silently unarm it, and neither is
 * visible in a green run:
 *
 *  - a rule DELETED from a block. The `.mjs` block gained the `security`
 *    rules when CR-36 was fixed, and deleting all four of them left the
 *    suite green — the remediation could be reverted with no signal at all.
 *    The guard here is BEHAVIOURAL: it lints a probe and asks whether the
 *    rule still fires. A guard that read the rule names out of the config
 *    would pass on a rule that was renamed into something else.
 *  - a rule that does not reach the code it was written for. CR-36 named
 *    the `spawnSync` call in `scripts/prepare.mjs`, and
 *    `security/detect-child-process` reports only `exec()` with a
 *    non-literal argument: the rule was extended to the `.mjs` files and
 *    still reported nothing there (verified 2026-10-30).
 *
 * The probes live in `tools/` and `scripts/` because the configuration
 * scopes its rules by PATH: the `security` rules reach every `.mjs` file,
 * and the child-process rules reach `scripts/` only.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

/**
 * One probe per `security` rule, and the source that trips it.
 *
 * Each probe is a `.mjs` file OUTSIDE `scripts/`, so the only rules that
 * can fire are the ones the `.mjs` block carries.
 */
const SECURITY_PROBES: { rule: string; source: string }[] = [
  {
    rule: 'security/detect-unsafe-regex',
    source: 'const pattern = /(a+)+b$/;\nvoid pattern.test("x");\n',
  },
  {
    rule: 'security/detect-child-process',
    source:
      "import { exec } from 'node:child_process';\nconst input = process.argv[2] ?? '';\nexec(`ls ${input}`);\n",
  },
  {
    rule: 'security/detect-eval-with-expression',
    source: "const source = process.argv[2] ?? '';\neval(source);\n",
  },
  {
    rule: 'security/detect-non-literal-require',
    source: "const name = process.argv[2] ?? '';\nconst loaded = require(name);\nvoid loaded;\n",
  },
];

/** The scripts that may run a child process with a COMPUTED command. */
const CHILD_PROCESS_EXEMPT = 'prepare.mjs';

describe('the ESLint configuration', () => {
  const eslint = new ESLint({ cwd: ROOT });

  /** The rule IDs ESLint reports for a probe at the given path. */
  async function rulesFor(filePath: string, source: string): Promise<string[]> {
    const [result] = await eslint.lintText(source, { filePath });
    if (result === undefined) throw new Error(`eslint returned no result for ${filePath}`);
    return result.messages.map((message) => message.ruleId);
  }

  it('carries every security rule into the `.mjs` files', async () => {
    // Silent failure this prevents: the CR-36 remediation extended the
    // `security` rules to `**/*.mjs`, and deleting all four of them again
    // left the suite green. Each rule is asked to fire on a probe that
    // breaks it — the guard measures the rule, not the rule's name.
    const probe = path.join(ROOT, 'tools', 'probe.mjs');
    for (const { rule, source } of SECURITY_PROBES) {
      expect(await rulesFor(probe, source), `${rule} does not reach the .mjs files`).toContain(
        rule,
      );
    }
  }, 60_000);

  it('bans a script that runs a command it computed', async () => {
    // CR-36 named the `spawnSync` call in `scripts/prepare.mjs`, and the
    // `security` plugin reports only `exec()` with a non-literal argument:
    // a `spawnSync(command, args)` passed the lint untouched. The rule
    // below asks the first argument to be a LITERAL, so a script cannot
    // run a command it computed at runtime.
    const probe = path.join(SCRIPTS_DIR, 'probe.mjs');
    expect(
      await rulesFor(
        probe,
        "import { spawnSync } from 'node:child_process';\nspawnSync(command, []);\n",
      ),
      'a spawn call whose command is computed must be reported',
    ).toContain('no-restricted-syntax');
    // The legitimate shape still passes: the command is named.
    expect(
      await rulesFor(
        probe,
        "import { spawnSync } from 'node:child_process';\nspawnSync('npm', []);\n",
      ),
      'a spawn call whose command is a literal must pass',
    ).not.toContain('no-restricted-syntax');
  }, 60_000);

  it('bans the shell forms of the child-process API', async () => {
    // `exec`/`execSync` take a command STRING and run it through /bin/sh,
    // so a value that reaches them runs as code. The rule bans the IMPORT,
    // so it holds however the script reaches the function.
    const probe = path.join(SCRIPTS_DIR, 'probe.mjs');
    expect(
      await rulesFor(probe, "import { exec } from 'node:child_process';\nvoid exec;\n"),
      'a script must not import exec',
    ).toContain('no-restricted-imports');
    expect(
      await rulesFor(probe, "import { execSync } from 'node:child_process';\nvoid execSync;\n"),
      'a script must not import execSync',
    ).toContain('no-restricted-imports');
    // The spawn forms take an argument ARRAY and run no shell.
    expect(
      await rulesFor(probe, "import { spawnSync } from 'node:child_process';\nvoid spawnSync;\n"),
      'a script may import spawnSync',
    ).not.toContain('no-restricted-imports');
  }, 60_000);

  it('exempts exactly one script from the computed-command rule', async () => {
    // The exemption is a file-scoped override, and a file-scoped override
    // is the shape of a hole that grows: each new exemption would be one
    // more script whose child processes the lint cannot see. The count is
    // asserted, so the second one fails the suite.
    const scripts = readdirSync(SCRIPTS_DIR)
      .filter((name) => name.endsWith('.mjs'))
      .sort();
    const exempt: string[] = [];
    for (const name of scripts) {
      const config = await eslint.calculateConfigForFile(path.join(SCRIPTS_DIR, name));
      const rule = config.rules?.['no-restricted-syntax'];
      const severity = Array.isArray(rule) ? rule[0] : rule;
      if (severity === 0 || severity === 'off') exempt.push(name);
    }
    expect(exempt, 'the computed-command rule is off in scripts/').toEqual([CHILD_PROCESS_EXEMPT]);
  }, 60_000);

  it('lets the repository’s own scripts pass the lint', async () => {
    // The rules above must not break the legitimate uses: the release
    // guard runs `npm run build`, and the tarball guard runs `npm pack`.
    const results = await eslint.lintFiles(['scripts/**/*.mjs']);
    const failures = results.flatMap((result) =>
      result.messages.map(
        (message) => `${path.relative(ROOT, result.filePath)}: ${message.message}`,
      ),
    );
    expect(failures, 'the repository’s own scripts must pass the lint').toEqual([]);
  }, 60_000);
});
