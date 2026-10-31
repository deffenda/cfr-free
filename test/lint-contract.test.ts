import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The lint contract: `docs/SPEC.md` §7.1 states the rules `eslint.config.mjs`
 * sets, and this test reads BOTH files and fails when they disagree.
 *
 * This exists because the two drifted apart and nothing noticed. The SPEC
 * claimed a complexity ceiling of 10 while the config enforced 15, claimed
 * `no-console` allowed `error` alone while the config allowed `error` and
 * `warn`, and claimed a ban on `child_process` that the config never enforced
 * outside `src/`. The SPEC is the design authority, so a reader trusting it
 * mis-read the gate the code actually runs.
 *
 * The test is deliberately a COMPARISON, not a restatement: it parses the
 * config's own `files:`/`rules:` blocks and the SPEC's own table, and asserts
 * the two agree on the rule set, on every severity, and on every option — a
 * change to either file that the other does not follow fails here. It also
 * pins the two facts the SPEC states in prose: the complexity ceiling the
 * config enforces, and the `src/`-only `child_process` invariant.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

interface LintRule {
  readonly rule: string;
  readonly severity: string;
  readonly options: readonly string[];
}

/** The rules `docs/SPEC.md` §7.1 states, keyed `scope|rule`. */
function specLintRules(): Map<string, LintRule> {
  const spec = readFileSync(path.join(ROOT, 'docs/SPEC.md'), 'utf8');
  const begin = spec.indexOf('<!-- lint-rules:begin -->');
  const end = spec.indexOf('<!-- lint-rules:end -->');
  expect(begin, 'docs/SPEC.md must carry the lint-rules:begin marker').toBeGreaterThan(-1);
  expect(end, 'docs/SPEC.md must carry the lint-rules:end marker').toBeGreaterThan(begin);
  const fence = /```text\n([\s\S]*?)```/.exec(spec.slice(begin, end));
  expect(fence, 'the lint-rules block must be a ```text fence').not.toBeNull();
  const rules = new Map<string, LintRule>();
  for (const row of (fence?.[1] ?? '').split('\n')) {
    const line = row.trim();
    if (line === '') continue;
    const parts = line.split('|').map((cell) => cell.trim());
    expect(parts.length, `a lint-rules row must have 4 cells: ${line}`).toBe(4);
    const [scope, rule, severity, options] = parts;
    if (scope === undefined || rule === undefined || severity === undefined) continue;
    const entry: LintRule = {
      rule,
      severity,
      options: options === undefined || options === '' ? [] : options.split(', '),
    };
    rules.set(`${scope}|${rule}`, entry);
  }
  return rules;
}

/** The rules `eslint.config.mjs` sets, keyed `scope|rule`. */
function configLintRules(): Map<string, LintRule> {
  const source = readFileSync(path.join(ROOT, 'eslint.config.mjs'), 'utf8');
  const shared = sharedRuleObjects(source);
  const rules = new Map<string, LintRule>();
  let scope = '(default)';
  const token = /(files:\s*\[)|(rules:\s*\{)/g;
  let match = token.exec(source);
  while (match !== null) {
    if (match[1] !== undefined) {
      const array = readBalanced(source, token.lastIndex - 1);
      expect(array, 'the files: array must close').not.toBeNull();
      scope = (array?.text ?? '')
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter((entry) => entry !== '')
        .join(', ');
    } else {
      const block = readBalanced(source, token.lastIndex - 1);
      expect(block, 'the rules: block must close').not.toBeNull();
      const text = block?.text ?? '';
      // A block may SPREAD a shared rule object (`...CORRECTNESS_RULES`)
      // instead of repeating the rules. The spread rules are the block's own,
      // at the scope the block sets, so they are expanded before the two
      // sides are compared — otherwise a rule the config really enforces
      // would read as one the config never states.
      const entries = new Map<string, string>();
      for (const spread of text.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
        const sharedEntries = shared.get(spread[1] ?? '');
        expect(
          sharedEntries,
          `the rules: block spreads ${spread[1]}, which the config does not declare`,
        ).toBeDefined();
        for (const [rule, raw] of sharedEntries ?? []) entries.set(rule, raw);
      }
      // The block's own entries come last: they override the spread.
      for (const [rule, raw] of parseEntries(text)) entries.set(rule, raw);
      for (const [rule, raw] of entries) {
        const described = describeValue(raw);
        rules.set(`${scope}|${rule}`, { rule, ...described });
      }
    }
    match = token.exec(source);
  }
  return rules;
}

/**
 * The rule objects the config declares at the top level, keyed by name.
 *
 * The config states the correctness rules ONCE and spreads them into the
 * scopes that enforce them, so a comparison that reads only a block's own
 * entries would miss every rule the spread carries.
 */
function sharedRuleObjects(source: string): Map<string, Map<string, string>> {
  const shared = new Map<string, Map<string, string>>();
  const declaration = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let match = declaration.exec(source);
  while (match !== null) {
    const block = readBalanced(source, declaration.lastIndex - 1);
    expect(block, 'a shared rule object must close').not.toBeNull();
    shared.set(match[1] ?? '', parseEntries(block?.text ?? ''));
    match = declaration.exec(source);
  }
  return shared;
}

/** The text between the bracket at `open` and its matching close. */
function readBalanced(source: string, open: number): { text: string; end: number } | null {
  let depth = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quote !== '') {
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(open + 1, index), end: index + 1 };
    }
  }
  return null;
}

