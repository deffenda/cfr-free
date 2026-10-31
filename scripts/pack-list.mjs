#!/usr/bin/env node
/**
 * The paths a tarball would carry.
 *
 * WHY THIS EXISTS. `npm pack --json` is not one shape. npm 10 and 11
 * print an array of package records; npm 12 prints an object keyed by
 * the package name (both measured). The payload also arrives with
 * whatever a lifecycle script printed in front of it, because npm
 * shares stdout with the scripts it runs: npm runs `prepare` during a
 * pack — npm 10.9.9 does so even with --ignore-scripts
 * (measured) — and that output lands in the same stream.
 *
 * So the npm-specific knowledge lives here, in one place, and the
 * callers get a list of paths.
 *
 * This script is a REPO tool: it is not in the package's `files`
 * allowlist, because a consumer installs the program and never packs
 * it. The guard and the test suite use it; the test suite cannot
 * import it, because the repository compiles TypeScript only and does
 * not resolve JavaScript modules from TypeScript.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The file paths in an `npm pack --json` payload, whichever shape npm
 * printed it in.
 */
export function filePaths(payload) {
  const records = Array.isArray(payload) ? payload : Object.values(payload ?? {});
  for (const record of records) {
    if (record && Array.isArray(record.files)) {
      return record.files.map((file) => file.path);
    }
  }
  return [];
}

/**
 * The JSON payload npm printed, with anything a lifecycle script put
 * in front of it removed.
 *
 * The payload is the LAST thing npm printed: whatever a lifecycle script
 * printed came before it. The scan therefore starts at each candidate
 * line and takes the tail that parses — the tail must be a complete
 * document, right to the end of the output, or the candidate is not the
 * payload. Anything else fails closed: a payload that cannot be read is
 * reported, not guessed at.
 */
export function parsePayload(stdout) {
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Not the payload on its own — fall through to the scan below.
  }
  const lines = text.split('\n');
  for (let start = 0; start < lines.length; start++) {
    const candidate = lines.slice(start).join('\n').trim();
    if (!candidate.startsWith('[') && !candidate.startsWith('{')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // This line is not the start of the payload — try the next one.
    }
  }
  throw new Error('npm pack printed no JSON package list. Its stdout was:\n' + text.slice(0, 2000));
}

/** The paths the tarball for the given directory would carry. */
export function packedPaths(cwd) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd,
    encoding: 'utf8',
  });
  return filePaths(parsePayload(out));
}

/**
 * True when this file is the one the process was started with.
 *
 * `import.meta.url` is the REAL path of this module and `argv[1]` is
 * whatever the caller typed, so a symlinked path would not compare equal
 * and the script would print nothing at all. Both sides are resolved.
 */
function isMainModule() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

// Run directly: print the paths as JSON. The callers that cannot
// import this file use this form.
if (isMainModule()) {
  process.stdout.write(JSON.stringify(packedPaths(process.argv[2] ?? process.cwd())));
}
