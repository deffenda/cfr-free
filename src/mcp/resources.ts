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
        topic: z.string().min(3).max(200).describe('the benefits/regulatory topic to research'),
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

  logger.debug('mcp resources and prompts registered');
}
