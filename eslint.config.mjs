import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

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
      // TypeScript safety (Sonar-aligned)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
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
      // Security rules (local Snyk/Sonar pre-flight)
      'security/detect-unsafe-regex': 'error',
      'security/detect-child-process': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-require': 'error',
      // Noisy by design in TypeScript codebases; SonarQube covers these:
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
    files: ['test/**/*.ts'],
    rules: {
      // Test fixtures intentionally index by dynamic key
      'security/detect-non-literal-fs-filename': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
