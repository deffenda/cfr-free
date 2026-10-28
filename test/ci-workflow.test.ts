import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The CI workflow, the local gate, and branch protection must not drift.
 *
 * Three facts are load-bearing, and all three fail silently:
 *
 *  1. Branch protection on `main` requires the checks `quality (22)`,
 *     `quality (24)` and `security` (read from
 *     `repos/deffenda/cfr-free/branches/main/protection` on 2026-10-22).
 *     A renamed job or a matrix that no longer contains a named version
 *     removes a required check, and GitHub then waits forever for a check
 *     that will never report: the pull request can never go green.
 *  2. The `quality` job must run the same commands, in the same order, as
 *     `npm run ci`. That script is the local gate; once the two diverge,
 *     "green locally" stops meaning "green in CI", and the divergence is
 *     invisible until a merge fails.
 *  3. Those commands are split into one step each so a failure names
 *     itself. Four of the five CI failures in the week to 2026-10-22
 *     surfaced only as "Run npm run ci", sending the reader back to a
 *     local reproduction to learn which sub-step broke. Folding them back
 *     into one step restores that blindness.
 *
 * This reads the workflow as text rather than parsing YAML: the file is
 * owned by this repo, the assertions are about specific lines, and a text
 * guard needs no dependency. The cost is that a reformat which changes the
 * matched lines fails the guard — which is the intended behaviour for a
 * file whose exact step list is the contract.
 *
 * WHAT THIS CANNOT SEE, learned the hard way on 2026-10-22: a workflow
 * that is valid YAML but invalid to GitHub's expression parser. A
 * job-level `if` cannot reference the `matrix` context, and the first
 * draft of this change did exactly that. YAML accepted it, prettier
 * accepted it, this guard accepted it — and GitHub answered with a failed
 * run carrying zero jobs, which also meant no pull request check ever
 * reported. Only GitHub's parser rules that out; `actionlint` would catch
 * it locally, and adding it is an install the operator has to approve.
 */

const WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url));
const WORKFLOWS_DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

/** The checks branch protection on `main` requires. Keep in step with it. */
const REQUIRED_CHECKS = ['quality (22)', 'quality (24)', 'security'] as const;

const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
  scripts: Record<string, string>;
};

/** Every workflow file in `.github/workflows`, in a stable order. */
const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map((name) => ({ name, path: join(WORKFLOWS_DIR, name) }));

/**
 * An action reference pinned to a full commit SHA: `owner/repo@<40 hex>`.
 * The path may carry extra segments for an action that lives in a
 * subdirectory (`google/osv-scanner-action/osv-scanner-action`).
 */
const PINNED_ACTION = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;

/** The `npm run …` steps of `npm run ci`, in order. */
function localGateCommands(script: string): string[] {
  return script
    .split('&&')
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .map((step) => step.replace(/^npm run /, ''));
}

