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
import { createRequire } from 'node:module';

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

/** Run a command, returning its exit status. */
function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...(env ? { env } : {}) });
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
  console.log('prepare: no local TypeScript found — installing the dev dependencies to build with');
  const env = { ...process.env, CFR_FREE_PREPARING: '1' };
  const status = run(
    'npm',
    [
      'install',
      '--include=dev',
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--global=false',
    ],
    env,
  );
  return status === 0 && localTypeScript() !== null;
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
    console.log(
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

  process.exitCode = run(process.execPath, [compiler, '-p', 'tsconfig.build.json']);
}

main();
