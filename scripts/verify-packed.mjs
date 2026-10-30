#!/usr/bin/env node
/**
 * Verify that the packed tarball carries everything the program reads.
 *
 * The program reads two kinds of file at runtime:
 *
 * - its IMPORTS — the compiled modules the entry point pulls in. These are
 *   found by scanning `src/cli.ts` for relative imports.
 * - its ASSETS — files read beside the module with `readFileSync` (the web
 *   UI's script and stylesheet). These are NOT imports, so a scan for
 *   imports cannot find them; they come from the copy script's own list,
 *   so the two cannot drift.
 *
 * A tarball missing any of them ships a package that fails at runtime, in
 * a stranger's terminal: the binary is not there, or `/ui.js` answers 404.
 * This runs before the tarball is packed, in EVERY job that publishes one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packedPaths } from './pack-list.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The entry point and every module it imports, transitively.
 *
 * The closure matters: the entry point pulls in the service, which pulls in
 * the store, the MCP server and the HTTP server. A tarball that carried
 * the entry point but not the module two levels down would pass a check
 * that only looked at the first level — and would fail at runtime, in a
 * stranger's terminal, with "cannot find module".
 */
function expectedImports() {
  const sources = new Set(['src/cli.ts']);
  const queue = ['src/cli.ts'];
  while (queue.length > 0) {
    const source = queue.pop() ?? '';
    const text = readFileSync(join(ROOT, source), 'utf8');
    for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = sourceFor(source, match[1] ?? '');
      if (target === null || sources.has(target)) continue;
      sources.add(target);
      queue.push(target);
    }
  }
  return [...sources].map(
    (source) => 'dist/' + source.slice('src/'.length).replace(/\.ts$/, '.js'),
  );
}

/**
 * The source file a relative import names, or null when there is none.
 *
 * The specifier is the COMPILED name ('./service.js'), so the source is the
 * same path with the TypeScript extension. An import that names no source
 * file — a directory, a package — is not part of the closure.
 */
function sourceFor(from, specifier) {
  const target = join(dirname(from), specifier).replace(/\.js$/, '.ts');
  return existsSync(join(ROOT, target)) ? target : null;
}

/**
 * The runtime assets: the copy script's own list.
 *
 * The list is read from that script's text, so it cannot drift from what
 * the build copies. A change of SHAPE — a re-quoted entry, a template
 * literal — must STOP this check rather than quietly shrink it: a list
 * whose targets and sources disagree has lost an entry, and a check that
 * has lost an entry would pass a tarball that does not have it.
 */
function expectedAssets() {
  const copyScript = readFileSync(join(ROOT, 'scripts/copy-assets.mjs'), 'utf8');
  const targets = [...copyScript.matchAll(/to: '([^']+)'/g)].map((match) => match[1]);
  const sources = (copyScript.match(/from: /g) ?? []).length;
  if (targets.length === 0 || targets.length !== sources) {
    console.error(
      `scripts/copy-assets.mjs lists ${targets.length} target(s) and ${sources} source(s) — ` +
        'the copy list changed shape, so the asset check cannot be trusted.',
    );
    process.exit(1);
  }
  return targets;
}

const expected = [...new Set([...expectedImports(), ...expectedAssets()])];

/**
 * The tarball is built from `dist/`, so the guard needs the build.
 *
 * The test suite runs before the build step in `npm run ci`, so at test
 * time the checkout has no `dist/` at all — and a pack of an unbuilt
 * checkout lists a package with no program in it: a true fact about the
 * checkout, and nothing about the package that would be published. The
 * build is run here so the guard measures the package.
 *
 * It is run every time, not only when `dist/` is missing: a stale
 * `dist/` is as misleading as an absent one, and the guard's verdict
 * must not depend on what happened to be lying in the working tree.
 */
function buildPackage() {
  // The build does not clean `dist/`, so a file the build no longer
  // produces would survive it — and be packed. The guard measures what a
  // CLEAN build produces, so it starts from an empty directory.
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: ['inherit', process.stderr, 'inherit'],
  });
  if (result.status !== 0) {
    console.error('The build failed, so there is no package to check.');
    process.exit(1);
  }
}

/**
 * The paths the packed tarball carries.
 *
 * The npm-specific knowledge — which shape `npm pack --json` printed,
 * and what a lifecycle script may have put in front of it — lives in
 * the pack list, so this guard does not have to know it. A payload
 * that cannot be read at all is reported as such: the guard must be
 * able to tell a broken package from a broken reader.
 */
function packedFiles() {
  try {
    return new Set(packedPaths(ROOT));
  } catch (error) {
    console.error(
      'Could not read the packed package list: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

buildPackage();
const files = packedFiles();
const missing = expected.filter((file) => !files.has(file));
if (missing.length > 0) {
  console.error('Missing from the packed package:');
  for (const file of missing) console.error('  ' + file);
  process.exit(1);
}
console.log('The packed package contains the executable, every import and every runtime asset:');
for (const file of expected) console.log('  ' + file);
