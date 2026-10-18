import { createRequire } from 'node:module';

const requireJson = createRequire(import.meta.url);

/** Package version, read from package.json at startup (fallback `0.0.0`). */
export const VERSION: string = readVersion();

/** Read `version` via `requireFn`; any failure falls back to `0.0.0`. Extracted for testability. */
export function readVersionFrom(requireFn: NodeRequire): string {
  try {
    const pkg = requireFn('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readVersion(): string {
  return readVersionFrom(requireJson);
}
