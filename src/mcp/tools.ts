import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../logger.js';
import type { CFRService } from '../core/service.js';

/**
 * MCP tool registrations. Every tool is read-only over the local index:
 * no network access happens during tool calls (`openWorldHint: false`).
 */

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const searchOutputSchema = z.object({
  query: z.string(),
  page: z.number(),
  perPage: z.number(),
  total: z.number(),
  matchMode: z.enum(['and', 'or']),
  hits: z.array(
    z.object({
      citation: z.string(),
      heading: z.string(),
      part: z.string().nullable(),
      path: z.string(),
      snippet: z.string(),
      score: z.number(),
    }),
  ),
});

const sectionOutputSchema = z.object({
  citation: z.string(),
  kind: z.enum(['section', 'appendix']),
  heading: z.string(),
  chapter: z.string().nullable(),
  part: z.string().nullable(),
  subpart: z.string().nullable(),
  path: z.string(),
  issueDate: z.string(),
  markdown: z.string(),
  text: z.string(),
  sourceUrl: z.string(),
});

const structureEntrySchema = z.object({
  type: z.string(),
  identifier: z.string(),
  label: z.string(),
});

const browseOutputSchema = z.object({
  node: structureEntrySchema,
  path: z.array(structureEntrySchema),
  children: z.array(structureEntrySchema),
});

const statusOutputSchema = z.object({
  issueDate: z.string().nullable(),
  syncedAt: z.string().nullable(),
  sections: z.number(),
  appendices: z.number(),
  stale: z.boolean(),
  maxAgeDays: z.number(),
  parserVersion: z.string().nullable(),
});

type SearchOutput = z.infer<typeof searchOutputSchema>;
type SectionOutput = z.infer<typeof sectionOutputSchema>;
type BrowseOutput = z.infer<typeof browseOutputSchema>;
type StatusOutput = z.infer<typeof statusOutputSchema>;

function textContent(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function toClientMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'unknown error';
}

/** Register all tools on the server. */
export function registerTools(server: McpServer, service: CFRService, logger: Logger): void {
  server.registerTool(
    'search_regulations',
    {
      title: 'Search Title 38 CFR regulations',
      description:
        'Full-text search across the local Title 38 (VA) CFR index using ranked keyword matching. ' +
        'Returns section citations, headings, relevance snippets and bm25 scores (lower is better). ' +
        'Use `part` to scope results to a single CFR part (e.g. "4" for ratings, "17" for prosthetics). ' +
        'Follow up with get_section to read a hit in full.',
      inputSchema: {
        query: z
          .string()
          .min(3)
          .max(200)
          .describe('search terms, e.g. "traumatic brain injury compensation"'),
        page: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .optional()
          .describe('1-based result page (default 1)'),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('results per page (default 10, max 20)'),
        part: z
          .string()
          .regex(/^\d{1,3}$/)
          .optional()
          .describe('restrict to one CFR part number'),
      },
      outputSchema: searchOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        const response = service.search({
          query: args.query,
          page: args.page,
          perPage: args.per_page,
          part: args.part,
        });
        const structuredContent: SearchOutput = { ...response, hits: [...response.hits] };
        return {
          content: [{ type: 'text', text: textContent(structuredContent) }],
          structuredContent,
        };
      } catch (error) {
        logger.error('tool search_regulations failed', { message: toClientMessage(error) });
        return {
          content: [{ type: 'text', text: `Error: ${toClientMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'get_section',
    {
      title: 'Read a CFR section',
      description:
        'Fetch the full text of one Title 38 CFR section or appendix as markdown. Accepts flexible citations: ' +
        '"4.125", "§ 4.125", "38 CFR 4.125", or appendix names like "Appendix A to Part 4". ' +
        'Returns heading, hierarchy path, issue date and an ecfr.gov permalink.',
      inputSchema: {
        citation: z.string().min(1).max(120).describe('the citation to read, e.g. "38 CFR 4.125"'),
      },
      outputSchema: sectionOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        const result: SectionOutput = service.getSection(args.citation);
        return {
          content: [{ type: 'text', text: textContent(result) }],
          structuredContent: result,
        };
      } catch (error) {
        logger.error('tool get_section failed', { message: toClientMessage(error) });
        return {
          content: [{ type: 'text', text: `Error: ${toClientMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'browse_title38',
    {
      title: 'Browse the CFR structure',
      description:
        'Navigate the Title 38 hierarchy (title → chapter → part → subpart) and list what exists at a level. ' +
        'With no arguments, returns the chapters. Use this to discover valid parts/subparts before searching.',
      inputSchema: {
        chapter: z.string().max(20).optional().describe('chapter identifier, e.g. "I"'),
        part: z.string().max(20).optional().describe('part number, e.g. "4"'),
        subpart: z.string().max(20).optional().describe('subpart letter, e.g. "B" (requires part)'),
      },
      outputSchema: browseOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        const response = service.browse({
          chapter: args.chapter,
          part: args.part,
          subpart: args.subpart,
        });
        const structuredContent: BrowseOutput = {
          node: response.node,
          path: [...response.path],
          children: [...response.children],
        };
        return {
          content: [{ type: 'text', text: textContent(structuredContent) }],
          structuredContent,
        };
      } catch (error) {
        logger.error('tool browse_title38 failed', { message: toClientMessage(error) });
        return {
          content: [{ type: 'text', text: `Error: ${toClientMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'index_status',
    {
      title: 'Local index freshness',
      description:
        'Report how current the local Title 38 index is: eCFR issue date, last sync time, row counts and ' +
        'whether the index is stale relative to CFR_MAX_AGE_DAYS. Check this before relying on search results.',
      outputSchema: statusOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const result: StatusOutput = service.status();
        return {
          content: [{ type: 'text', text: textContent(result) }],
          structuredContent: result,
        };
      } catch (error) {
        logger.error('tool index_status failed', { message: toClientMessage(error) });
        return {
          content: [{ type: 'text', text: `Error: ${toClientMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
