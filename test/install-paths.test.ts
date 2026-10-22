import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The install contract: what a person who has never seen this repository
 * must be able to do, and what must not silently break.
 *
 * This exists because the distribution paths were BROKEN in a way no other
 * gate could see, measured on 2026-10-22 against the public repository:
 *
 * - `npm install -g cfr-free` resolved to NOTHING: the npm registry returns
 *   404 for the package, and the release workflow's npm job is gated behind
 *   an operator-only trusted-publishing registration. The README led with
 *   that command.
 * - `npm install github:deffenda/cfr-free` SUCCEEDED and installed a
 *   PACKAGE WITH NO `dist/` — `dist/` is gitignored, and the manifest had
 *   no `prepare` script, so nothing was compiled. The install reported
 *   success and the binary did not exist. This is the worst failure shape:
 *   it looks like it worked.
 * - `npx github:deffenda/cfr-free` failed the same way.
 * - The repository had NO GitHub releases, so the releases page was empty and
 *   there was no tarball to download.
 * - The container image on GHCR was anonymously pullable, but nothing in the
 *   README's first screen pointed at it.
 *
 * The fix is the `prepare` script (`scripts/prepare.mjs`): npm runs it when
 * installing from a git URL, and it builds `dist/` before the package is
 * packed. The assertions below pin the parts of that contract which are
 * code rather than prose, so the next edit that removes `prepare`, renames
 * the bin, breaks the script, or forgets the packed file list fails here
 * instead of in a stranger's terminal.
 *
 * The file list is read from the repository root, so this test asserts on
 * the TEXT of four other files (`package.json`, `src/cli.ts`, `Dockerfile`,
 * `scripts/prepare.mjs`). That is deliberate: each assertion below is about
 * an INTER-FILE contract that no single-file test can see, and each names
 * the file it reads.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly bin?: Record<string, string>;
  readonly files?: readonly string[];
  readonly scripts?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageManifest;
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('the npm manifest', () => {
  it('builds on prepare, so a git install ships a working binary', () => {
    // npm runs `prepare` when a package is installed from a git URL, and
    // the build output is then packed with it. Without this script, a git
    // install succeeds and produces a package whose `bin` does not exist.
    expect(readManifest().scripts?.['prepare']).toBe('node scripts/prepare.mjs');
  });

  it('packs the built output, the prepare script, the licence and the readme', () => {
    // `dist` is gitignored, but an explicit `files` entry overrides that
    // for packing — so the published tarball still carries the binary. The
    // prepare script travels with it, because npm may run `prepare` from
    // the packed tree on some npm versions.
    const files = readManifest().files ?? [];
    expect(files).toContain('dist');
    expect(files).toContain('scripts/prepare.mjs');
    expect(files).toContain('README.md');
    expect(files).toContain('LICENSE');
  });

  it('points the executable at a file the build produces', () => {
    // The bin path and the build output directory must agree, or the
    // installed symlink dangles. The build writes `dist/` (tsconfig.build.
    // json's outDir) and the manifest's bin must live inside it.
    const bin = readManifest().bin?.['cfr-free'];
    expect(bin).toBe('dist/cli.js');
  });
});

describe('the CLI entry point', () => {
  it('starts with a node shebang, so the packed bin is executable', () => {
    // npm links the bin and relies on this line to exec it. A shebang lost
    // in a refactor produces an installed command that fails with a syntax
    // error rather than a missing-file error.
    expect(readRepoFile('src/cli.ts').startsWith('#!/usr/bin/env node')).toBe(true);
  });
});

describe('the prepare script', () => {
  const script = readRepoFile('scripts/prepare.mjs');

  it('skips the build in a production install, where no compiler is present', () => {
    // `npm ci --omit=dev` sets npm_config_omit=dev. A production install
    // consumes the prebuilt dist/ in the published tarball, so running a
    // compiler there would demand the toolchain the install deliberately
    // excluded — and broke `npm ci --omit=dev` outright when `prepare` was
    // an unconditional build.
    expect(script).toContain('npm_config_omit');
    expect(script).toContain('npm_config_production');
  });

  it('can build without a locally installed TypeScript', () => {
    // npm runs `prepare` in a staging directory with NO node_modules/ for
    // a GLOBAL git install, so `tsc` cannot be resolved there. The script
    // must therefore be able to obtain a compiler by itself, or the global
    // install fails with `sh: tsc: command not found`. It installs the
    // project's OWN dev dependencies — the same ones npm installs for a
    // local git install — so the fallback build is the checked-in build.
    expect(script).toContain('typescript/bin/tsc');
    expect(script).toContain("'install'");
    expect(script).toContain('--include=dev');
  });

  it('guards against the fallback install recursing into itself', () => {
    // npm runs `prepare` on every install, so the fallback's own
    // `npm install` would run this script again, which would start another
    // install, forever.
    expect(script).toContain('CFR_FREE_PREPARING');
  });

  it('installs the dev dependencies locally, not into the global prefix', () => {
    // The fallback runs inside npm's GLOBAL git staging, where
    // `npm_config_global=true` is inherited. Without `--global=false` the
    // install lands in the global node_modules instead of the package's
    // own, and the compiler is still not where the build looks for it.
    //
    // The pattern matches the QUOTED argument, not the prose above it: a
    // plain `toContain('--global=false')` would also be satisfied by the
    // explanatory comment, so deleting the flag would leave the test green.
    expect(script).toMatch(/'--global=false'/);
  });

  it("builds with the project's own compiler and tsconfig", () => {
    // The fallback installs the project's own dev dependencies, so it
    // compiles with the same pinned TypeScript as the checked-in build
    // rather than a version of its own choosing.
    const manifest = readManifest();
    expect(manifest.scripts?.['build']).toContain('tsconfig.build.json');
    expect(manifest.devDependencies?.['typescript']).toBe('5.9.3');
  });
});

