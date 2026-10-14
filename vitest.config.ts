import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The mcp/serve/sync command modules are process-boundary wiring
      // (stdio, listeners, signals) exercised by the documented end-to-end
      // smoke tests instead of unit tests; cli.ts is covered by test/cli.test.ts.
      exclude: ['src/commands/mcp.ts', 'src/commands/serve.ts', 'src/commands/sync.ts'],
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
