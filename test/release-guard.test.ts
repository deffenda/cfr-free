/**
 * The release guard: the packed tarball must carry what the program reads.
 *
 * These checks are about the PACKAGE, not about the workflow that builds
 * it, so they live in their own file: the workflow guard reads the
 * workflows, this one runs the guard script and the pack-list reader
 * against the tree.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** The release-time guard: the packed tarball must carry what the program reads. */
const VERIFIER_PATH = fileURLToPath(new URL('../scripts/verify-packed.mjs', import.meta.url));
/** The reader that turns `npm pack --json` into a list of paths. */
const PACK_LIST_PATH = fileURLToPath(new URL('../scripts/pack-list.mjs', import.meta.url));

function readPackedPaths(payload: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'cfr-pack-list-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const payloadFile = join(dir, 'payload.json');
    writeFileSync(payloadFile, payload);
    writeFileSync(join(bin, 'npm'), `#!/bin/sh\ncat "${payloadFile}"\n`, { mode: 0o755 });
    const out = execFileSync(process.execPath, [PACK_LIST_PATH], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
    });
    return JSON.parse(out) as string[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the release guard — the packed package must carry what the program reads', () => {
  it('fails closed when the copy list changes shape', () => {
    // The asset list is read from the copy script's own text. A change of
    // shape — a re-quoted entry, a template literal — must STOP the check
    // rather than quietly shrink it: a list whose targets and sources
    // disagree has lost an entry, and a check that has lost an entry would
    // pass a tarball that does not have it.
    const guard = readFileSync(VERIFIER_PATH, 'utf8');
    expect(guard).toMatch(/targets\.length !== sources/);
    expect(guard).toMatch(/process\.exit\(1\)/);
  });

  it('measures a built package, not an unbuilt checkout', () => {
    // The test suite runs before the build step in `npm run ci`, so the
    // checkout has no `dist/` when the guard runs here. A guard that
    // packed an unbuilt checkout would measure the working tree rather
    // than the package, and would report every runtime file as missing.
    const guard = readFileSync(VERIFIER_PATH, 'utf8');
    expect(guard).toMatch(/'run', 'build'/);
  });

  it('the pack list still answers when it is reached through a symlink', () => {
    // `import.meta.url` is the REAL path of the module and `argv[1]` is
    // whatever the caller typed. Comparing the two without resolving them
    // meant the script printed NOTHING through a symlink — and a caller
    // read that as an empty package list.
    const dir = mkdtempSync(join(tmpdir(), 'cfr-pack-link-'));
    try {
      const link = join(dir, 'pack-list.mjs');
      symlinkSync(join(ROOT, 'scripts', 'pack-list.mjs'), link);
      const out = execFileSync(process.execPath, [link, ROOT], { encoding: 'utf8' });
      const paths = JSON.parse(out) as string[];
      // The assertion is on paths the tarball carries WHETHER OR NOT the
      // program has been built. `npm pack --dry-run --ignore-scripts` runs
      // the `prepare` lifecycle script on npm 10 (which builds `dist/`) and
      // skips it on npm 11 and 12 (which does not) — so asserting a `dist/`
      // path here made this test answer differently on Node 22 and Node 24,
      // and it failed on the Node 24 runner in CI. The BUILT package's
      // contents are asserted by the guard test below, which builds before
      // it packs.
      //
      // The regression this guards is an EMPTY list: the script printing
      // nothing at all through a symlink.
      expect(paths.length).toBeGreaterThan(0);
      expect(paths).toContain('package.json');
      expect(paths).toContain('README.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('reads the package list whichever shape npm printed it in', () => {
    // `npm pack --json` is not one shape: npm 10 and 11 print an array of
    // package records, npm 12 prints an object keyed by the package name
    // (both measured). The payload also arrives with whatever a lifecycle
    // script printed in front of it, because npm shares stdout with the
    // scripts it runs — npm runs `prepare` during a pack (npm 10.9.9 does
    // so even with --ignore-scripts; measured — npm 11 and 12 honour the
    // flag). The reader must
    // not depend on any of that.
    const files = [{ path: 'dist/cli.js' }, { path: 'dist/titan/ui-client.js' }];
    const expected = ['dist/cli.js', 'dist/titan/ui-client.js'];
    const payloads = [
      // npm 10 and 11: an array of package records.
      JSON.stringify([{ name: 'cfr-free', files }]),
      // npm 12: an object keyed by the package name.
      JSON.stringify({ 'cfr-free': { name: 'cfr-free', files } }),
      // The payload behind what a lifecycle script printed.
      'copy-assets: src/titan/ui-client.js -> dist/titan/ui-client.js\n' +
        JSON.stringify([{ name: 'cfr-free', files }]),
    ];
    for (const payload of payloads) {
      expect(readPackedPaths(payload)).toEqual(expected);
    }
  });

  it('passes on this repository, names the runtime assets, and measures a clean build', () => {
    // The guard is run, not only read: a guard that always failed would
    // satisfy every assertion above.
    //
    // The timeout is raised because the guard builds before it packs: the
    // build is a compiler run, not an instant.
    const stale = join(ROOT, 'dist', 'stale-artifact.js');
    mkdirSync(join(ROOT, 'dist'), { recursive: true });
    writeFileSync(stale, '// left over from a build that no longer makes it\n');
    try {
      const out = execFileSync(process.execPath, [VERIFIER_PATH], { encoding: 'utf8' });
      expect(out).toContain('dist/titan/ui-client.js');
      expect(out).toContain('dist/titan/ui-client.css');
      // The whole import CLOSURE, not only the entry point's own imports:
      // a tarball with the entry point but not the module two levels down
      // would fail at runtime, in a stranger's terminal.
      expect(out).toContain('dist/core/store.js');
      // And a clean build: the build does not clean `dist/`, so a file it
      // no longer produces would survive it — and be packed.
      expect(existsSync(stale), 'the guard must not measure a stale build').toBe(false);
    } finally {
      rmSync(stale, { force: true });
    }
  }, 120_000);
});
