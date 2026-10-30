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

/** A semantic version as a comparable triple; the `v` prefix is optional. */
type VersionTriple = readonly [number, number, number];

// A strict three-part version, with no leading zeros — `v01.2.3` and
// `v1.2.3` would otherwise be the same version to `Number()`, and two tags
// would claim it.
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** A release tag: `v` plus a strict three-part version. */
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(raw: string): VersionTriple {
  const match = VERSION_PATTERN.exec(raw);
  if (match === null) {
    throw new Error(`not a vX.Y.Z version: ${raw}`);
  }
  return [Number(match[1] ?? '0'), Number(match[2] ?? '0'), Number(match[3] ?? '0')];
}

function compareVersions(a: VersionTriple, b: VersionTriple): number {
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

interface VersionTag {
  readonly tag: string;
  readonly version: VersionTriple;
}

/**
 * The release tags in a tag list, parsed.
 *
 * Only strict `vX.Y.Z` tags count. A pre-release tag (`v0.3.0-rc.1`) is
 * not a release — it does not claim the version, so it cannot make the
 * manifest's version untag-able — and it is excluded rather than allowed
 * to crash the suite. A tag that is not a version at all (`vnext`) is
 * ignored for the same reason, and a version with a leading zero
 * (`v01.2.3`) is not a version a release could carry.
 */
function parseReleaseTags(tags: readonly string[]): VersionTag[] {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => RELEASE_TAG_PATTERN.test(tag))
    .map((tag) => ({ tag, version: parseVersion(tag) }));
}

/** Every release tag in the checkout. */
function versionTags(): VersionTag[] {
  return parseReleaseTags(git('tag').split('\n'));
}