/** The index just past the whitespace and the comments at `index`. */
function skipTrivia(text: string, index: number): number {
  let at = index;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === ' ' || char === '\n' || char === '\t' || char === '\r') {
      at += 1;
      continue;
    }
    if (char === '/' && text.charAt(at + 1) === '/') {
      const newline = text.indexOf('\n', at);
      at = newline === -1 ? text.length : newline + 1;
      continue;
    }
    return at;
  }
  return at;
}

const RULE_KEY = /(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/y;

/** The `key: value` entries of one `rules:` block. */
function parseEntries(block: string): Map<string, string> {
  const entries = new Map<string, string>();
  let index = skipTrivia(block, 0);
  while (index < block.length) {
    RULE_KEY.lastIndex = index;
    const match = RULE_KEY.exec(block);
    if (match === null) {
      index = skipTrivia(block, index + 1);
      continue;
    }
    const name = match[1] ?? match[2] ?? '';
    const value = readValue(block, RULE_KEY.lastIndex);
    if (value === null) {
      index = skipTrivia(block, index + 1);
      continue;
    }
    entries.set(name, value.text);
    index = skipTrivia(block, value.end);
  }
  return entries;
}

/** The raw value that follows a rule key: a quoted string or a `[...]` array. */
function readValue(text: string, index: number): { text: string; end: number } | null {
  const at = skipTrivia(text, index);
  const char = text.charAt(at);
  if (char === "'" || char === '"') {
    const end = text.indexOf(char, at + 1);
    if (end === -1) return null;
    return { text: text.slice(at, end + 1), end: end + 1 };
  }
  if (char === '[') {
    const balanced = readBalanced(text, at);
    if (balanced === null) return null;
    return { text: text.slice(at, balanced.end), end: balanced.end };
  }
  return null;
}

/** A raw ESLint rule value as a severity plus the options it carries. */
function describeValue(raw: string): { severity: string; options: string[] } {
  const parsed = JSON.parse(toJson(raw)) as unknown;
  if (typeof parsed === 'string') return { severity: parsed, options: [] };
  if (!Array.isArray(parsed)) throw new Error(`unsupported ESLint rule value: ${raw}`);
  const severity = typeof parsed[0] === 'string' ? parsed[0] : '';
  const options: string[] = [];
  for (const option of parsed.slice(1)) options.push(...describeOption(option));
  return { severity, options };
}

/**
 * The config's rule values are JavaScript literals, not JSON: the strings are
 * single-quoted, the option objects have bare keys, and the arrays carry a
 * trailing comma. This rewrites those three differences and nothing else, so
 * the value can be read with `JSON.parse`.
 */
function toJson(raw: string): string {
  return raw
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[\]}])/g, '$1');
}

/** One option of a rule value, as the `key=value` the SPEC writes. */
function describeOption(option: unknown): string[] {
  if (option === null || typeof option !== 'object' || Array.isArray(option)) {
    return [String(option)];
  }
  const entries = Object.entries(option as Record<string, unknown>);
  return entries.map(
    ([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`,
  );
}

/** Every `.ts` file under a repository directory. */
function sourceFiles(relativeDir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path.join(relativeDir, entry.name)));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path.join(ROOT, relativeDir, entry.name));
    }
  }
  return found;
}

describe('the lint contract between docs/SPEC.md and eslint.config.mjs', () => {
  it('states every rule the config sets, with the same scope, severity and options', () => {
    const spec = specLintRules();
    const config = configLintRules();
    expect(config.size, 'the config must set rules this test can read').toBeGreaterThan(0);
    expect([...config.keys()].sort()).toEqual([...spec.keys()].sort());
    for (const [key, rule] of config) {
      expect(spec.get(key)?.severity, `severity of ${key}`).toBe(rule.severity);
      expect(spec.get(key)?.options, `options of ${key}`).toEqual([...rule.options]);
    }
  });

  it('states the complexity ceiling the config enforces', () => {
    const complexity = configLintRules().get('**/*.ts|complexity');
    expect(complexity?.severity).toBe('error');
    expect(complexity?.options).toEqual(['15']);
    expect(specLintRules().get('**/*.ts|complexity')?.options).toEqual(['15']);
  });

  it('keeps src/ free of child_process, which is the invariant SPEC §7 states', () => {
    const offenders = sourceFiles('src').filter((file) =>
      /child_process/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('qualifies the child_process claim to src/ in SPEC §7', () => {
    const spec = readFileSync(path.join(ROOT, 'docs/SPEC.md'), 'utf8');
    const section = spec.slice(spec.indexOf('## 7.'), spec.indexOf('## 8.'));
    const line = section.split('\n').find((text) => text.includes('child_process'));
    expect(line, 'SPEC §7 must state the child_process claim').toBeDefined();
    expect(line ?? '', 'the child_process claim must name the scope it holds in').toContain('src/');
  });
});
