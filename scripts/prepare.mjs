#!/usr/bin/env node
/**
 * The `prepare` lifecycle script.
 *
 * WHY THIS EXISTS. `prepare` is what makes the package installable from a
 * git URL: npm runs it while staging the clone, and the `dist/` it produces
 * is packed with the package. Without it, `npm install github:deffenda/
 * cfr-free` succeeds and installs a package whose `dist/cli.js` does not
 * exist — the install reports success and the binary is missing. That was
 * the state of this repository on 2026-10-22, measured against the public
 * remote.
 *
 * `prepare` runs in three very different contexts, and one implementation
 * cannot serve all three. Each case below was measured, not assumed:
 *
 *  1. A LOCAL git install (`npm install github:...` as a project
 *     dependency). npm stages the clone, installs the dev dependencies
 *     into it, and runs `prepare` with `node_modules/` present — so
 *     TypeScript is already there and the ordinary build works.
 *
 *  2. A GLOBAL git install (`npm install -g github:...`). npm stages the
 *     clone and runs `prepare` in a directory with NO `node_modules/`, so
 *     `tsc` cannot be resolved and the ordinary build fails with
 *     `sh: tsc: command not found`. This is an npm behaviour, not a
 *     property of this package: measured on npm 10.9.9 and npm 11.20.0,
 *     `prepare` is invoked with `node_modules/` absent in both.
 *
 *  3. A PRODUCTION install (`npm ci --omit=dev`). npm sets
 *     `npm_config_omit=dev`, and a production install of this package must
 *     NOT run a compiler: the published tarball already contains the built
 *     `dist/`. Running the build here would make a production install
 *     depend on a toolchain it deliberately excluded, and would break
 *     `npm ci --omit=dev` outright.
 *
 * So: a deliberate production install skips the build; otherwise the build
 * runs with the local TypeScript when there is one, and with a
 * freshly-fetched, version-pinned TypeScript when there is not. The pinned
 * version is the same one in `devDependencies`, so the fallback compiles
 * with the same compiler as the checked-in build.
 *
 * The fallback needs the network, exactly as case 2 already did: npm has
 * just cloned the repository over it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** True when npm deliberately omitted the dev dependencies. */
function isProductionInstall() {
  const omit = process.env['npm_config_omit'] ?? '';
  if (omit.split(',').some((entry) => entry.trim() === 'dev')) return true;
  return process.env['npm_config_production'] === 'true';
}

/** The locally installed TypeScript compiler, or null when there is none. */
function localTypeScript() {
  try {
    return require.resolve('typescript/bin/tsc');
  } catch {
    return null;
  }
}

/**
 * Run a command, returning its exit status.
 *
 * The child's stdout goes to THIS script's stderr. npm's stdout is not
 * the program's alone: `npm pack --json` writes its payload there, and
 * whatever a lifecycle script prints joins it in the same stream. npm
 * runs `prepare` during `npm pack` — npm 10.9.9 does so even
 * with --ignore-scripts (measured; npm 11 and 12 honour the flag) — so a line printed to stdout during
 * a pack corrupts that payload, and the release guard cannot tell a
 * broken package from a broken parser. The scripts npm runs therefore
 * write to stderr and leave stdout alone.
 */
function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: ['inherit', process.stderr, 'inherit'],
    ...(env ? { env } : {}),
  });
  if (result.error !== undefined) {
    console.error(`prepare: could not run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Install the project's own dev dependencies into the package directory, so
 * the ordinary build can run.
 *
 * This mirrors what npm itself does for a LOCAL git install — it stages the
 * clone, installs the dev dependencies into it, and only then runs
 * `prepare`. The global path skips that step, which is why this script has
 * to do it. Installing the project's declared dev dependencies (rather than
 * fetching a compiler into a side directory) is what makes the build
 * faithful: `tsconfig.json` sets `"types": ["node"]`, so a compiler without
 * the project's `@types/node` fails with TS2688, and type packages are
 * resolved from the package directory rather than from wherever the
 * compiler was fetched to.
 *
 * `--global=false` is required, not cosmetic: this runs inside npm's
 * global git staging, where `npm_config_global=true` is inherited, and
 * without it the install would land in the GLOBAL node_modules instead of
 * the package's own.
 */
function installDevDependencies() {
  console.error(
    'prepare: no local TypeScript found — installing the dev dependencies to build with',
  );
  const env = { ...process.env, CFR_FREE_PREPARING: '1' };
  // The LOCKED install is preferred. `npm ci` installs exactly the versions
  // the committed lockfile pins and refuses to run when package.json and
  // the lockfile disagree, so the build cannot be fed a version nobody
  // reviewed — and it audits what it installed, which the `--no-audit`
  // install did not: an install that suppressed its own audit cannot
  // report the vulnerability it just fetched.
  const locked = existsSync(fileURLToPath(new URL('../package-lock.json', import.meta.url)));
  const status = locked ? runLockedInstall(env) : runInstall(env);
  if (status === 0) return localTypeScript() !== null;
  if (!locked) return false;
  // `npm ci` refuses to run when the lockfile is out of step with
  // package.json. The install still has to work, so the unlocked install
  // is the fallback — audited, but not locked.
  console.error('prepare: the locked install failed — retrying with an unlocked install');
  return runInstall(env) === 0 && localTypeScript() !== null;
}

/** The locked install: `npm ci` against the committed lockfile. */
function runLockedInstall(env) {
  return run('npm', ['ci', '--include=dev', '--no-fund', '--global=false'], env);
}

/** The unlocked install, for a tree with no lockfile to install from. */
function runInstall(env) {
  return run(
    'npm',
    ['install', '--include=dev', '--no-save', '--no-package-lock', '--no-fund', '--global=false'],
    env,
  );
}

function main() {
  if (process.env['CFR_FREE_PREPARING'] === '1') {
    // The fallback's own `npm install` runs this script again (npm runs
    // `prepare` on install). The parent does the building; this nested run
    // must not start another install.
    return;
  }

  if (isProductionInstall()) {
    // A production install consumes the prebuilt `dist/` in the published
    // tarball. Compiling here would demand a toolchain the install
    // deliberately excluded.
    console.error(
      'prepare: production install — the published tarball ships dist/, skipping the build',
    );
    return;
  }

  let compiler = localTypeScript();
  if (compiler === null && !installDevDependencies()) {
    console.error(
      'prepare: could not obtain a TypeScript compiler to build with. ' +
        'Install the dev dependencies (`npm ci`) and run `npm run build`, ' +
        'or use the published package instead.',
    );
    process.exitCode = 1;
    return;
  }
  compiler = localTypeScript();
  if (compiler === null) {
    console.error(
      'prepare: no TypeScript compiler available after installing the dev dependencies',
    );
    process.exitCode = 1;
    return;
  }

  const status = run(process.execPath, [compiler, '-p', 'tsconfig.build.json']);
  if (status !== 0) {
    process.exitCode = status;
    return;
  }
  // The browser assets are not TypeScript sources, so tsc copies them
  // nowhere: the build copies them into dist/ itself, and a package built
  // without them would serve a 404 for /ui.js.
  const copyAssets = fileURLToPath(new URL('./copy-assets.mjs', import.meta.url));
  process.exitCode = run(process.execPath, [copyAssets]);
}

main();
