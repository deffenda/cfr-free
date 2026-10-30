import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import type { EcfrApi } from '../src/core/ecfr.js';
import {
  DEFAULT_FULL_TITLE_XML_TTL_MS,
  DEFAULT_MAX_CONCURRENT_FETCHES,
  DEFAULT_MAX_QUEUED_FETCHES,
  FULL_TITLE_XML_MEMO_CAP,
} from '../src/core/ecfr.js';
import { CFRService } from '../src/core/service.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { EXPENSIVE_ROUTE_COST } from '../src/titan/http-server.js';
import { createTestLogger, openTempStore } from './helpers.js';

/**
 * The published contract must describe what the code DOES.
 *
 * The eCFR-backed path (`/api/v1/diff`, `/api/v1/redline`,
 * `get_section_at`, `diff_issues`, `redline`) fetches the complete Title 38
 * document from eCFR on demand, and the client keeps a PER-PROCESS, IN-MEMORY
 * memo of what it fetched: at most four documents, reused for five minutes,
 * shared by concurrent readers of the same date (SPEC §5). It is not a
 * cross-process or persistent cache.
 *
 * Many places in the published surface used to say the opposite — "no cache",
 * "stateless", "fetched per call" — and nothing in the suite would have
 * noticed: the implementation was right and the documents were wrong. This
 * suite is the tripwire. It checks the documents, the tool descriptions an
 * LLM caller actually reads, and EVERY source file, not their formatting, so
 * a rewrap does not break it while a re-introduced false claim does.
 */

/** A claim that contradicts the per-process document memo, and why. */
const FALSE_CLAIMS: readonly { readonly pattern: RegExp; readonly because: string }[] = [
  {
    // The lookahead keeps an HTTP header statement out of it: "no
    // Cache-Control header" is a claim about a response header, not
    // about the memo, and reading it as one would flag a true sentence.
    pattern: /\bno cache\b(?!-)/i,
    because:
      'a fetched document is reused for five minutes by the process that fetched it (SPEC §5)',
  },
  {
    pattern: /\bstateless\b/i,
    because:
      'the upstream fetch path keeps a per-process, in-memory memo of the documents it fetched',
  },
  {
    pattern: /\bfetched per call\b/i,
    because: 'a repeat read of the same issue date is served from the memo, not fetched again',
  },
  {
    pattern: /\bfetched on every call\b/i,
    because: 'a repeat read of the same issue date is served from the memo, not fetched again',
  },
  {
    pattern: /\bfetched per request\b/i,
    because: 'a repeat read of the same issue date is served from the memo, not fetched again',
  },
];

/**
 * Words that mark a passage as being about the eCFR-backed path. A claim
 * outside such a passage says nothing about the memo, so it is not this
 * suite's business.
 */
const UPSTREAM_CONTEXT =
  /eCFR|upstream|full-title|full title|issue date|point-in-time|\bdiff\b|\bredline\b|get_section_at|diff_issues/i;

/**
 * The BLOCK a claim sits in: its markdown paragraph, or its markdown table
 * row, or — in a source file — the run of comment lines around it.
 *
 * The review showed a claim could be slipped past by PLACEMENT: SPEC.md's
 * markdown rows are multi-thousand-character lines, so a fixed
 * character-window can miss the upstream words while the false claim is
 * still in a passage entirely about the upstream path. Judging the claim
 * against its own BLOCK closes that hole without the false positives a
 * wider window would cause — a claim about the health check's store query
 * is in a different table row from the upstream path, so it is not judged
 * against the upstream path's row.
 */
function blockAround(text: string, at: number): string {
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const lineEnd = text.indexOf('\n', at);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const isTableRow = (line: string): boolean => line.trimStart().startsWith('|');

  const thisRow = isTableRow(text.slice(lineStart, end));
  let start = lineStart;
  let stop = end;
  // A table row stands alone: the row above it is about something else.
  if (thisRow) return text.slice(start, stop);
  while (start > 0) {
    const prevEnd = start - 1;
    const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
    const prev = text.slice(prevStart, prevEnd);
    if (prev.trim() === '') break;
    if (isTableRow(prev) !== thisRow) break;
    start = prevStart;
  }
  while (stop < text.length) {
    const nextStart = stop + 1;
    const nextEnd = text.indexOf('\n', nextStart);
    const nextStop = nextEnd === -1 ? text.length : nextEnd;
    const next = text.slice(nextStart, nextStop);
    if (next.trim() === '') break;
    if (isTableRow(next) !== thisRow) break;
    stop = nextStop;
  }
  return text.slice(start, stop);
}

interface Violation {
  readonly surface: string;
  readonly claim: string;
  readonly because: string;
  readonly around: string;
}