/** The version the manifest declared at the given tag's commit. */
function manifestVersionAt(tag: string): string {
  const parsed = JSON.parse(git('show', `${tag}:package.json`)) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : '';
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
  // A sha256 digest is EXACTLY 64 LOWERCASE hex characters (32 bytes). The
  // pattern demands all 64 of them and requires the digest to be the END of
  // the image reference, so a truncated digest, a partly-pasted one and an
  // over-long run are all rejected.
  //
  // The digest is ANCHORED to the image operand — the token the FROM
  // instruction actually pulls. It has to BE the end of that reference,
  // and the reference has to be the operand: one token, with the digest on
  // it. A digest that only appears elsewhere on the line — in a trailing
  // comment, in a second token after the image, or in a FROM flag — pins
  // nothing, and the unanchored pattern this replaces accepted it.
  //
  // The shape the guard accepts is therefore:
  //
  //   FROM [--flag ...] <image>@sha256:<64 hex> [AS <alias>]
  //
  // The FROM flags are optional and sit BEFORE the image operand, because
  // a multi-arch build may add `--platform=...` to an already pinned
  // stage. They are flags, not the image, so a token that starts with `--`
  // is never read as the operand. The stage alias is optional and comes
  // AFTER the reference, so it is not part of the reference and does not
  // carry the digest: the alias form still matches.
  //
  // The keyword is matched case-insensitively, because Dockerfile
  // instruction keywords are case-insensitive and the selector that
  // collects the FROM lines matches them that way too: a lowercase
  // `from` line that IS pinned is a valid base image and must not be
  // reported as unpinned.
  //
  // That keyword leniency and the digest's strictness are SEPARATE
  // properties, and only the keyword has it. An OCI digest reference is
  // lowercase by specification: the algorithm is `[a-z0-9]+` and a sha256
  // digest is `[a-f0-9]{64}`. `SHA256:` and uppercase hex therefore name
  // no image at all — such a reference cannot resolve, and it is only
  // discovered at pull or build time, long after the guard that should
  // have caught it. So the digest pattern below is case-STRICT while
  // FROM_KEYWORD stays case-insensitive; folding case for both at once
  // accepted references that can never resolve.
  //
  // The operand is found in two steps rather than by ONE pattern: a
  // pattern that skips the flags needs a repetition inside a repetition,
  // and `security/detect-unsafe-regex` rejects that shape. Splitting it
  // keeps the guard readable and every regex here flat.
  const SHA256_DIGEST_PIN = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

  // A FROM flag: `--name` or `--name=value`, never carrying an `@`, so a
  // digest cannot hide inside one.
  const FROM_FLAG = /^--[^\s@]+$/;

  // The instruction keyword. This is the ONE place in the guard where
  // case is folded: Dockerfile instruction keywords are case-insensitive,
  // so `from`, `From` and `FROM` are all the same instruction. The digest
  // carries no such leniency — see SHA256_DIGEST_PIN above.
  //
  // The stage alias that may follow the reference needs no pattern of its
  // own: the operand is the FIRST token that is not a flag, so nothing
  // after it can be read as the image.
  const FROM_KEYWORD = /^FROM$/i;

  /**
   * The image OPERAND of a FROM line — the token the instruction actually
   * pulls — or an empty string when the line names no image.
   */
  function imageOperand(line: string): string {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 2 || !FROM_KEYWORD.test(tokens[0] ?? '')) return '';

    for (const token of tokens.slice(1)) {
      // Flags sit before the image and are not part of it.
      if (FROM_FLAG.test(token)) continue;
      // A token that starts with `--` is a flag, never the image, even
      // when it carries a digest.
      return token.startsWith('--') ? '' : token;
    }

    return '';
  }

  /**
   * True when the line's image operand is pinned by a sha256 digest of
   * exactly 64 LOWERCASE hex characters.
   */
  function pinsBaseImageByDigest(line: string): boolean {
    const operand = imageOperand(line);
    return operand !== '' && SHA256_DIGEST_PIN.test(operand);
  }

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

  it('pins every base image by digest, so a tag cannot move under a build', () => {
    // A TAG IS A MOVING TARGET: `node:22-alpine` can point at different
    // bytes tomorrow, and every build that follows it then silently ships
    // whatever the tag points at THEN — no failed step, no visible diff,
    // just a base image that changed under a repository whose source did
    // not. That is the failure this guard prevents, and it is silent by
    // construction: nothing in the build reports it. Pinning the digest
    // makes the base image part of the source; the tag stays in the
    // reference so the image remains readable to a human.
    //
    // The assertion is per FROM line and names the offending line, so the
    // failure says WHICH base image lost its pin rather than only that
    // some pin is missing.
    //
    // On the digest LENGTH: a sha256 digest is exactly 64 hex characters
    // (32 bytes), and SHA256_DIGEST_PIN demands all 64 of them at the end
    // of the image reference. A truncated digest, a partly-pasted one and
    // an over-long run therefore all fail this guard.
    //
    // On the digest CASE: the same 64 characters must be LOWERCASE, and
    // the algorithm must be written `sha256`. An OCI digest reference is
    // lowercase by specification, so `SHA256:` or uppercase hex names no
    // image and cannot resolve — it is caught only at pull or build time
    // if this guard lets it through.
    //
    // On the digest POSITION: the digest is checked on the image OPERAND
    // alone, so the digest has to BE the end of the image reference — a
    // digest that only appears elsewhere on the line (a trailing comment,
    // a second token) is not a pin. The optional stage alias (` AS build`)
    // follows the reference and is not part of it, so an aliased FROM line
    // still matches.
    const dockerfile = readRepoFile('Dockerfile');
    const fromLines = dockerfile
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^FROM\s/i.test(line));

    expect(fromLines.length, 'the Dockerfile must declare a FROM line').toBeGreaterThan(0);

    for (const line of fromLines) {
      const operand = imageOperand(line);
      expect(operand, `"${line}" must name the base image it pulls`).not.toBe('');
      expect(
        operand,
        `"${line}" must pin its base image with an @sha256: digest of exactly 64 lowercase hex characters on the image reference`,
      ).toMatch(SHA256_DIGEST_PIN);
    }
  });

  it('keeps both stages of the shipped Dockerfile pinned, with and without an alias', () => {
    // The guard above is only as good as the Dockerfile it reads. The
    // shipped file uses both FROM shapes — the build stage carries an
    // alias, the runtime stage does not — and both must keep passing
    // under the anchored guard.
    const dockerfile = readRepoFile('Dockerfile');
    const fromLines = dockerfile
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^FROM\s/i.test(line));

    const aliased = fromLines.filter((line) => /\sAS\s+\S+$/i.test(line));
    const plain = fromLines.filter((line) => !/\sAS\s/i.test(line));

    expect(aliased.length, 'the build stage must carry an alias').toBeGreaterThan(0);
    expect(plain.length, 'the runtime stage must carry no alias').toBeGreaterThan(0);

    for (const line of fromLines) {
      const operand = imageOperand(line);
      expect(operand, `"${line}" must pin its base image by digest`).toMatch(SHA256_DIGEST_PIN);
    }
  });

  it('rejects a digest that is not part of the image reference', () => {
    // A digest that only appears in a comment, or in a token that is not
    // the image reference, pins NOTHING: the build still pulls a tag that
    // can move. The unanchored pattern this replaces matched the digest
    // anywhere on the line and accepted every one of these.
    const digest = 'a'.repeat(64);

    // The digest sits in a trailing comment.
    expect(pinsBaseImageByDigest(`FROM node:22-alpine # @sha256:${digest}`)).toBe(false);

    // The digest sits in a second token, after the image.
    expect(pinsBaseImageByDigest(`FROM node:22-alpine @sha256:${digest}`)).toBe(false);
    expect(pinsBaseImageByDigest(`FROM node:22-alpine other@sha256:${digest}`)).toBe(false);

    // The digest sits in a FROM flag, where there is no image operand at
    // all: a flag is not the image, so it cannot carry the pin.
    expect(pinsBaseImageByDigest(`FROM --platform=@sha256:${digest}`)).toBe(false);
  });

  it('rejects a tag-only base image, so a pin cannot be lost', () => {
    // A FROM line with no digest at all is the failure this guard exists
    // for: the tag is free to move under the next build, silently.
    expect(pinsBaseImageByDigest('FROM node:22-alpine')).toBe(false);
    expect(pinsBaseImageByDigest('FROM node:22-alpine AS build')).toBe(false);
  });

  it('rejects a digest that is not exactly 64 hex characters', () => {
    // A guard that lets a truncated digest through is not a guard. An
    // earlier version of this pattern accepted every truncation down to 40
    // hex characters, and a truncated digest resolves to no image at all.
    // The guard demands all 64 of them, on the image reference.
    const from = (hex: string): string => `FROM node:22-alpine@sha256:${hex}`;
    expect(pinsBaseImageByDigest(from('a'.repeat(64)))).toBe(true);
    expect(pinsBaseImageByDigest(from('a'.repeat(40)))).toBe(false);
    expect(pinsBaseImageByDigest(from('a'.repeat(63)))).toBe(false);
    expect(pinsBaseImageByDigest(from('a'.repeat(65)))).toBe(false);
    expect(pinsBaseImageByDigest(from('a'.repeat(64) + 'g'))).toBe(false);
  });

  it('rejects a digest that is not lowercase, because such a reference cannot resolve', () => {
    // An OCI digest reference is LOWERCASE by specification: the algorithm
    // is `[a-z0-9]+` and a sha256 digest is `[a-f0-9]{64}`. A reference
    // written with an upper-case algorithm or upper-case hex names no
    // image at all, so it cannot resolve — the only sign that it is wrong
    // is a failure at pull or build time, long after the guard that
    // should have caught it. The pattern used to fold case for the digest
    // and the keyword together, and accepted every one of these.
    //
    // Each assertion names the offending line, so a failure says WHICH
    // reference was wrongly accepted.
    const digest = 'a'.repeat(64);

    // The algorithm is written in upper case.
    const upperAlgorithm = `FROM node:22-alpine@SHA256:${digest}`;
    expect(
      pinsBaseImageByDigest(upperAlgorithm),
      `"${upperAlgorithm}" must not be accepted: the digest algorithm is lowercase by spec`,
    ).toBe(false);

    // The digest hex is written in upper case.
    const upperHex = `FROM node:22-alpine@sha256:${'A'.repeat(64)}`;
    expect(
      pinsBaseImageByDigest(upperHex),
      `"${upperHex}" must not be accepted: a sha256 digest is lowercase hex by spec`,
    ).toBe(false);

    // Both at once, on an aliased stage: the alias does not rescue it.
    const both = `FROM node:22-alpine@SHA256:${'A'.repeat(64)} AS build`;
    expect(
      pinsBaseImageByDigest(both),
      `"${both}" must not be accepted: an OCI digest reference is lowercase by spec`,
    ).toBe(false);
  });

  it('accepts a digest followed by whitespace, so a stage alias still matches', () => {
    // The boundary accepts on the whitespace side as well as on the
    // end-of-the-line side: the build stage's FROM line puts an alias
    // after its digest, so a digest followed by a space must still match —
    // the space is a boundary, never part of the digest.
    const digest = 'a'.repeat(64);
    expect(pinsBaseImageByDigest(`FROM node:22-alpine@sha256:${digest} AS build`)).toBe(true);
    // A trailing comment after a pinned image is still a pinned image: the
    // digest is on the operand, and the space after it is a boundary.
    expect(pinsBaseImageByDigest(`FROM node:22-alpine@sha256:${digest} # pinned`)).toBe(true);
  });

  it('accepts a lowercase from, because Dockerfile keywords are case-insensitive', () => {
    // Dockerfile instruction keywords are case-insensitive, and the
    // selector that collects the FROM lines matches them that way too. A
    // lowercase `from` whose image IS pinned is a valid base image, so
    // this guard must not report it as unpinned and turn a correct
    // Dockerfile red over its capitalisation. The digest on those lines
    // is lowercase, as it must be: the keyword's leniency is not the
    // digest's.
    const digest = 'a'.repeat(64);
    expect(pinsBaseImageByDigest(`from node:22-alpine@sha256:${digest}`)).toBe(true);
    expect(pinsBaseImageByDigest(`from node:22-alpine@sha256:${digest} as build`)).toBe(true);
  });

  it('keeps the keyword case-insensitive without making the digest case-insensitive', () => {
    // The keyword's leniency and the digest's strictness are SEPARATE
    // properties, and the guard has to keep them separate. Dockerfile
    // instruction keywords are case-insensitive, so `from` and `From` are
    // the same instruction and their pinned images are valid base images.
    // The digest carries none of that leniency — it is lowercase by
    // specification. Folding case for both at once reported a lowercase
    // `from` with an upper-case digest as pinned, which is a reference
    // that can never resolve.
    const digest = 'a'.repeat(64);
    const upperDigest = 'A'.repeat(64);

    // A lowercase keyword with a valid lowercase digest passes, with and
    // without a stage alias.
    expect(pinsBaseImageByDigest(`from node:22-alpine@sha256:${digest}`)).toBe(true);
    expect(pinsBaseImageByDigest(`from node:22-alpine@sha256:${digest} as build`)).toBe(true);

    // A mixed-case keyword is the same instruction, and still passes.
    expect(pinsBaseImageByDigest(`From node:22-alpine@sha256:${digest}`)).toBe(true);

    // The same lowercase keyword with an upper-case digest does not, with
    // or without a stage alias.
    expect(pinsBaseImageByDigest(`from node:22-alpine@sha256:${upperDigest}`)).toBe(false);
    expect(pinsBaseImageByDigest(`from node:22-alpine@sha256:${upperDigest} as build`)).toBe(false);
  });

  it('accepts a FROM flag before a pinned image, because a multi-arch build may add one', () => {
    // `FROM --platform=linux/amd64 node:22-alpine@sha256:<64 hex>` is a
    // valid, pinned stage: the flag belongs to the FROM instruction, and
    // the digest still belongs to the image operand. The anchor has to
    // allow the flag without letting the flag carry the digest itself.
    const digest = 'a'.repeat(64);
    const image = `node:22-alpine@sha256:${digest}`;
    expect(pinsBaseImageByDigest(`FROM --platform=linux/amd64 ${image}`)).toBe(true);
    expect(pinsBaseImageByDigest(`FROM --platform=linux/amd64 ${image} AS build`)).toBe(true);
    // A flag does not make an unpinned image acceptable.
    expect(pinsBaseImageByDigest('FROM --platform=linux/amd64 node:22-alpine')).toBe(false);
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
    //
    // The assertion is scoped to the `gh release create` invocation, not to
    // the file: the same filename also appears in the release notes, and a
    // plain `toContain` would stay green if the UPLOAD argument were
    // renamed while the documentation kept the name.
    expect(workflow).toMatch(/\n\s+gh release create[\s\S]*?\n\s*"cfr-free-\$\{PKG\}\.tgz"/);
  });

  it('will not create a tag that is missing', () => {
    // `gh release create` creates a tag from the default branch when the
    // given tag does not exist, which would attach the built bytes to the
    // wrong commit. The tag is always present here, so `--verify-tag` only
    // turns a silent wrong-artifact path into a loud failure.
    //
    // The match is anchored to the COMMAND line: the explanatory comment
    // above it names `gh release create` and `--verify-tag` too, so an
    // unanchored match would be satisfied by the prose and would stay
    // green if the flag were dropped from the command.
    const invocation = workflow.match(/\n\s+gh release create[\s\S]*?cfr-free-\$\{PKG\}\.tgz"/);
    expect(invocation).not.toBeNull();
    expect(invocation?.[0]).toContain('--verify-tag');
  });

  it('refuses to release a tag that disagrees with the manifest', () => {
    // The same guard the npm job uses: the tag and package.json must agree,
    // or the release would carry a version the manifest does not claim.
    //
    // Scoped to THIS job: the npm job carries the identical message, so a
    // whole-file `toContain` would stay green if this job's guard were
    // deleted outright.
    const job = workflow.match(/\n {2}github-release:[\s\S]*?(?=\n {2}[a-z-]+:|\n {2}# Preserved)/);
    expect(job).not.toBeNull();
    expect(job?.[0]).toContain('bump package.json before tagging');
  });
});

describe('the release guard', () => {
  it('reads only strict release tags out of a tag list', () => {
    // A tag that is not a release version must not crash the suite: the
    // guard runs on every commit, and a pre-release tag (`v0.3.0-rc.1`) or
    // a non-version tag (`vnext`) is a thing a repository can legitimately
    // have. A leading zero is not a version a release could carry, and
    // `Number('01')` is `1`, so `v01.2.3` would collide with `v1.2.3`.
    expect(parseReleaseTags(['v0.3.0-rc.1', 'vnext', 'v1.0', 'v1.0.0+build', 'v01.2.3'])).toEqual(
      [],
    );
    expect(parseReleaseTags(['v0.2.1', 'v0.3.0']).map((tag) => tag.tag)).toEqual([
      'v0.2.1',
      'v0.3.0',
    ]);
    expect(parseReleaseTags(['v0.2.1'])[0]?.version).toEqual([0, 2, 1]);
  });

  it('has the tags it needs to judge the version', () => {
    // Every check below reads the tag list, so an EMPTY tag list makes them
    // vacuous — they would all pass while asserting nothing. That is not a
    // hypothetical: `actions/checkout` clones with `--depth 1` by default and
    // fetches no tags, so in CI this guard never ran (verified against the
    // public repository on 2026-10-29: a depth-1 clone reports zero tags).
    // The gate must therefore FAIL on an empty tag list rather than pass
    // silently; the workflows that run it check out with `fetch-depth: 0`.
    const tags = versionTags();
    expect(
      tags.length,
      'no release tag (vX.Y.Z) found in this checkout — the release guard cannot ' +
        'run. A checkout without tags (actions/checkout defaults to --depth 1) makes ' +
        'every check below vacuous, so the suite fails instead of passing silently. ' +
        'CI must check out with fetch-depth: 0; a shallow local clone needs ' +
        '`git fetch --tags`.',
    ).toBeGreaterThan(0);
  });

  it('declares a version past every released tag', () => {
    // The release workflow refuses to publish when the tag and package.json
    // disagree: `test "$TAG" = "$PKG"`. A version that an existing tag
    // already uses cannot be re-tagged, so the next release would have to
    // fail the guard. This happened: the tag v0.2.0 was cut while
    // package.json still said 0.1.0, so the tree at that tag says 0.1.0
    // while `main` says 0.2.0 — and the next tag could satisfy neither.
    // The version must therefore move PAST every released tag.
    //
    // The invariant is stated against the NEWEST release, not against every
    // tag. An earlier form — "the version must differ from every tag" —
    // contradicted the release workflow: release.yml requires
    // `tag == package.json` at the moment of release and a release changes
    // no file, so `main` is guaranteed to hold `version == latest tag`
    // between releases, exactly the state that form forbade. The gate was
    // therefore red locally (0.2.1 against tag v0.2.1) and green in CI
    // (where it never ran at all).
    //
    // What the version may equal, then, is the newest release's version —
    // on ONE tree: the commit that release was cut from. The release itself
    // (a tag push) checks out exactly that commit, so the release run and
    // the tree it published agree; once anything else lands on `main`, the
    // version must move past it again. The tag must also be self-consistent
    // — its tree must have declared the same version — or the release that
    // tag names is not the release this manifest describes (the v0.2.0
    // failure above).
    const manifest = readManifest();
    const version = manifest.version ?? '';
    expect(version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    const current = parseVersion(version);

    const releasingTag =
      process.env.GITHUB_REF_TYPE === 'tag' ? (process.env.GITHUB_REF_NAME ?? '') : '';
    if (releasingTag) {
      // On the release run itself the manifest must be exactly the tag being
      // released — the invariant the workflow enforces.
      expect(releasingTag).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(version).toBe(releasingTag.slice(1));
    }

    const tags = versionTags();
    expect(
      tags.length,
      'no release tag (vX.Y.Z) found in this checkout — the release guard cannot ' +
        'run; see the companion assertion in this describe block.',
    ).toBeGreaterThan(0);

    const newest = tags.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
    const relation = compareVersions(current, newest.version);

    if (relation < 0) {
      throw new Error(
        `package.json ${version} is BEHIND the released tag ${newest.tag} — the version ` +
          'must move forward; a release cannot reuse or rewind a published version.',
      );
    }

    if (relation === 0) {
      // The manifest declares the newest release's version. That is
      // legitimate only on the tree the release was cut from.
      const atTag = manifestVersionAt(newest.tag);
      if (atTag !== version) {
        throw new Error(
          `tag ${newest.tag} was cut from a tree whose package.json says ${atTag}, not ` +
            `${version} — the release names a version this manifest does not declare.`,
        );
      }
      const head = git('rev-parse', 'HEAD').trim();
      const tagCommit = git('rev-parse', `${newest.tag}^{commit}`).trim();
      if (head !== tagCommit) {
        throw new Error(
          `package.json ${version} is the version of the released tag ${newest.tag}, but ` +
            'this tree is not the commit that release was cut from — bump package.json to ' +
            `a version above ${newest.tag.slice(1)} before publishing again.`,
        );
      }
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
