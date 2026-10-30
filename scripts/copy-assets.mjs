#!/usr/bin/env node
/**
 * Copy the runtime assets that are not TypeScript sources.
 *
 * WHY THIS EXISTS. The web UI's page script and stylesheet are real files
 * (`src/titan/ui-client.js`, `src/titan/ui-client.css`) rather than string constants in
 * a TypeScript module, so that eslint and prettier can see them: inside a
 * `String.raw` template literal, 840 lines of browser JavaScript reached
 * no linter, no formatter and no type-checker in the gate. `tsc` compiles
 * TypeScript and copies nothing else, so the build copies these two into
 * `dist/` itself — the server reads them from the directory beside its own
 * module, which is `src/titan/` in development and `dist/titan/` in a
 * build.
 *
 * A build that skipped this step would produce a package whose `/ui.js`
 * route answers 404, and a missing source file would fail here rather
 * than at the first request.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The assets, and where each one lands in `dist/`. Both paths are relative
 * to the repository root. The list is explicit on purpose: an asset that
 * is not copied is a 404 at runtime, and an asset copied from the wrong
 * place is the same 404 with a worse cause.
 */
const ASSETS = [
  { from: 'src/titan/ui-client.js', to: 'dist/titan/ui-client.js' },
  { from: 'src/titan/ui-client.css', to: 'dist/titan/ui-client.css' },
];

for (const asset of ASSETS) {
  const source = join(ROOT, asset.from);
  const target = join(ROOT, asset.to);
  try {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  } catch (error) {
    console.error(
      `copy-assets: could not copy ${asset.from} to ${asset.to}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  // Progress goes to stderr, never to stdout. npm's stdout is not the
  // program's alone: `npm pack --json` writes its payload there, and
  // whatever a lifecycle script prints joins it in the same stream. npm
  // runs `prepare` during `npm pack` — npm 10.9.9 and 12.2.1 do so even
  // with --ignore-scripts (measured) — so a line printed here corrupts
  // that payload, and the release guard cannot tell a broken package
  // from a broken parser.
  console.error(`copy-assets: ${asset.from} -> ${asset.to}`);
}
