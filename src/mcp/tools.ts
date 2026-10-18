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
  indexIssueDate: z.string().nullable(),
  indexStale: z.boolean(),
  notice: z.string().nullable(),
  hits: z.array(
    z.object({
      citation: z.string(),
      citationDisplay: z.string(),
      sourceUrl: z.string(),
      direct: z.boolean(),
      heading: z.string(),
      part: z.string().nullable(),
      path: z.string(),
      snippet: z.string(),
      score: z.number(),
      matches: z.array(z.string()),
      inResults: z.boolean(),
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
  references: z.array(z.object({ citation: z.string(), available: z.boolean() })),
  indexStale: z.boolean(),
  notice: z.string().nullable(),
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
  structureDrift: z.boolean().nullable(),
  lastChanges: z
    .object({
      fromIssueDate: z.string().nullable(),
      toIssueDate: z.string(),
      changed: z.number(),
      added: z.number(),
      removed: z.number(),
      changedCitations: z.array(z.string()),
      addedCitations: z.array(z.string()),
      removedCitations: z.array(z.string()),
      baseline: z.boolean(),
      parserChanged: z.boolean(),
      recordedAt: z.string(),
    })
    .nullable(),
});

const listPartsOutputSchema = z.object({
  parts: z.array(
    z.object({
      part: z.string(),
      title: z.string().nullable(),
      sections: z.number(),
      appendices: z.number(),
    }),
  ),
});

const healthOutputSchema = z.object({
  status: z.enum(['empty', 'degraded', 'stale', 'ready']),
  issueDate: z.string().nullable(),
  syncedAt: z.string().nullable(),
  stale: z.boolean(),
});

type SearchOutput = z.infer<typeof searchOutputSchema>;
type SectionOutput = z.infer<typeof sectionOutputSchema>;
type BrowseOutput = z.infer<typeof browseOutputSchema>;
type StatusOutput = z.infer<typeof statusOutputSchema>;
type ListPartsOutput = z.infer<typeof listPartsOutputSchema>;
type HealthOutput = z.infer<typeof healthOutputSchema>;

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
        'Returns section citations, headings, relevance snippets, bm25 scores (lower is better) ' +
        'and the query terms visible in each hit. ' +
        'Use `part` to scope results to a single CFR part (e.g. "4" for ratings, "17" for prosthetics). ' +
        'Follow up with get_section to read a hit in full. ' +
        'If the query itself is a citation (e.g. "4.130" or "38 CFR 4.16"), that exact ' +
        'section is pinned to the top of page 1 (totals include the pin on every page) ' +
        "and marked `direct: true` — the reliable client signal; the pinned hit's " +
        '`inResults` flag reports whether it also matched the ranked results. ' +
        'Quoted spans (e.g. "exact regulatory language") are emitted as FTS5 phrase queries — the last token gets a prefix wildcard (so "language" also matches "languages"); earlier tokens are matched exactly.',
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
        const structuredContent: SearchOutput = {
          ...response,
          hits: response.hits.map((hit) => ({ ...hit, matches: [...hit.matches] })),
        };
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
        const section = service.getSection(args.citation);
        const result: SectionOutput = {
          ...section,
          references: section.references.map((reference) => ({ ...reference })),
        };
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
        const status = service.status();
        const result: StatusOutput = {
          ...status,
          lastChanges:
            status.lastChanges === null
              ? null
              : {
                  ...status.lastChanges,
                  changedCitations: [...status.lastChanges.changedCitations],
                  addedCitations: [...status.lastChanges.addedCitations],
                  removedCitations: [...status.lastChanges.removedCitations],
                },
        };
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

  server.registerTool(
    'list_parts',
    {
      title: 'List CFR parts in the local index',
      description:
        'Enumerate every Title 38 CFR part present in the local index, with its structure-tree title ' +
        'and section/appendix counts. Use this to discover which parts are searchable.',
      inputSchema: {},
      outputSchema: listPartsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const parts = service.listParts();
        const structuredContent: ListPartsOutput = {
          parts: parts.map((row) => ({ ...row })),
        };
        return {
          content: [{ type: 'text', text: textContent(structuredContent) }],
          structuredContent,
        };
      } catch (error) {
        logger.error('tool list_parts failed', { message: toClientMessage(error) });
        return {
          content: [{ type: 'text', text: `Error: ${toClientMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'health',
    {
      title: 'Index readiness',
      description:
        'One-call readiness verdict for the local index: "ready" (query away), "stale" (older than ' +
        'CFR_MAX_AGE_DAYS — verify results against the current eCFR), "degraded" (structure drift — ' +
        'provisions may be missing; verify against the current eCFR), or "empty" (no index yet — ' +
        'run `cfr-free sync`). Clients should gate queries on this before spending tool calls.',
      outputSchema: healthOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const structuredContent: HealthOutput = service.health();
        return {
          content: [{ type: 'text', text: textContent(structuredContent) }],
          structuredContent,
        };
      } catch (error) {
        logger.error('tool health failed', { message: toClientMessage(error) });
        return {
          content: [{ type: 'text', text: `Error: ${toClientMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
