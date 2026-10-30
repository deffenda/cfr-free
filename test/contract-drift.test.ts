import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { EcfrApi } from '../src/core/ecfr.js';
import { DEFAULT_FULL_TITLE_XML_TTL_MS, FULL_TITLE_XML_MEMO_CAP } from '../src/core/ecfr.js';
import { CFRService } from '../src/core/service.js';
import { buildMcpServer } from '../src/mcp/server.js';
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
 * Six places in the published surface used to say the opposite — "no cache",
 * "stateless", "fetched per call" — and nothing in the suite would have
 * noticed: the implementation was right and the documents were wrong. This
 * suite is the tripwire. It checks the documents and the tool descriptions an
 * LLM caller actually reads, not their formatting, so a rewrap does not break
 * it while a re-introduced false claim does.
 */

/** A claim that contradicts the per-process document memo, and why. */
const FALSE_CLAIMS: readonly { readonly pattern: RegExp; readonly because: string }[] = [
  {
    pattern: /\bno cache\b/i,
    because:
      'a fetched document is reused for five minutes by the process that fetched it (SPEC §5)',
  },
  {
    pattern: /\bstateless\b/i,
    because:
      'the upstream fetch path keeps a per-process, in-memory memo of the documents it fetched',
  },
  {
    pattern: /\bper call\b/i,
    because: 'a repeat read of the same issue date is served from the memo, not fetched again',
  },
  {
    pattern: /\bon every call\b/i,
    because: 'a repeat read of the same issue date is served from the memo, not fetched again',
  },
  {
    pattern: /\bper request\b/i,
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

/** How far either side of a claim to look for that context. */
const CONTEXT_WINDOW = 160;

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
      const around = text.slice(
        Math.max(0, at - CONTEXT_WINDOW),
        at + match[0].length + CONTEXT_WINDOW,
      );
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

function readDoc(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

/** The JSDoc block that documents `symbol` in `source`. */
function docCommentBefore(source: string, symbol: string): string {
  const at = source.indexOf(symbol);
  if (at < 0) return '';
  const before = source.slice(0, at);
  const start = before.lastIndexOf('/**');
  const end = before.lastIndexOf('*/');
  if (start < 0 || end < start) return '';
  return before.slice(start, end + 2);
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

  it('the diff/redline service docstrings make no false claim', () => {
    const source = readDoc('src/core/service.ts');
    const violations = [
      ...findFalseClaims(
        'src/core/service.ts#diffBetween',
        docCommentBefore(source, 'async diffBetween('),
      ),
      ...findFalseClaims(
        'src/core/service.ts#redlineBetween',
        docCommentBefore(source, 'async redlineBetween('),
      ),
    ];
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('the published documents state the memo’s reuse window and capacity', () => {
    // An operator has to be able to reason about staleness and memory from
    // the contract: the reuse window and how many documents are kept are
    // numbers, and they are the CODE's numbers. The documents may spell
    // them out ("five-minute") or use digits ("5-minute") — both are the
    // number the code uses.
    const words: Record<number, string> = { 4: 'four', 5: 'five' };
    const spelled = (value: number): string => `${value}|${words[value] ?? ''}`;
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
