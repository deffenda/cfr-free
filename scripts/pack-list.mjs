#!/usr/bin/env node
/**
 * The paths a tarball would carry.
 *
 * WHY THIS EXISTS. `npm pack --json` is not one shape. npm 10 and 11
 * print an array of package records; npm 12 prints an object keyed by
 * the package name (both measured). The payload also arrives with
 * whatever a lifecycle script printed in front of it, because npm
 * shares stdout with the scripts it runs: npm runs `prepare` during a
 * pack — npm 10.9.9 and 12.2.1 do so even with --ignore-scripts
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
import { pathToFileURL } from 'node:url';

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

// Run directly: print the paths as JSON. The callers that cannot
// import this file use this form.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(packedPaths(process.argv[2] ?? process.cwd())));
}
