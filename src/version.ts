import { createRequire } from 'node:module';

const requireJson = createRequire(import.meta.url);

/** Package version, read from package.json at startup (fallback `0.0.0`). */
export const VERSION: string = readVersion();

function readVersion(): string {
  try {
    const pkg = requireJson('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
