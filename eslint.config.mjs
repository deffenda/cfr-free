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
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Developer tooling prints reports to stdout by design.
      'no-console': 'off',
    },
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