/** Every false claim about the upstream fetch path in one piece of text. */
function findFalseClaims(surface: string, text: string): Violation[] {
  const violations: Violation[] = [];
  for (const { pattern, because } of FALSE_CLAIMS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      const at = match.index ?? 0;
      const around = blockAround(text, at);
      if (!UPSTREAM_CONTEXT.test(around)) continue;
      violations.push({
        surface,
        claim: match[0],
        because,
        around: around.replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return violations;
}

/** The absolute path of a repository file. */
function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function readDoc(relative: string): string {
  return readFileSync(repoPath(relative), 'utf8');
}

/**
 * Every source file under `src/`, as repository-relative paths.
 *
 * The list is WALKED, not written out: a hand-written file list is
 * exactly what let three command docstrings keep a false claim the
 * tripwire could not see.
 */
function sourceFiles(relative = 'src'): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(repoPath(relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(child));
    else if (/\.(?:ts|js|mjs|cjs)$/.test(entry.name)) found.push(child);
  }
  return found;
}

/**
 * A number the way a document may spell it: the digits, or the word.
 *
 * A number with no word is spelled by its digits ALONE. An empty
 * alternative would leave the pattern matching the bare words that
 * follow it — "waiting", "run at a time" — and the pin would then pass
 * for ANY value at all, which is how a queue bound of a hundred
 * thousand went unnoticed.
 */
function spellings(value: number, words: Readonly<Record<number, string>>): string {
  const word = words[value];
  return word === undefined ? String(value) : `${value}|${word}`;
}

/** One row of the published token-cost table. */
interface TokenCostRow {
  readonly label: string;
  /** Every cell of the row: the label first, then the prices. */
  readonly cells: readonly string[];
}

/**
 * The token-cost table published in a document's API description.
 *
 * The table is MARKDOWN inside the description string, so it is read as
 * text: a row is a label and its cells, and the cells are the prices the
 * router charges.
 */
function publishedTokenCosts(doc: string): readonly TokenCostRow[] {
  const description = parseDocument(readDoc(doc)).getIn(['info', 'description']);
  if (typeof description !== 'string') return [];
  const rows: TokenCostRow[] = [];
  for (const line of description.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    const label = cells[0] ?? '';
    // The header and the separator are not rows.
    if (label === 'request' || label === '---') continue;
    rows.push({ label, cells });
  }
  return rows;
}

/** Render the violations so the failure message says what is wrong. */
function describeViolations(violations: readonly Violation[]): string {
  return violations
    .map(
      (violation) =>
        `[${violation.surface}] claims "${violation.claim}" — ${violation.because}. Context: …${violation.around}…`,
    )
    .join('\n');
}

/** The eCFR-backed MCP tools whose descriptions the suite pins. */
const E_CFR_TOOLS = ['get_section_at', 'diff_issues', 'redline'] as const;

describe('published contract: the upstream fetch path is not "stateless"', () => {
  it('docs/SPEC.md makes no false claim about the eCFR-backed path', () => {
    const violations = findFalseClaims('docs/SPEC.md', readDoc('docs/SPEC.md'));
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('docs/openapi.yaml makes no false claim about the eCFR-backed path', () => {
    const violations = findFalseClaims('docs/openapi.yaml', readDoc('docs/openapi.yaml'));
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('README.md makes no false claim about the eCFR-backed path', () => {
    const violations = findFalseClaims('README.md', readDoc('README.md'));
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('no source file makes a false claim', () => {
    // EVERY file under src/, not the two the first pass happened to look
    // at. The review found `src/core/diff.ts` still opening with
    // "Stateless point-in-time diff" while the same file, further down,
    // said the memo may serve either document — the file contradicted
    // itself, and this suite could not see it because it only read the
    // published documents and the service's docstrings. The same review
    // then found three MORE in `src/commands/`, which a hand-written
    // file list would have kept missing.
    for (const file of sourceFiles()) {
      const violations = findFalseClaims(file, readDoc(file));
      expect(violations, describeViolations(violations)).toEqual([]);
    }
  });

  it('the published documents state the memo’s reuse window and capacity', () => {
    // An operator has to be able to reason about staleness and memory from
    // the contract: the reuse window and how many documents are kept are
    // numbers, and they are the CODE's numbers. The documents may spell
    // them out ("five-minute") or use digits ("5-minute") — both are the
    // number the code uses.
    const words: Record<number, string> = { 4: 'four', 5: 'five' };
    const spelled = (value: number): string => spellings(value, words);
    const minutes = DEFAULT_FULL_TITLE_XML_TTL_MS / 60_000;
    const cap = FULL_TITLE_XML_MEMO_CAP;
    for (const doc of ['docs/SPEC.md', 'docs/openapi.yaml', 'README.md']) {
      const text = readDoc(doc);
      expect(
        text,
        `${doc} must state the reuse window of the document memo (${minutes} minutes)`,
      ).toMatch(new RegExp(`\\b(?:${spelled(minutes)})[- ]minutes?`, 'i'));
      expect(text, `${doc} must state how many fetched documents are kept (${cap})`).toMatch(
        new RegExp(`\\b(?:${spelled(cap)}) documents`, 'i'),
      );
    }
  });

  it('the published token-cost table matches the code', () => {
    // The API description publishes a NUMBER the code charges. Nothing
    // compared the two: changing the published 10 to a 1 left every test
    // green, and the document then lied about the budget the router
    // spends.
    const rows = publishedTokenCosts('docs/openapi.yaml');
    const expensive = rows.find((row) => row.label.startsWith('`/api/v1/diff`'));
    expect(expensive, 'the API description must publish the cost of the diff route').toBeDefined();
    expect(expensive?.cells.at(-1)).toBe(String(EXPENSIVE_ROUTE_COST));
    const cheap = rows.find((row) => row.label.includes('every other path'));
    expect(cheap?.cells.at(-1)).toBe('1');
    // A request the router rejects AFTER it priced the route is charged
    // the route's OWN price, and the two classes of route charge
    // different prices. The table has to publish BOTH: the row that said
    // so could be deleted, and nothing said it had to be there.
    const rejectedCheap = rows.find(
      (row) => row.label.includes('`q` over 800 bytes') && row.label.includes('index-backed read'),
    );
    expect(
      rejectedCheap,
      'the API description must publish what an oversized `q` costs on an index-backed read',
    ).toBeDefined();
    expect(rejectedCheap?.cells.at(-1)).toBe('1');
    const rejectedExpensive = rows.find(
      (row) => row.label.includes('`q` over 800 bytes') && row.label.includes('/api/v1/diff'),
    );
    expect(
      rejectedExpensive,
      'the API description must publish what an oversized `q` costs on the upstream routes',
    ).toBeDefined();
    expect(rejectedExpensive?.cells.at(-1)).toBe(String(EXPENSIVE_ROUTE_COST));
    // Every price the table publishes must be one the router charges: a
    // row quoting a third price would contradict the rows beside it, and
    // the diff row's pin would not see it. EVERY cell is checked, not
    // only the last — a price in a middle column is a price too.
    for (const row of rows) {
      for (const cell of row.cells.slice(1)) {
        for (const [, digits] of cell.matchAll(/\b(\d+)\b/g)) {
          expect(
            [1, EXPENSIVE_ROUTE_COST],
            `the token-cost table must publish only 1 or ${EXPENSIVE_ROUTE_COST}: "${row.label}" quotes ${digits}`,
          ).toContain(Number(digits));
        }
      }
    }
  });

  it('the published upstream-fetch bounds match the code', () => {
    // The SPEC publishes the semaphore's two numbers: how many fetches run
    // at once and how many may wait. Changing the code's queue bound from
    // sixteen to a hundred thousand left every test green, and the
    // published "sixteen waiting" became a lie.
    const words: Record<number, string> = { 4: 'four', 16: 'sixteen' };
    const spelled = (value: number): string => spellings(value, words);
    const spec = readDoc('docs/SPEC.md');
    expect(spec).toMatch(
      new RegExp(`\\b(?:${spelled(DEFAULT_MAX_CONCURRENT_FETCHES)}) run at a time`, 'i'),
    );
    expect(spec).toMatch(new RegExp(`\\b(?:${spelled(DEFAULT_MAX_QUEUED_FETCHES)}) waiting`, 'i'));
  });

  it('the MCP tool descriptions make no false claim', async () => {
    // The descriptions an LLM caller reads, taken from the live tool list.
    const temp = openTempStore();
    const ecfr = {
      getFullTitleXml: async () => '<ECFR></ECFR>',
    } as unknown as EcfrApi;
    const server = buildMcpServer(new CFRService(temp.store, 7), createTestLogger(), { ecfr });
    const client = new Client({ name: 'contract-probe', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      const descriptions = listed.tools
        .filter((tool) => (E_CFR_TOOLS as readonly string[]).includes(tool.name))
        .map((tool) => ({ surface: `MCP tool ${tool.name}`, text: tool.description ?? '' }));
      expect(descriptions).toHaveLength(E_CFR_TOOLS.length);
      const violations = descriptions.flatMap((entry) =>
        findFalseClaims(entry.surface, entry.text),
      );
      expect(violations, describeViolations(violations)).toEqual([]);
    } finally {
      await client.close();
      await server.close();
      temp.cleanup();
    }
  });
});

describe('the contract tripwire itself', () => {
  it('reports a false claim planted on purpose', () => {
    // A guard nothing pins is a comment, not a check. The review found
    // that `findFalseClaims` could be broken — made to report nothing
    // — and every other test in this file would still have passed while
    // the tripwire was dead. So the tripwire is checked against a claim
    // that MUST be reported: the planted text says the upstream path
    // keeps no cache and is stateless, and it sits in a passage about
    // the upstream path, so both patterns must fire.
    const planted = 'The upstream diff is stateless: no cache is kept.';
    const violations = findFalseClaims('planted', planted);
    expect(violations.length, 'the tripwire must report a planted false claim').toBeGreaterThan(0);
    expect(violations.map((violation) => violation.claim)).toContain('stateless');
    expect(violations.map((violation) => violation.claim)).toContain('no cache');
  });

  it('spells a number that has no word by its digits alone', () => {
    // An empty alternative would leave the pattern matching the bare
    // words around it ("waiting", "run at a time"), so the pin would
    // pass for ANY value at all — which is how a queue bound of a
    // hundred thousand went unnoticed.
    expect(spellings(100, {})).toBe('100');
    expect(spellings(100, {}).split('|')).not.toContain('');
    expect(spellings(16, { 16: 'sixteen' })).toBe('16|sixteen');
  });
});
