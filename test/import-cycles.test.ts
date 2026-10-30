import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The runtime import graph of `src/`.
 *
 * WHY THIS TEST EXISTS. CR-10 found two runtime ESM import cycles:
 * `service.ts` → `diff.ts` → `service.ts` and `service.ts` → `redline.ts` →
 * `service.ts`. They were benign only because `ServiceError` was REFERENCED
 * inside function bodies, so its temporal dead zone was never reached at
 * module-evaluation time. Moving one construction to a module's top level
 * would have made the program throw a ReferenceError at import time — a
 * coincidence, not a guarantee.
 *
 * The fix moved the error types into `src/core/errors.ts`. But a fix that
 * only holds until the next refactor is a fix that decays, and the review
 * noted the deeper smell: a core domain module importing a FACADE module to
 * throw a domain error. So this test pins the property, not the fix: no
 * VALUE import cycle may exist anywhere in `src/`.
 *
 * Type-only imports are erased at compile time, so `import type { X } from
 * './y.js'` cannot cycle at runtime and is not counted here.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/** One module in the import graph. */
interface ModuleNode {
  /** The module's path relative to `src/`, POSIX-style. */
  readonly id: string;
  /** The ids of the modules it imports as VALUES. */
  readonly valueImports: readonly string[];
}

/**
 * Every `.ts`/`.js` file under `src/`, recursively.
 *
 * @returns Absolute file paths.
 */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The value-import specifiers of one source file.
 *
 * Only static `import` statements count. A dynamic `import()` is deferred to
 * runtime and cannot form a module-evaluation-time cycle.
 */
function valueImportsOf(source: string): string[] {
  const specifiers: string[] = [];
  // `import type { X } from './y.js'` is erased — not a runtime edge.
  // `import { type X, Y } from './y.js'` IS a runtime edge: the import
  // statement survives, so the module is loaded.
  const statement = /^\s*import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm;
  for (const match of source.matchAll(statement)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    // A bare `import './y.js'` has no `from` clause and is missed by the
    // pattern above; catch it separately.
    specifiers.push(specifier);
  }
  const bare = /^\s*import\s+'([^']+)'/gm;
  for (const match of source.matchAll(bare)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    specifiers.push(specifier);
  }
  return specifiers;
}

/**
 * The import graph of `src/`, keyed by module id.
 *
 * Only relative specifiers are resolved — a bare package specifier cannot
 * cycle inside this repository.
 */
function buildGraph(): Map<string, ModuleNode> {
  const graph = new Map<string, ModuleNode>();
  const files = sourceFiles(SRC);

  // First pass: every module gets an id, so a specifier can be resolved even
  // when the target sorts after the importer.
  const idOf = new Map<string, string>();
  for (const file of files) {
    const id = path.relative(SRC, file).split(path.sep).join('/');
    idOf.set(file, id);
  }

  for (const file of files) {
    const id = idOf.get(file);
    if (id === undefined) continue;
    const source = readFileSync(file, 'utf8');
    const valueImports: string[] = [];
    for (const specifier of valueImportsOf(source)) {
      if (!specifier.startsWith('.')) continue;
      // `./x.js` is the compiled name of `./x.ts`.
      const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'));
      const targetId = idOf.get(resolved);
      if (targetId === undefined) continue;
      valueImports.push(targetId);
    }
    graph.set(id, { id, valueImports });
  }
  return graph;
}

/**
 * Every cycle in the graph, as a list of module ids forming the loop.
 *
 * A depth-first search with a colour marking (white = unvisited, grey = on
 * the current path, black = fully explored) finds each back edge, and the
 * path from the target back to the current node is the cycle.
 */
function findCycles(graph: Map<string, ModuleNode>): string[][] {
  const cycles: string[][] = [];
  const colour = new Map<string, 'white' | 'grey' | 'black'>();

  const visit = (id: string, path: string[]): void => {
    colour.set(id, 'grey');
    path.push(id);
    const node = graph.get(id);
    for (const next of node?.valueImports ?? []) {
      const state = colour.get(next) ?? 'white';
      if (state === 'grey') {
        // A back edge: the cycle is the slice of the path from `next`.
        const start = path.indexOf(next);
        cycles.push([...path.slice(start), next]);
      } else if (state === 'white') {
        visit(next, path);
      }
    }
    path.pop();
    colour.set(id, 'black');
  };

  for (const id of graph.keys()) {
    if ((colour.get(id) ?? 'white') === 'white') visit(id, []);
  }
  return cycles;
}

describe('the runtime import graph', () => {
  it('has no value-import cycle', () => {
    const cycles = findCycles(buildGraph());
    const rendered = cycles.map((cycle) => cycle.join(' → ')).join('\n');
    expect(rendered).toBe('');
  });

  it('keeps the domain modules free of a facade import', () => {
    // The deeper smell CR-10 named: a core domain module importing a FACADE
    // module (`service.ts`) to throw a domain error. The cycle test above
    // would not catch this if the facade happened to be a leaf, so the
    // dependency direction is pinned directly.
    const graph = buildGraph();
    const domainModules = [
      'core/archive.ts',
      'core/changes.ts',
      'core/citations.ts',
      'core/diff.ts',
      'core/ecfr.ts',
      'core/errors.ts',
      'core/historical.ts',
      'core/http-client.ts',
      'core/point-in-time.ts',
      'core/redline.ts',
      'core/references.ts',
      'core/store.ts',
      'core/structure.ts',
      'core/sync.ts',
      'core/xml.ts',
    ];
    for (const id of domainModules) {
      const node = graph.get(id);
      expect(node, `${id} is not in the import graph`).toBeDefined();
      expect(node?.valueImports ?? [], `${id} imports the service facade`).not.toContain(
        'core/service.ts',
      );
    }
  });

  it('finds a cycle when one exists', () => {
    // A detector that cannot detect anything is not a detector. This pins
    // the test's own instrument against a synthetic cycle.
    const graph = new Map<string, ModuleNode>([
      ['a.ts', { id: 'a.ts', valueImports: ['b.ts'] }],
      ['b.ts', { id: 'b.ts', valueImports: ['a.ts'] }],
    ]);
    const cycles = findCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.join(' ')).toContain('a.ts');
    expect(cycles[0]?.join(' ')).toContain('b.ts');
  });
});