describe('the container build', () => {
  it('installs without running prepare, because it copies src afterwards', () => {
    // The Docker build copies the manifest, installs, and only THEN copies
    // `src/`. If the install ran `prepare`, the TypeScript build would run
    // against an empty source tree and fail the image build. The explicit
    // `npm run build` after the copy is the build that ships.
    const dockerfile = readRepoFile('Dockerfile');
    expect(dockerfile).toContain('npm ci --ignore-scripts');

    const installIndex = dockerfile.indexOf('npm ci --ignore-scripts');
    const copyIndex = dockerfile.indexOf('COPY src');
    expect(installIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeGreaterThan(installIndex);
  });
});

describe('the workflows', () => {
  it('installs without running prepare everywhere it installs', () => {
    // `prepare` builds, and each of these jobs builds explicitly (or does
    // not need a build). Running it during install would build twice, and
    // in the Docker stage it would build against an empty source tree.
    const workflowDir = path.join(ROOT, '.github', 'workflows');
    for (const file of ['ci.yml', 'release.yml', 'live-e2e.yml']) {
      const contents = readFileSync(path.join(workflowDir, file), 'utf8');
      for (const line of contents.split('\n')) {
        if (!line.includes('npm ci')) continue;
        expect(line, `${file}: "${line.trim()}" must use --ignore-scripts`).toContain(
          '--ignore-scripts',
        );
      }
    }
  });
});

describe('the release workflow', () => {
  const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

  it('publishes a GitHub Release with the tarball attached', () => {
    // The repository had two tags and NO GitHub releases, so the releases
    // page was empty: a tag published an image to GHCR and (behind an
    // operator-only gate) a package to npm, but there was no downloadable
    // artifact. This job puts the packed tarball on the tag's release, which
    // is the one install route needing neither a registry nor a compiler.
    expect(workflow).toContain('github-release:');
    expect(workflow).toContain('gh release create');
    expect(workflow).toContain('contents: write');
  });

  it('attaches the tarball the npm job would publish', () => {
    // Both jobs must pack the SAME artifact, or the release and the
    // registry could ship different bytes.
    const packs = workflow.match(/npm pack --pack-destination/g) ?? [];
    expect(packs.length).toBeGreaterThanOrEqual(1);
    expect(workflow).toContain('cfr-free-${PKG}.tgz');
  });

  it('refuses to release a tag that disagrees with the manifest', () => {
    // The same guard the npm job uses: the tag and package.json must agree,
    // or the release would carry a version the manifest does not claim.
    expect(workflow).toContain('bump package.json before tagging');
  });
});

describe('the release guard', () => {
  it('declares a version that is not already taken by a tag', () => {
    // The release workflow refuses to publish when the tag and package.json
    // disagree: `test "$TAG" = "$PKG"`. A version that an existing tag
    // already uses cannot be re-tagged, so the next release would have to
    // fail the guard. This happened: the tag v0.2.0 was cut while
    // package.json still said 0.1.0, so the tree at that tag says 0.1.0
    // while `main` says 0.2.0 — and the next tag could satisfy neither.
    // The version must therefore move PAST every existing tag.
    const manifest = readManifest();
    const version = manifest.version ?? '';
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);

    const tags = execFileSync('git', ['tag'], { encoding: 'utf8' })
      .split('\n')
      .map((tag) => tag.trim())
      .filter((tag) => tag.startsWith('v'));
    for (const tag of tags) {
      const tagged = tag.slice(1);
      expect(version, `package.json ${version} is already used by tag ${tag}`).not.toBe(tagged);
    }
  });
});

describe('the packed artifact', () => {
  it('contains the executable, its imports, the prepare script and the readme', () => {
    // The release workflow packs the tarball and checks the same thing
    // before publishing, so a broken `files` list must fail here first.
    //
    // The pack runs in a SYNTHETIC tree rather than in the checkout: the
    // `files` allowlist is what is under test, and the checkout's `dist/`
    // does not exist at this point in CI (the test run precedes the build
    // step in `npm run ci`), so packing the checkout would test the
    // checkout's build state instead of the manifest.
    const staging = mkdtempSync(path.join(tmpdir(), 'cfr-free-pack-'));
    try {
      writeFileSync(
        path.join(staging, 'package.json'),
        readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
      );
      writeFileSync(path.join(staging, 'README.md'), '# stub\n');
      writeFileSync(path.join(staging, 'LICENSE'), 'MIT\n');
      mkdirSync(path.join(staging, 'dist'), { recursive: true });
      writeFileSync(path.join(staging, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
      // `dist/config.js` stands in for a real import of the entry point
      // (`src/cli.ts` imports './config.js'). npm ALWAYS force-includes the
      // `bin` target, so asserting only on `dist/cli.js` could not fail
      // however the `files` list was broken — this one can.
      writeFileSync(path.join(staging, 'dist', 'config.js'), '// stub\n');
      mkdirSync(path.join(staging, 'scripts'), { recursive: true });
      writeFileSync(path.join(staging, 'scripts', 'prepare.mjs'), '// stub\n');

      const output = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
        cwd: staging,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parsed = JSON.parse(output) as Array<{ files?: Array<{ path: string }> }>;
      const paths = (parsed[0]?.files ?? []).map((file) => file.path);
      expect(paths).toContain('dist/cli.js');
      expect(paths).toContain('dist/config.js');
      expect(paths).toContain('scripts/prepare.mjs');
      expect(paths).toContain('package.json');
      expect(paths).toContain('README.md');
      expect(paths).toContain('LICENSE');
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
});
