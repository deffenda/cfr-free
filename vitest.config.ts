import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts's import-guarded bootstrap (isMainModule block) cannot execute
      // under vitest — only the spawned binary reaches it — and its command
      // dispatch success paths are covered by the documented e2e smokes; the
      // three commands/* modules are process-boundary wiring (stdio, listeners,
      // signals) exercised the same way. Measured in-suite: cli.ts reads 74%,
      // so excluding it keeps the 90% branch floor meaningful instead of
      // counting by-design-unreachable lines against it.
      exclude: [
        'src/cli.ts',
        'src/commands/mcp.ts',
        'src/commands/serve.ts',
        'src/commands/sync.ts',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