/** The `run: npm run …` steps of a workflow text, in file order. */
function workflowRunSteps(text: string): string[] {
  return [...text.matchAll(/^\s+run: npm run (\S+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * The version lists a `node:` matrix line expands to, in source order: the
 * first entry is what a `pull_request` run gets, the second what the other
 * events get. A literal `node: [22, 24]` yields a single entry and no arms.
 */
function matrixArms(text: string): string[][] {
  const line = /^\s+node: .*$/m.exec(text)?.[0] ?? '';
  return [...line.matchAll(/fromJSON\('(\[[^']*\])'\)/g)].map((match) => {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
}

/** Every node version the `quality` matrix can expand to, however written. */
function matrixNodes(text: string): string[] {
  const literal = /^\s+node: \[([^\]]+)\]\s*$/m.exec(text)?.[1];
  if (literal !== undefined) {
    return literal
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return matrixArms(text).flat();
}

/**
 * The versions a `pull_request` run gets — the arm that has to carry every
 * check branch protection requires. Deliberately not the union: a version
 * present only in the push arm would still be missing from the pull request
 * that branch protection is waiting on.
 */
function pullRequestNodes(text: string): string[] {
  const literal = /^\s+node: \[([^\]]+)\]\s*$/m.exec(text)?.[1];
  if (literal !== undefined) {
    return literal
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return matrixArms(text)[0] ?? [];
}

/**
 * The `uses:` keys of a workflow, in file order: the action reference and
 * the whole line, so a failure can name the line that is wrong.
 *
 * The key is matched wherever it sits on the line — a block step
 * (`- uses: …`), a flow mapping (`- { uses: … }`) or a quoted key
 * (`"uses": …`) — so a step spelled any of those ways cannot slip past
 * the pin guard.
 *
 * A key with an empty value is the multi-line plain scalar: YAML reads
 * the reference from the following, more indented line, and GitHub runs
 * the step. The guard follows the value across the line break, or an
 * unpinned action hides behind a line break instead of behind a tag. The
 * entry then names the continuation line — the line a human has to edit —
 * and the reference is reported once, never twice.
 *
 * A comment-only line is not a step: a line whose trimmed text starts
 * with `#` yields no entries at all, so a commented-out reference (say
 * `# - uses: actions/checkout@v4`) is documentation and not an action
 * the workflow runs. Flagging it would fail a workflow whose every real
 * step is pinned, and the guard's message would name a line that does
 * nothing. The fail-closed property is kept for actual steps: an
 * unpinned block step or flow mapping is still caught.
 *
 * An inline comment ends the line for matching purposes: everything
 * from the first `#` that opens a comment is dropped before the
 * references are extracted and before the empty-value test, so
 * `- uses: # note` behaves exactly like `- uses:` — no same-line
 * reference, then the continuation rule above. The strip is
 * quote-aware, because a `#` inside a quoted scalar is text and not a
 * comment: in the flow mapping `- { name: "build #1", uses:
 * some/action@v1 }` the `#` sits inside `"build #1"`, and truncating
 * there would lose the `uses` key and let an unpinned action escape
 * the guard. A `#` with no whitespace before it is part of the value
 * (`org/action@v4#frag` keeps the whole token), and a trailing comment
 * after a real value keeps reporting the value.
 *
 * A `uses` value that is a YAML block-scalar header (`|`, `|-`, `|+`,
 * `>`, `>-`, with optional chomping and indentation digits) names no
 * action on its own line: the value sits on the following indented
 * lines. The header is the empty-value form — no same-line reference,
 * the continuation rule applies — and the entry names the line that
 * carries the reference.
 */

/** A `uses` key with its reference on the same line. */
const USES_WITH_REFERENCE = /(?:^|[^\w-])["']?uses["']?\s*:\s*([^\s,}\]]+)/g;

/** A `uses` key with an empty value: the reference is on the next line. */
const USES_EMPTY_VALUE = /(?:^|[^\w-])["']?uses["']?\s*:\s*$/;

/**
 * A YAML block-scalar header: `|` or `>` followed by any mix of chomping
 * (`+`, `-`) and indentation digits. The suffix is deliberately loose —
 * over-accepting a malformed suffix is safe because the header only
 * selects the continuation rule, and real YAML validation is not this
 * test's job. The value sits on the following indented lines, so the
 * header itself names no action.
 */
const BLOCK_SCALAR_HEADER = /^[|>][-+\d]*$/;

/**
 * The line with its inline comment removed: everything from the first
 * `#` that opens a comment, or the whole trimmed line when none does.
 *
 * A `#` opens a comment only outside every quoted scalar and only at the
 * start of the line or after whitespace, so `org/action@v4#frag` keeps
 * its `#frag` while `- uses: # note` strips to `- uses:`. Quote rules:
 * a `"` or `'` outside any region opens a region of that kind only where
 * YAML can start a quoted scalar — at the start of the line, after
 * whitespace, or after a flow indicator (`[`, `{`, `,`, `:`) — so an
 * apostrophe inside a plain scalar (`it's`) is text, not an opener; the
 * matching quote closes the region; the other quote character is
 * literal text inside a region; inside `"…"` a backslash escapes the
 * next character; inside `'…'` a doubled `''` is one escaped quote —
 * the first closes, the second reopens, net effect still inside. A `#`
 * inside a region is scalar text, which keeps a flow mapping whose
 * earlier quoted value contains ` # ` — `- { name: "build #1", uses:
 * some/action@v1 }` — from losing its `uses` key and letting an
 * unpinned action escape. The opener position rule matters both ways:
 * a plain-scalar apostrophe treated as an opener swallows a real
 * comment after it (`- uses: org/action@v4 it's # uses: evil/action@v1`
 * would report the comment's reference), and it can close on the
 * opening quote of a later real quoted scalar, so the `#` inside that
 * scalar opens a phantom comment that truncates the line before
 * `uses:` and lets an unpinned action escape.
 */
function stripInlineComment(line: string): string {
  let region: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (region === '"') {
      // An escaped character can never close the region.
      if (char === '\\') index += 1;
      else if (char === '"') region = undefined;
      continue;
    }
    if (region === "'") {
      if (char === "'") {
        // A doubled '' is one escaped quote: still inside the region.
        if (line[index + 1] === "'") index += 1;
        else region = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      // A quote opens a region only where YAML can start a quoted
      // scalar; mid-token (`it's`) it is plain-scalar text.
      if (opensQuotedScalar(line, index)) region = char;
      continue;
    }
    // At the start of the line or after whitespace, `#` opens a comment.
    if (char === '#' && opensComment(line, index)) return line.slice(0, index).trim();
  }
  return line.trim();
}

/**
 * Whether YAML can start a quoted scalar at `index`: at the start of the
 * line, after whitespace, or after a flow indicator. Mid-token (`it's`)
 * a quote is plain-scalar text and opens no region.
 */
function opensQuotedScalar(line: string, index: number): boolean {
  if (index === 0) return true;
  const previous = line[index - 1] ?? '';
  return /\s/.test(previous) || '[{:,'.includes(previous);
}

/**
 * Whether `#` at `index` opens a comment: at the start of the line or
 * after whitespace.
 */
function opensComment(line: string, index: number): boolean {
  return index === 0 || /\s/.test(line[index - 1] ?? '');
}

/**
 * The references the `uses` keys on one line name, in the order they sit
 * on it. Empty when the line carries no `uses` key with a value. The
 * line is passed past its inline comment (see `stripInlineComment`), so
 * a trailing `# …` can neither hide a reference nor fake one.
 *
 * The leading `(?:^|[^\w-])` keeps `reuses:` and `sub-uses:` out, and the
 * token stops at whitespace, a comma or a closing brace, so a flow
 * mapping yields the reference and not `…}`.
 */
function usesReferences(line: string): string[] {
  return [...line.matchAll(USES_WITH_REFERENCE)].map((match) =>
    (match[1] ?? '').replace(/^["']|["']$/g, ''),
  );
}

/** One pair of matching quotes around a token, removed. */
function stripQuotes(token: string): string {
  if (token.length < 2) return token;
  const first = token[0];
  const last = token[token.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * The entry for a `uses` key whose value sits on the next line: the
 * reference is the first token of the next line that carries one.
 *
 * Empty and comment-only lines are skipped — both strip to empty —
 * because a comment is documentation and an empty line carries no
 * reference. When the continuation line carries a `uses` key of its own,
 * that key reports the reference, so this returns nothing — the
 * reference is never reported twice.
 */
function continuationEntry(
  lines: string[],
  from: number,
): { reference: string; line: string } | undefined {
  for (let index = from + 1; index < lines.length; index += 1) {
    // Stripped of its inline comment, so a continuation line with a
    // trailing comment yields the value and a comment-only line empty.
    const line = stripInlineComment(lines[index] ?? '');
    if (line === '') continue;
    if (usesReferences(line).length > 0) return undefined;
    const reference = stripQuotes(line.split(/\s+/)[0] ?? '');
    if (reference === '') continue;
    return { reference, line };
  }
  return undefined;
}

function usesLines(text: string): { reference: string; line: string }[] {
  const lines = text.split('\n');
  const entries: { reference: string; line: string }[] = [];
  for (const [index, raw] of lines.entries()) {
    // The line past its inline comment. A comment-only line strips to
    // empty: documentation, not a step. The reference in it is never
    // run, so the pin guard has nothing to say about it.
    const line = stripInlineComment(raw);
    if (line === '') continue;
    const references = usesReferences(line);
    // A block-scalar header names no action on its own line — the value
    // sits on the following indented lines — so it is the empty-value
    // form below, never a same-line reference to pin-check.
    const hasBlockHeader = references.some((reference) => BLOCK_SCALAR_HEADER.test(reference));
    const actionReferences = references.filter((reference) => !BLOCK_SCALAR_HEADER.test(reference));
    if (actionReferences.length > 0) {
      for (const reference of actionReferences) {
        entries.push({ reference, line });
      }
      continue;
    }
    // No reference on this line: the key carries an empty value — or a
    // block-scalar header — so the reference is the first token of the
    // next line that has one.
    if (!hasBlockHeader && !USES_EMPTY_VALUE.test(line)) continue;
    const continuation = continuationEntry(lines, index);
    if (continuation !== undefined) entries.push(continuation);
  }
  return entries;
}

/**
 * The text of one job of a workflow: from `  <name>:` up to the next job.
 * Empty when the job is not there, so a caller that needs the job fails
 * loudly instead of matching nothing.
 */
function jobBlock(text: string, jobName: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  // The next job starts at a two-space line whose third character is
  // neither whitespace (content of this job, deeper than the key) nor
  // `#` (a comment, which is not a key and therefore ends nothing).
  const end = rest.findIndex((line) => /^ {2}[^\s#]/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * The actionlint version every WORKFLOW install pins. One version across
 * the workflows — ci.yml's quality job, ci.yml's `actionlint` job and
 * release's `ci` job — or a change is green on one leg and red on
 * another. The local leg (`npm run ci`, `npm run lint:actions`) names
 * its own copy of the version in AGENTS.md and CONTRIBUTING.md; this
 * test cannot read those, so it pins only the workflow files.
 */
const ACTIONLINT_VERSION = 'v1.7.12';

/** The pinned install a gate-running job must carry, in an earlier step. */
const ACTIONLINT_INSTALL = `go install github.com/rhysd/actionlint/cmd/actionlint@${ACTIONLINT_VERSION}`;

/** Every actionlint `go install` in a workflow text, capturing its version. */
const ACTIONLINT_VERSIONS = /go install github\.com\/rhysd\/actionlint\/cmd\/actionlint@(\S+)/g;

/**
 * A run value invoking the shared gate as a command: `npm run ci` or
 * `npm run lint:actions`, the two spellings a step uses to run what runs
 * locally under `npm run ci`. The command must stand alone as a word:
 * `npm ci` is an install, and `npm run ci:extra` is another script. The
 * value arrives as one line, or as block-scalar lines joined by `\n`, so
 * a command folded across lines still reads as one.
 */
const GATE_COMMAND = /(?:^|[\s;&|(`'"])npm run\s+(?:ci|lint:actions)(?![\w:.-])/;

/** The shell redirect that puts GOPATH's bin dir on GITHUB_PATH. */
const GITHUB_PATH_ECHO = />>\s*"\$GITHUB_PATH"/;

/** An actionlint run by absolute GOPATH path — no PATH lookup involved. */
const ACTIONLINT_BY_PATH = /\$\(go env GOPATH\)\/bin\/actionlint/;

/** One gate-relevant line of a job: the step it belongs to, numbered. */
type GateLine = { step: string; ordinal: number };

/** What one job says about the shared gate, for `gateFindings` to judge. */
type JobGate = {
  consumers: GateLine[];
  actionlintRuns: GateLine[];
  /** Step carrying the pinned install; -1 when the job carries none. */
  installOrdinal: number;
  /** Step carrying the GITHUB_PATH echo; -1 when the job carries none. */
  echoOrdinal: number;
};

/**
 * The jobs of a workflow text, in file order: the name from the
 * two-space-indented key under `jobs:` and the body lines up to the next
 * such key. A line back at column 0 ends the mapping — and every job's
 * body — so a workflow that puts something after `jobs:` stops here too.
 * Empty when the text has no `jobs:` line: a caller then reports nothing
 * only when the workflow really has no jobs to guard.
 */
function workflowJobs(text: string): { name: string; lines: string[] }[] {
  const lines = text.split('\n');
  const header = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (header === -1) return [];
  const jobs: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | undefined;
  for (const line of lines.slice(header + 1)) {
    if (/^[^\s#]/.test(line)) break;
    const key = /^ {2}([^#\s][^:]*):/.exec(line);
    if (key !== null) {
      current = { name: key[1] ?? '', lines: [] };
      jobs.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return jobs;
}

/**
 * The value of a `run:` block scalar: its content lines — indented past
 * the run key at column 8, comment-only lines stripped — joined as the
 * shell would see them.
 */
function blockScalarValue(lines: string[], index: number): string {
  const parts: string[] = [];
  for (let next = index + 1; next < lines.length; next += 1) {
    const content = lines[next] ?? '';
    if (content.trim() === '') continue;
    // The run key sits at column 8 in both step spellings, so the block's
    // content is every line indented past it; a line back at column 8 or
    // left is the next key and ends the value.
    if (content.length - content.trimStart().length <= 8) break;
    const stripped = stripInlineComment(content);
    if (stripped === '') continue;
    parts.push(stripped);
  }
  return parts.join('\n');
}

/**
 * The value of the `run:` key on line `index`, in every spelling the
 * repo uses or could regress to: a same-line scalar (`run: npm run ci`),
 * a literal block (`run: |` / `run: |-`) and a folded block (`run: >` /
 * `run: >-`), where the value sits on the more-indented lines after the
 * header. Comment-only lines never join the value — a `#` first on the
 * line is a comment to the shell too, so `run: # npm run ci` and a
 * `# npm run ci` line inside a block run nothing.
 *
 * Undefined when line `index` carries no `run:` key, so only run values
 * are ever read as commands. The caller knows the STEP the key sits in,
 * which is all the ordering the gate rules need.
 */
function runValueAt(lines: string[], index: number): string | undefined {
  const line = lines[index] ?? '';
  const match = /^ {6}- run:(.*)$/.exec(line) ?? /^ {8}run:(.*)$/.exec(line);
  const rest = match?.[1];
  if (rest === undefined) return undefined;
  const value = stripInlineComment(rest);
  if (!BLOCK_SCALAR_HEADER.test(value)) return value;
  return blockScalarValue(lines, index);
}

/**
 * Everything one job says about the shared gate: which STEP invokes it,
 * which steps run actionlint by absolute GOPATH path, and which step
 * carries the pinned install and the GITHUB_PATH echo. Steps are
 * numbered so `gateFindings` can order by step, not by line: a step's
 * own lines all sit together, and the effect the guard needs from the
 * echo reaches only LATER steps. Install and echo detection tests the
 * line with its inline comment stripped, so neither a commented-out
 * install nor a documentation line quoting one satisfies the checks —
 * a commented-out install installs nothing.
 */
function scanJobGate(lines: string[]): JobGate {
  const gate: JobGate = { consumers: [], actionlintRuns: [], installOrdinal: -1, echoOrdinal: -1 };
  let step = '(no run step)';
  let ordinal = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^ {6}- /.test(line)) {
      step = line.trim().replace(/^- /, '');
      ordinal += 1;
    }
    const stripped = stripInlineComment(line);
    if (gate.installOrdinal === -1 && stripped.includes(ACTIONLINT_INSTALL)) {
      gate.installOrdinal = ordinal;
    }
    if (gate.echoOrdinal === -1 && GITHUB_PATH_ECHO.test(stripped)) {
      gate.echoOrdinal = ordinal;
    }
    const run = runValueAt(lines, index);
    if (run === undefined) continue;
    if (GATE_COMMAND.test(run)) gate.consumers.push({ step, ordinal });
    if (ACTIONLINT_BY_PATH.test(run)) gate.actionlintRuns.push({ step, ordinal });
  }
  return gate;
}

/** Every step of every job whose run value invokes the shared gate. */
function workflowGateConsumers(text: string): { job: string; step: string }[] {
  const consumers: { job: string; step: string }[] = [];
  for (const job of workflowJobs(text)) {
    for (const found of scanJobGate(job.lines).consumers) {
      consumers.push({ job: job.name, step: found.step });
    }
  }
  return consumers;
}

/**
 * Every invariant a workflow's jobs break, as messages naming the file,
 * the job and the step. Empty when every job holds them:
 *
 *  - a job whose run value invokes the shared gate carries the pinned
 *    actionlint install AND the `>> "$GITHUB_PATH"` echo in a STRICTLY
 *    EARLIER step than the first consumer step — the gate shells out to
 *    a bare `actionlint`, which the runner does not ship. The step rule
 *    is deliberately stricter than line order: `GITHUB_PATH` applies
 *    only to subsequent steps, so install, echo and gate folded into
 *    one step still die with `actionlint: command not found` however
 *    they are ordered inside it, and holding every line of the rule to
 *    one uniform test keeps such a fold from passing on line order;
 *  - a job that invokes actionlint by absolute GOPATH path carries the
 *    install in an earlier step too, but needs no PATH echo: the
 *    absolute path never reads PATH.
 */
function gateFindings(file: string, text: string): string[] {
  const findings: string[] = [];
  for (const job of workflowJobs(text)) {
    const scan = scanJobGate(job.lines);
    const where = (step: string): string => `${file}: job \`${job.name}\`, step \`${step}\``;
    const consumer = scan.consumers[0];
    if (consumer !== undefined) {
      if (scan.installOrdinal === -1) {
        findings.push(`${where(consumer.step)}: runs the gate with no pinned actionlint install`);
      } else if (scan.installOrdinal >= consumer.ordinal) {
        findings.push(
          `${where(consumer.step)}: pinned install must be in an earlier step than the gate`,
        );
      }
      if (scan.echoOrdinal === -1) {
        findings.push(`${where(consumer.step)}: bare gate with no \`>> "$GITHUB_PATH"\` echo`);
      } else if (scan.echoOrdinal >= consumer.ordinal) {
        findings.push(
          `${where(consumer.step)}: \`>> "$GITHUB_PATH"\` echo must be in an earlier step than the gate`,
        );
      }
    }
    const absolute = scan.actionlintRuns[0];
    if (absolute !== undefined) {
      if (scan.installOrdinal === -1) {
        findings.push(`${where(absolute.step)}: GOPATH-path actionlint with no pinned install`);
      } else if (scan.installOrdinal >= absolute.ordinal) {
        findings.push(
          `${where(absolute.step)}: pinned install must be in an earlier step than the invocation`,
        );
      }
    }
  }
  return findings;
}

/**
 * A synthetic workflow text: `jobs:` plus the lines given, for the
 * parser tests below. Nothing real is ever mutated to make a guard fail.
 */
function syntheticWorkflow(jobLines: string[]): string {
  return ['name: Synthetic', '', 'jobs:', ...jobLines].join('\n');
}

describe('ci.yml — the workflow the merge gate depends on', () => {
  it('runs the local gate commands verbatim, in order, one step each', () => {
    const script = manifest.scripts.ci;
    expect(script, 'package.json has no `ci` script').toBeDefined();
    const local = localGateCommands(script ?? '');
    expect(local.length).toBeGreaterThan(1);
    expect(workflowRunSteps(workflow)).toEqual(local);
  });

  it('installs the pinned actionlint before any job runs the shared gate', () => {
    // Silent failure this prevents: `npm run ci` runs `npm run
    // lint:actions`, so every JOB that invokes the shared gate needs the
    // pinned actionlint install — and a bare PATH invocation the
    // GITHUB_PATH echo — before that step. The guard this replaces
    // searched each FILE for the whole-file substring `run: npm run ci`
    // and so silently SKIPPED ci.yml — the job branch protection depends
    // on — because ci.yml runs the gate as seven individual steps and
    // names `npm run ci` only in comments that sit before the installs;
    // a naive whole-file scan trips on those comments instead. This
    // reads every job and every run spelling (same-line, `|`, `>`), so
    // the failure names file, job and step rather than arriving as
    // `actionlint: command not found` on every pull request — or, on a
    // release tag, blocking publish, github-release and the npm job at
    // once (release.yml's `ci` job).
    const reports = workflowFiles.map(({ name, path }) => {
      const text = readFileSync(path, 'utf8');
      return { name, consumers: workflowGateConsumers(text), findings: gateFindings(name, text) };
    });
    const findings = reports.flatMap((report) => report.findings);
    expect(findings, 'gate consumers need actionlint before them').toEqual([]);
    // The guard passes vacuously if the parser sees no consumer at all —
    // exactly how the old substring search skipped ci.yml. Both workflows
    // that run the gate have to be visible here.
    for (const name of ['ci.yml', 'release.yml']) {
      const seen = reports.find((entry) => entry.name === name)?.consumers.length ?? 0;
      expect(seen, `${name}: no gate consumer seen`).toBeGreaterThan(0);
    }
  });

  it('installs one identical actionlint version everywhere it is installed', () => {
    // Silent failure this prevents: ci.yml's quality job, ci.yml's
    // actionlint job and release.yml's ci job each install actionlint
    // themselves. If one drifts to another version, the legs lint with
    // different rule sets — a change green on one leg goes red on
    // another, surfacing as an unrelated-looking failure on whichever
    // leg moves last. There must be at least one occurrence, all
    // carrying the version pinned in this file; zero occurrences would
    // make this guard pass on nothing.
    const installs: { name: string; version: string }[] = [];
    for (const { name, path } of workflowFiles) {
      for (const match of readFileSync(path, 'utf8').matchAll(ACTIONLINT_VERSIONS)) {
        installs.push({ name, version: match[1] ?? '' });
      }
    }
    expect(installs.length, 'no actionlint install found').toBeGreaterThan(0);
    for (const install of installs) {
      const message = `${install.name}: actionlint @${install.version}`;
      expect(install.version, message).toBe(ACTIONLINT_VERSION);
    }
  });

  it('still produces every check branch protection requires', () => {
    // The matrix legs become the check names, so the matrix has to contain
    // the versions branch protection names.
    expect(workflow).toMatch(/^ {2}security:$/m);
    expect(workflow).toMatch(/^ {4}name: security$/m);
    expect(workflow).toMatch(/name: quality \(\$\{\{ matrix\.node \}\}\)$/m);
    const produced = new Set([
      ...pullRequestNodes(workflow).map((node) => `quality (${node})`),
      'security',
    ]);
    for (const required of REQUIRED_CHECKS) {
      expect(produced, `required check "${required}" would never report`).toContain(required);
    }
  });

  it('narrows the push-to-main run — an intensity knob, not a correctness invariant', () => {
    // A squash merge keeps the tree byte-identical to the pull_request head
    // (verified on PRs #128, #130, #131, #132), so a push to `main` need
    // not repeat both legs and the container build the pull request
    // already ran. The condition lives in the matrix because a job-level
    // `if` cannot read `matrix` — doing that invalidates the workflow.
    expect(workflow).toMatch(
      /^\s+node: \$\{\{ github\.event_name == 'pull_request' && fromJSON\('\[22, 24\]'\) \|\| fromJSON\('\[22\]'\) \}\}$/m,
    );
    const arms = matrixArms(workflow);
    expect(arms[0], 'a pull_request run must keep both legs').toEqual(['22', '24']);
    expect(arms[1], 'a push to main runs the floor version only').toEqual(['22']);
    expect(workflow).toMatch(/^ {4}if: github\.event_name == 'pull_request'$/m);
  });

  it('can fail: the extractors report what they are given', () => {
    // The guards above pass vacuously if an extractor silently matches
    // nothing. These pin the extractors to known texts so a broken regex
    // fails here instead of turning the real assertions into no-ops.
    const steps = [
      '      - run: npm ci --ignore-scripts',
      '      - name: format (prettier)',
      '        run: npm run format:check',
      '      - name: lint (eslint)',
      '        run: npm run lint',
      '      - run: |',
      '          docker run --rm cfr-free:ci version',
    ].join('\n');
    expect(workflowRunSteps(steps)).toEqual(['format:check', 'lint']);
    expect(matrixNodes('        node: [22, 24]\n')).toEqual(['22', '24']);
    expect(matrixNodes('      no matrix here\n')).toEqual([]);
    expect(
      matrixArms(
        "        node: ${{ github.event_name == 'pull_request' && fromJSON('[22, 24]') }}\n",
      ),
    ).toEqual([['22', '24']]);
  });
});

/**
 * Two more silent failures, of the same kind as the three above:
 *
 *  - An action pinned to a tag or a branch runs whatever the upstream
 *    repository points at that day. The workflow file reads the same and
 *    the run is still green, so the unpinned step stays invisible until
 *    the upstream moves.
 *  - The `security` job can lose one of its two scanners. The check still
 *    reports, still passes, and branch protection still sees a green
 *    `security` — while secrets or dependency advisories go unscanned.
 */
describe('the workflow files — what the merge gate runs', () => {
  it('pins every action to a full commit SHA', () => {
    // Silent failure this prevents: an action pinned to a tag or a branch
    // runs whatever the upstream repository points at that day. The
    // workflow still reads the same and the run is still green, so the
    // unpinned step stays invisible until the upstream moves.
    const uses: { name: string; reference: string; line: string }[] = [];
    for (const workflowFile of workflowFiles) {
      for (const entry of usesLines(readFileSync(workflowFile.path, 'utf8'))) {
        uses.push({ name: workflowFile.name, ...entry });
      }
    }
    expect(uses.length, 'no `uses:` line found — this guard passes on nothing').toBeGreaterThan(0);
    for (const use of uses) {
      const message = `${use.name}: action not pinned to a full 40-hex commit SHA — ${use.line}`;
      expect(PINNED_ACTION.test(use.reference), message).toBe(true);
    }
  });

  it('catches an unpinned action however the step is spelled', () => {
    // Silent failure this prevents: a step written as a flow mapping or
    // with a quoted key is still a step, and an unpinned action in it
    // runs whatever the upstream repository points at that day. The
    // guard reads the key wherever it sits on the line, so none of these
    // spellings escapes it.
    const unpinned = 'actions/checkout@v4';
    const spellings = [
      '      - uses: actions/checkout@v4',
      '      - { uses: actions/checkout@v4 }',
      '      - {uses: actions/checkout@v4}',
      '      - "uses": actions/checkout@v4',
      "      - 'uses': actions/checkout@v4",
    ];
    for (const step of spellings) {
      // The entries the pin guard above fails on.
      const caught = usesLines(step).filter((entry) => !PINNED_ACTION.test(entry.reference));
      expect(
        caught.map((entry) => entry.reference),
        `the pin guard does not see this step: ${step}`,
      ).toEqual([unpinned]);
    }
    // The same spelling with a pinned reference stays clean: a broader
    // match must not turn every flow mapping into a failure.
    const pinned = '      - { uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 }';
    const flagged = usesLines(pinned).filter((entry) => !PINNED_ACTION.test(entry.reference));
    expect(flagged, 'a pinned flow-mapping step is flagged').toEqual([]);
    // The failure message names the offending line, so `entry.line` has to
    // be the trimmed source line — a block step and a flow mapping alike.
    // Nothing asserted that before: the guard could report an empty or a
    // mangled line and still pass.
    const blockStep = '      - uses: actions/checkout@v4';
    const flowStep = '      - { uses: actions/checkout@v4 }';
    expect(
      usesLines(blockStep)[0]?.line,
      'the reported line is not the trimmed source line (block step)',
    ).toBe(blockStep.trim());
    expect(
      usesLines(flowStep)[0]?.line,
      'the reported line is not the trimmed source line (flow mapping)',
    ).toBe(flowStep.trim());
  });

  it('catches an unpinned action written as a multi-line plain scalar', () => {
    // Silent failure this prevents: a step whose key carries no value on
    // its own line. YAML reads the reference from the next, more indented
    // line and GitHub runs the step, so an unpinned action written this
    // way is a step that runs — and the guard has to see it.
    const unpinned = 'actions/checkout@v4';
    const step = ['      - uses:', '          actions/checkout@v4'].join('\n');
    const caught = usesLines(step).filter((entry) => !PINNED_ACTION.test(entry.reference));
    expect(
      caught.map((entry) => entry.reference),
      'the pin guard does not see the multi-line step',
    ).toEqual([unpinned]);
    // The failure names the line a human has to edit: the line that
    // carries the reference, not the key that starts it.
    expect(
      caught[0]?.line,
      'the reported line is not the continuation line (multi-line step)',
    ).toBe('actions/checkout@v4');
    // The quoted key is the same step: `- "uses":` with an empty value.
    const quoted = ['      - "uses":', '          actions/checkout@v4'].join('\n');
    expect(
      usesLines(quoted).map((entry) => entry.reference),
      'a quoted key with an empty value is not read',
    ).toEqual([unpinned]);
    // The same spelling with a pinned reference stays clean.
    const pinned = [
      '      - uses:',
      '          actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    ].join('\n');
    expect(
      usesLines(pinned).filter((entry) => !PINNED_ACTION.test(entry.reference)),
      'a pinned multi-line step is flagged',
    ).toEqual([]);
  });

  it('reads the reference of a multi-line step past a comment line', () => {
    // A comment between the key and the reference is documentation, not a
    // step: the reference is still the next line that carries one, and
    // the guard must not read the comment as the reference.
    const step = [
      '      - uses:',
      '          # the reference sits on the next line',
      '          actions/checkout@v4',
    ].join('\n');
    const entries = usesLines(step);
    expect(
      entries.map((entry) => entry.reference),
      'the reference behind a comment line is not read',
    ).toEqual(['actions/checkout@v4']);
    expect(
      entries[0]?.line,
      'the reported line is not the continuation line (behind a comment)',
    ).toBe('actions/checkout@v4');
    // A continuation line with a `uses` key of its own reports the
    // reference once — never twice.
    const own = ['      - uses:', '          uses: actions/checkout@v4'].join('\n');
    expect(
      usesLines(own).map((entry) => entry.reference),
      'the reference is reported twice',
    ).toEqual(['actions/checkout@v4']);
  });

  it('ignores a uses line whose only value is an inline comment', () => {
    // Silent failure this prevents: `- uses: # note` is a null value in
    // YAML — the comment starts where the value would — so no action
    // runs. Matching the raw line reported the phantom `#` as an
    // unpinned action: a loud but nonsense failure naming a line that
    // does nothing. The stripped line is exactly `- uses:`.
    expect(usesLines('      - uses: # note'), 'a `#` was read as a reference').toEqual([]);
    // The continuation rule applies behind it, unchanged: an unpinned
    // reference on the next line is still caught, on that line.
    const step = ['      - uses: # note', '          actions/checkout@v4'].join('\n');
    const caught = usesLines(step).filter((entry) => !PINNED_ACTION.test(entry.reference));
    expect(
      caught.map((entry) => entry.reference),
      'the reference behind a `uses: # note` key is not caught',
    ).toEqual(['actions/checkout@v4']);
    expect(caught[0]?.line, 'the reported line is not the continuation line (`uses: # note`)').toBe(
      'actions/checkout@v4',
    );
    // A `#` with no whitespace before it is part of the value, not a
    // comment: the fragment keeps the whole token, and the pin guard
    // still judges that whole token.
    const fragment = 'org/action@v4#frag';
    expect(
      usesLines(`      - uses: ${fragment}`).map((entry) => entry.reference),
      'the `#frag` part of the reference was comment-stripped',
    ).toEqual([fragment]);
  });

  it('reads a uses key past a quoted `#` in an earlier value', () => {
    // Silent failure this prevents: a comment strip that truncates at
    // the first `#` regardless of quotes is fail-open. In
    // `- { name: "build #1", uses: some/action@v1 }` the `#` sits
    // inside a quoted scalar; truncating there loses the `uses` key,
    // the reference list comes back empty, and an unpinned action
    // escapes the pin guard — a regression the raw-line match never
    // had. Every spelling here must report the reference.
    const spellings = [
      '      - { name: "build #1", uses: some/action@v1 }',
      "      - { name: 'build #1', uses: some/action@v1 }",
      '      - { name: "build \\"a\\" #1", uses: some/action@v1 }',
      '      - { name: "it\'s #1", uses: some/action@v1 }',
    ];
    for (const step of spellings) {
      const caught = usesLines(step).filter((entry) => !PINNED_ACTION.test(entry.reference));
      expect(
        caught.map((entry) => entry.reference),
        `the pin guard does not see this step: ${step}`,
      ).toEqual(['some/action@v1']);
    }
    // A `#` that really opens a comment still ends the line even when
    // the comment itself contains quotes: the value is reported, the
    // comment is not part of it.
    const trailing = "      - uses: org/action@v4 # it's a comment";
    expect(
      usesLines(trailing).map((entry) => entry.reference),
      'the trailing comment was read as part of the reference',
    ).toEqual(['org/action@v4']);
  });

  it('reads a plain-scalar apostrophe as text, not as a quote', () => {
    // Silent failure this prevents: a `'` anywhere outside a region
    // opened one, so an apostrophe inside a plain scalar mis-strips in
    // both directions. Fail-open: in
    // `- { name: don't, title: 'build #1', uses: some/action@v1 }` the
    // phantom region closes on the real quoted scalar's opening quote,
    // the `#` inside that scalar opens a phantom comment, the line
    // truncates before `uses:`, and an unpinned action escapes the pin
    // guard. Fail-closed, the inverse: in
    // `- uses: org/action@v4 it's # uses: evil/action@v1` the phantom
    // region swallows the real comment and the guard would report the
    // comment's reference — a false pin failure naming a line that
    // does nothing.
    const failOpen = "      - { name: don't, title: 'build #1', uses: some/action@v1 }";
    expect(
      usesLines(failOpen)
        .filter((entry) => !PINNED_ACTION.test(entry.reference))
        .map((entry) => entry.reference),
      `the pin guard does not see this step: ${failOpen}`,
    ).toEqual(['some/action@v1']);
    const failClosed = "      - uses: org/action@v4 it's # uses: evil/action@v1";
    expect(
      usesLines(failClosed).map((entry) => entry.reference),
      'the comment behind a plain-scalar apostrophe was read as references',
    ).toEqual(['org/action@v4']);
    // The doubled-'' escape branch of the single-quote stripper, before
    // this test unexercised: inside `'…'` the first quote of a doubled
    // pair escapes rather than closes, so the region — and the `#`
    // text inside it — survives to the real closing quote. If the
    // first quote closed instead, the `#` would open a phantom comment,
    // the line would truncate before `uses:`, and this step would drop
    // out of the guard's view.
    const doubled = "      - { name: 'it''s # not a comment', uses: some/action@v1 }";
    expect(
      usesLines(doubled)
        .filter((entry) => !PINNED_ACTION.test(entry.reference))
        .map((entry) => entry.reference),
      `the pin guard does not see this step: ${doubled}`,
    ).toEqual(['some/action@v1']);
    // A quoted value closed right before a real comment: the closing
    // quote ends the region, the comment strips, the value reports.
    const closing = "      - uses: 'org/action@v4' # it's fine";
    expect(
      usesLines(closing).map((entry) => entry.reference),
      'the value behind a closed quoted scalar was not reported',
    ).toEqual(['org/action@v4']);
  });

  it('treats a block-scalar header as the empty-value form', () => {
    // Silent failure this prevents: `uses: |` is a block scalar — the
    // value sits on the following indented lines — but the regex
    // captured the indicator itself and the guard reported the nonsense
    // `not pinned: |`. The header is the empty-value form: no same-line
    // reference, and the continuation rule names the line that carries
    // the reference.
    const step = ['      - uses: |', '          actions/checkout@v4'].join('\n');
    const caught = usesLines(step).filter((entry) => !PINNED_ACTION.test(entry.reference));
    expect(
      caught.map((entry) => entry.reference),
      'the pin guard does not see the reference behind a block header',
    ).toEqual(['actions/checkout@v4']);
    expect(caught[0]?.line, 'the reported line is not the continuation line (block header)').toBe(
      'actions/checkout@v4',
    );
    // The same step with a pinned reference stays clean.
    const pinned = [
      '      - uses: |',
      '          actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    ].join('\n');
    expect(
      usesLines(pinned).filter((entry) => !PINNED_ACTION.test(entry.reference)),
      'a pinned step behind a block header is flagged',
    ).toEqual([]);
    // A header with no continuation names nothing: no entry, and above
    // all no phantom `|` reference to fail the pin guard on.
    expect(usesLines('      - uses: |'), 'a block header yields an entry').toEqual([]);
    // Every header spelling is the same step to the guard.
    for (const header of ['|', '|-', '|+', '>', '>-', '|2', '|2-']) {
      expect(
        usesLines(`      - uses: ${header}`),
        `the header \`${header}\` yields an entry`,
      ).toEqual([]);
    }
  });

  it('ignores a commented-out action reference', () => {
    // A comment is documentation, not a step. A workflow that pins every
    // action it runs must not fail because a comment mentions an old
    // unpinned reference, and the guard's message must not name a line
    // that does nothing.
    const commented = [
      '      # - uses: actions/checkout@v4',
      '      # - { uses: actions/checkout@v4 }',
      '        # uses: actions/checkout@v4',
    ].join('\n');
    expect(usesLines(commented), 'a comment-only line yields entries').toEqual([]);
    // The fail-closed property is kept for actual steps: the real step
    // next to the comment is still caught, and only that one.
    const withRealStep = [
      '      # - uses: actions/checkout@v4',
      '      - uses: actions/checkout@v4',
    ].join('\n');
    expect(
      usesLines(withRealStep)
        .filter((entry) => !PINNED_ACTION.test(entry.reference))
        .map((entry) => entry.reference),
      'the real step beside a comment is not caught',
    ).toEqual(['actions/checkout@v4']);
    // A comment on a line that also carries a step is still a step: the
    // comment rule covers comment-only lines, not trailing comments.
    const trailingComment = '      - uses: actions/checkout@v4 # not pinned';
    expect(
      usesLines(trailingComment)
        .filter((entry) => !PINNED_ACTION.test(entry.reference))
        .map((entry) => entry.reference),
      'a step with a trailing comment is not caught',
    ).toEqual(['actions/checkout@v4']);
  });

  it('keeps gitleaks and osv-scanner in the security job', () => {
    // Silent failure this prevents: the `security` job losing one of its
    // two scanners. The check still reports, still passes, and branch
    // protection still sees a green `security` — while secrets or
    // dependency advisories go unscanned.
    const security = jobBlock(workflow, 'security');
    const gitleaks = 'gitleaks/gitleaks-action';
    const osv = 'google/osv-scanner-action';
    const steps = usesLines(security).map((entry) => entry.reference);
    expect(security, 'ci.yml has no `security` job').not.toBe('');
    expect(steps.join('\n'), 'the security job no longer runs gitleaks').toContain(gitleaks);
    expect(steps.join('\n'), 'the security job no longer runs osv-scanner').toContain(osv);
  });

  it('keeps a comment inside the security job from ending the block', () => {
    // A comment at the same indent as the job key is not a key: it ends
    // nothing. Ending the block there would drop the scanners below it
    // and fail the guard for a workflow that still runs both.
    const text = [
      'jobs:',
      '  security:',
      '  # the two scanners branch protection waits on',
      '    steps:',
      '      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e',
      '      - uses: google/osv-scanner-action/osv-scanner-action@b1d267aea5211fa648d9d442fa64b90dbdcbdd36',
      '  other:',
      '    steps:',
      '      - run: npm test',
    ].join('\n');
    const security = jobBlock(text, 'security');
    const gitleaks = 'gitleaks/gitleaks-action';
    const osv = 'google/osv-scanner-action';
    const steps = usesLines(security).map((entry) => entry.reference);
    expect(security, 'no `security` job found').not.toBe('');
    expect(steps.join('\n'), 'the security job no longer runs gitleaks').toContain(gitleaks);
    expect(steps.join('\n'), 'the security job no longer runs osv-scanner').toContain(osv);
    expect(security, 'the block ran on into the next job').not.toContain('npm test');
  });
});

/**
 * The gate guard's parser, on SYNTHETIC job snippets — never by mutating
 * a real workflow. Each snippet violates exactly one invariant, so a
 * guard that stops enforcing that rule fails HERE, where the message
 * names the rule; the real-file test can only show that the real files
 * still hold today, not that the parser would notice their violation
 * tomorrow.
 */
describe('the per-job gate guard — synthetic job snippets', () => {
  it('fails a consumer with no install, even when the echo is there', () => {
    // Silent failure this prevents: the install and the PATH echo are two
    // requirements, and either alone still dies with `actionlint: command
    // not found` — a job can put GOPATH on GITHUB_PATH and have no binary
    // to put there.
    const text = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - name: Put GOPATH on PATH',
      '        run: echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',
      '      - run: npm run ci',
    ]);
    expect(gateFindings('synthetic.yml', text)).toEqual([
      'synthetic.yml: job `gate`, step `run: npm run ci`: runs the gate with no pinned actionlint install',
    ]);
  });

  it('fails an install that sits after the consumer step', () => {
    // Silent failure this prevents: order matters — an install below the
    // gate step runs after it, and the gate still dies with
    // `actionlint: command not found` on every run.
    const text = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - name: Put GOPATH on PATH',
      '        run: echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',
      '      - run: npm run ci',
      '      - name: Install actionlint',
      `        run: ${ACTIONLINT_INSTALL}`,
    ]);
    expect(gateFindings('synthetic.yml', text)).toEqual([
      'synthetic.yml: job `gate`, step `run: npm run ci`: pinned install must be in an earlier step than the gate',
    ]);
  });

  it('fails install, echo and gate folded into one step, in any line order', () => {
    // Silent failure this prevents: `GITHUB_PATH` applies only to
    // SUBSEQUENT steps, and `go install` in the gate's own step leaves
    // the binary off that step's PATH however the lines are ordered —
    // a fold that installs, echoes and gates in one step looks right by
    // line order and still dies with `actionlint: command not found`
    // on every pull request (or, on a release tag, at publish time).
    const text = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - name: gate',
      '        run: |',
      `          ${ACTIONLINT_INSTALL}`,
      '          echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',
      '          npm run ci',
    ]);
    expect(gateFindings('synthetic.yml', text)).toEqual([
      'synthetic.yml: job `gate`, step `name: gate`: pinned install must be in an earlier step than the gate',
      'synthetic.yml: job `gate`, step `name: gate`: `>> "$GITHUB_PATH"` echo must be in an earlier step than the gate',
    ]);
  });

  it('ignores an install or echo that survives only inside a comment', () => {
    // Silent failure this prevents: the install line and the echo both
    // contain text a raw substring match finds, so a commented-out
    // install or a documentation line quoting one counts as satisfied —
    // and nothing was installed, so the job dies with `actionlint:
    // command not found` while the guard stays green.
    const wholeLine = syntheticWorkflow([
      '  gate:',
      '    steps:',
      `      # ${ACTIONLINT_INSTALL}`,
      '      - name: Put GOPATH on PATH',
      '        run: echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',
      '      - run: npm run ci',
    ]);
    expect(gateFindings('synthetic.yml', wholeLine)).toEqual([
      'synthetic.yml: job `gate`, step `run: npm run ci`: runs the gate with no pinned actionlint install',
    ]);
    const trailing = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - name: install notes',
      `        run: echo "how to install" # ${ACTIONLINT_INSTALL}`,
      '      - name: Put GOPATH on PATH',
      '        run: echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',
      '      - run: npm run ci',
    ]);
    expect(gateFindings('synthetic.yml', trailing)).toEqual([
      'synthetic.yml: job `gate`, step `run: npm run ci`: runs the gate with no pinned actionlint install',
    ]);
    const commentedEcho = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - name: install notes',
      '        run: echo "append the bin dir" # >> "$GITHUB_PATH"',
      '      - name: Install actionlint',
      `        run: ${ACTIONLINT_INSTALL}`,
      '      - run: npm run ci',
    ]);
    expect(gateFindings('synthetic.yml', commentedEcho)).toEqual([
      'synthetic.yml: job `gate`, step `run: npm run ci`: bare gate with no `>> "$GITHUB_PATH"` echo',
    ]);
  });

  it('fails a bare PATH consumer with no GITHUB_PATH echo', () => {
    // Silent failure this prevents: `npm run ci` and `npm run
    // lint:actions` invoke a bare `actionlint`, which the runner does
    // not ship. The install alone leaves it off PATH — the step dies with
    // `actionlint: command not found` though the binary exists.
    const text = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - name: Install actionlint',
      `        run: ${ACTIONLINT_INSTALL}`,
      '      - run: npm run lint:actions',
    ]);
    expect(gateFindings('synthetic.yml', text)).toEqual([
      'synthetic.yml: job `gate`, step `run: npm run lint:actions`: bare gate with no `>> "$GITHUB_PATH"` echo',
    ]);
  });

  it('passes an absolute-GOPATH actionlint run without the echo', () => {
    // Silent failure this prevents: a job that invokes actionlint by its
    // absolute GOPATH path never reads PATH, so demanding the echo there
    // would fail a workflow that is correct — and a guard that fails on
    // correct files gets edited until it stops guarding. The install it
    // still needs: without it there is no binary at that path.
    const text = syntheticWorkflow([
      '  lint:',
      '    steps:',
      '      - name: Install actionlint',
      `        run: ${ACTIONLINT_INSTALL}`,
      '      - name: actionlint (workflow lint)',
      '        run: \'"$(go env GOPATH)/bin/actionlint"\'',
    ]);
    expect(gateFindings('synthetic.yml', text)).toEqual([]);
    // The same job without the install still fails: absolute path or
    // not, the binary has to exist before it is run.
    const uninstalled = syntheticWorkflow([
      '  lint:',
      '    steps:',
      '      - name: actionlint (workflow lint)',
      '        run: \'"$(go env GOPATH)/bin/actionlint"\'',
    ]);
    expect(gateFindings('synthetic.yml', uninstalled)).toEqual([
      'synthetic.yml: job `lint`, step `name: actionlint (workflow lint)`: GOPATH-path actionlint with no pinned install',
    ]);
  });

  it('sees a literal `run: |` consumer and a folded `run: >` one', () => {
    // Silent failure this prevents: a consumer behind a block-scalar
    // header is a real run — the shell gets the command — but a guard
    // reading only same-line `run:` values misses it, and the job runs
    // the gate with no actionlint install again: `actionlint: command
    // not found`, invisible until the workflow fails.
    const literal = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - name: Install actionlint',
      '        run: |',
      `          ${ACTIONLINT_INSTALL}`,
      '          echo "$(go env GOPATH)/bin" >> "$GITHUB_PATH"',
      '      - name: shared gate',
      '        run: |',
      '          npm run ci',
    ]);
    expect(workflowGateConsumers(literal)).toEqual([{ job: 'gate', step: 'name: shared gate' }]);
    expect(gateFindings('synthetic.yml', literal)).toEqual([]);
    // A folded scalar joins its lines with spaces, so the command may sit
    // across two lines and still be one command to the shell.
    const folded = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      - run: >',
      '          npm run',
      '          ci',
    ]);
    expect(workflowGateConsumers(folded)).toEqual([{ job: 'gate', step: 'run: >' }]);
  });

  it('never treats a comment-only line as a consumer, in any spelling', () => {
    // Silent failure this prevents: both real workflows name `npm run
    // ci` in comments that sit BEFORE the installs — the exact shape that
    // made a whole-file scan fail the real files. A parser that read
    // comments as runs would demand an install before a comment about
    // the gate, fail the correct workflows, and get disabled rather than
    // fixed.
    const text = syntheticWorkflow([
      '  gate:',
      '    steps:',
      '      # - run: npm run ci',
      '      - name: block comment',
      '        run: |',
      '          # npm run ci',
      '      - name: same-line comment',
      '        run: # npm run ci',
    ]);
    expect(workflowGateConsumers(text)).toEqual([]);
  });
});
