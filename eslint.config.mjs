import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

/**
 * The rules that catch DEFECTS rather than style. They apply to the
 * TypeScript sources and to the browser script alike: `src/titan/ui-client.js` is
 * a real file so that the gate can see it (it used to be a `String.raw`
 * template literal inside a TypeScript module, where 840 lines of browser
 * JavaScript reached no linter at all).
 */
const CORRECTNESS_RULES = {
  // General correctness
  'no-console': ['error', { allow: ['error', 'warn'] }],
  eqeqeq: ['error', 'always'],
  complexity: ['error', 15],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'no-implicit-coercion': ['error', { boolean: false }],
  // Security rules (local pre-flight)
  'security/detect-unsafe-regex': 'error',
  'security/detect-child-process': 'error',
  'security/detect-eval-with-expression': 'error',
  'security/detect-non-literal-require': 'error',
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'data/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { security },
    rules: {
      // TypeScript safety (quality gates)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      ...CORRECTNESS_RULES,
      // Redundant with our local quality + review gates:
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-object-injection': 'off',
      'security/detect-possible-timing-attacks': 'off',
    },
  },
  {
    // Node's globals, for the repository's own tooling.
    //
    // NOT `**/*.js`: the browser script is a `.js` file too, and flat config
    // MERGES `languageOptions.globals` across every matching block rather
    // than replacing them. A `**/*.js` block would therefore leave `process`,
    // `require`, `module` and `Buffer` DEFINED in the browser script — where
    // they throw a ReferenceError at runtime, in the operator's browser,
    // while the gate says nothing. `scripts/**/*.js` covers the repo's own
    // scripts; the browser script gets its own block below.
    files: ['**/*.mjs', 'scripts/**/*.js'],
    plugins: { security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Developer tooling prints reports to stdout by design.
      'no-console': 'off',
      // The repository's own security rules reach the TOOLING too: the
      // install-time `prepare` script runs a child process and reaches the
      // network, and it sat outside the security lint entirely because the
      // block that covers the `.mjs` files had no `security` plugin.
      'security/detect-unsafe-regex': 'error',
      'security/detect-child-process': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'error',
    },
  },
  {
    // The repository's OWN scripts run child processes, and CR-36 named the
    // one at `scripts/prepare.mjs`. The `security` plugin's
    // `detect-child-process` rule reports `exec()` with a non-literal
    // argument and nothing else, so it reported NOTHING at the `spawnSync`
    // call the review cited (verified 2026-10-30): the remediation reached
    // the `.mjs` files and missed the call.
    //
    // Two rules close that gap:
    //
    //  - the SHELL forms cannot be imported at all. `exec`/`execSync` take
    //    a command STRING and run it through /bin/sh, so a value that
    //    reaches them runs as code;
    //  - a spawn/execFile call must NAME its command. The first argument
    //    has to be a literal — or this script's own `process.execPath`, which
    //    is Node's binary and not a value anything supplies — so a script
    //    cannot run a command it computed at runtime.
    //
    // The child-process functions must be imported BY NAME, so the lint can
    // see which one a script calls: a default or namespace import would
    // hide the call behind `cp.exec(...)`.
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['child_process', 'node:child_process'],
              importNames: ['exec', 'execSync'],
              message:
                'scripts/ must not run a command through a shell: exec/execSync take a command STRING and run it via /bin/sh. Use spawn/execFile with an argument array.',
            },
            {
              group: ['child_process', 'node:child_process'],
              importNames: ['default', 'namespace'],
              message:
                'scripts/ must import the child-process functions it uses BY NAME, so the lint can see which one it calls.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name=/^(spawn|spawnSync|execFile|execFileSync)$/][arguments.0.type!="Literal"]:not(CallExpression[arguments.0.object.name="process"][arguments.0.property.name="execPath"])',
          message:
            'scripts/ must run a command it NAMES: the first argument of a spawn/execFile call must be a literal.',
        },
      ],
    },
  },
  {
    // The ONE legitimate caller, named: `scripts/prepare.mjs`'s `run()`
    // helper forwards the command it was given, and the only two commands
    // it is given are named at its call sites — 'npm' and this script's own
    // Node binary. Only the computed-command rule is exempt here; the
    // shell-form ban above still applies to this file.
    //
    // This is the only exemption in scripts/, and a guard
    // (`test/eslint-config.test.ts`) pins it: a second exempt file fails the
    // suite.
    files: ['scripts/prepare.mjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // The browser script: a classic script (not a module) that runs in the
    // operator's browser, not in Node. It gets the same correctness rules
    // as the server code, with the browser's globals.
    files: ['src/titan/ui-client.js'],
    plugins: { security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      ...CORRECTNESS_RULES,
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Test fixtures intentionally index by dynamic key
      'security/detect-non-literal-fs-filename': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
