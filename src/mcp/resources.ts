import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../logger.js';
import type { CFRService } from '../core/service.js';

/**
 * MCP resources and prompts. Resources expose the same read-only index
 * metadata as the tools (freshness, parts) so clients can pull it without
 * inventing tool arguments; the prompt encodes the canonical
 * search → read → cite workflow. No network access happens in any handler.
 */

function jsonContents(
  uri: URL,
  payload: unknown,
): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  return {
    contents: [
      { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) },
    ],
  };
}

/** Register the read-only resources and the research prompt. */
export function registerResources(server: McpServer, service: CFRService, logger: Logger): void {
  server.registerResource(
    'index-status',
    'cfr://index/status',
    {
      title: 'Local index freshness',
      description:
        'JSON freshness report for the local Title 38 index: eCFR issue date, last sync, ' +
        'row counts, staleness and structure-drift flag.',
      mimeType: 'application/json',
    },
    async (uri) => jsonContents(uri, service.status()),
  );

  server.registerResource(
    'title38-parts',
    'cfr://title38/parts',
    {
      title: 'Parts in the local index',
      description:
        'JSON list of every Title 38 CFR part present in the local index, with structure ' +
        'titles and section/appendix counts.',
      mimeType: 'application/json',
    },
    async (uri) => jsonContents(uri, { parts: service.listParts() }),
  );

  server.registerPrompt(
    'cfr_research',
    {
      title: 'Research a Title 38 CFR topic',
      description:
        'Walks a model through searching the local Title 38 index and reading the most ' +
        'relevant sections before answering.',
      argsSchema: {
        topic: z
          .string()
          .min(3)
          .max(200)
          // Defense-in-depth: control characters (newlines, escapes) could
          // restructure the generated message — reject them outright.
          .regex(/^[^\p{C}]+$/u, 'topic must not contain control characters')
          .describe('the benefits/regulatory topic to research'),
        part: z
          .string()
          .regex(/^\d{1,3}$/)
          .optional()
          .describe('restrict to one CFR part, e.g. "4"'),
      },
    },
    (args) => {
      const scope = args.part === undefined ? 'all of Title 38' : `CFR part ${args.part}`;
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Research "${args.topic}" in ${scope} using the cfr-free tools.\n` +
                '1. Call search_regulations with focused keywords; check the matches on each hit.\n' +
                '2. Read the most relevant hits in full with get_section.\n' +
                '3. Summarize what the regulation actually requires, citing section numbers.\n' +
                '4. Check index_status first; if the index is stale, say so before concluding.',
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'cfr_claim_evaluation',
    {
      title: 'Evaluate a claim issue against Title 38 CFR',
      description:
        'Walks a model through the adjudicator workflow: verify index readiness, locate the ' +
        'governing criteria, quote operative text verbatim, follow cross-references, and cite ' +
        'with source URLs and the index issue date.',
      argsSchema: {
        issue: z
          .string()
          .min(3)
          .max(300)
          // Same control-character hardening as cfr_research.
          .regex(/^[^\p{C}]+$/u, 'issue must not contain control characters')
          .describe('the claim issue to evaluate, e.g. "PTSD rating criteria"'),
        part: z
          .string()
          .regex(/^\d{1,3}$/)
          .optional()
          .describe('restrict to one CFR part, e.g. "4"'),
        citation: z
          .string()
          .min(3)
          .max(120)
          .regex(/^[^\p{C}]+$/u, 'citation must not contain control characters')
          .optional()
          .describe('known governing section, e.g. "4.130" — read it first when provided'),
      },
    },
    (args) => {
      const scope = args.part === undefined ? 'all of Title 38' : `CFR part ${args.part}`;
      const anchor =
        args.citation === undefined
          ? ''
          : `0. The known governing provision is ${args.citation}: call get_section with it and read it in full first.\n`;
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Evaluate the claim issue "${args.issue}" against ${scope} using the cfr-free tools.\n` +
                anchor +
                '1. Call health; if the status is not "ready", say so before concluding anything.\n' +
                '2. Locate the governing criteria with search_regulations — try both the office ' +
                'shorthand (acronyms like PTSD/TDIU/SMC) and the spelled-out regulatory language; ' +
                'wrap exact regulatory language in "quotes" to search it as a phrase.\n' +
                '3. Read the top candidates in full with get_section and quote the operative text ' +
                'verbatim — never paraphrase rating criteria or effective-date rules.\n' +
                "4. Follow each section's references[] to connected provisions (definitions, " +
                'related criteria, cross-part rules) and read the ones that bear on the issue.\n' +
                "5. Conclude with paste-ready citations (38 C.F.R. § X.YYY) plus each provision's " +
                'sourceUrl and the index issue date; if the response flags a stale index, tell the ' +
                'user to verify the text against the current eCFR before relying on it.',
            },
          },
        ],
      };
    },
  );

  logger.debug('mcp resources and prompts registered');
}
