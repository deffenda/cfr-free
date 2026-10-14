import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CFRService } from '../src/core/service.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { createTestLogger, openTempStore, type TempStore } from './helpers.js';

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

describe('MCP server (in-memory transport)', () => {
  let temp: TempStore;
  let client: Client;
  let serverCleanup: () => void;

  beforeEach(async () => {
    temp = openTempStore();
    const logger = createTestLogger();
    const service = new CFRService(temp.store, 7);
    const server = buildMcpServer(service, logger);
    client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    serverCleanup = () => void server.close();
  });

  afterEach(async () => {
    await client.close();
    serverCleanup();
    temp.cleanup();
  });

  it('lists all five read-only tools with annotations', async () => {
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'browse_title38',
      'get_section',
      'index_status',
      'list_parts',
      'search_regulations',
    ]);
    for (const tool of result.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(tool.description).toBeTruthy();
    }
  });

  it('search_regulations returns structured hits', async () => {
    const result = (await client.callTool({
      name: 'search_regulations',
      arguments: { query: 'mental disorder' },
    })) as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.['total']).toBeGreaterThanOrEqual(2);
    const hits = result.structuredContent?.['hits'] as unknown[];
    expect(Array.isArray(hits)).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { total: number };
    expect(parsed.total).toBe(result.structuredContent?.['total']);
  });

  it('search_regulations forwards pagination and part filters', async () => {
    const result = (await client.callTool({
      name: 'search_regulations',
      arguments: { query: 'disorder', page: 1, per_page: 1, part: '4' },
    })) as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.['perPage']).toBe(1);
    expect((result.structuredContent?.['hits'] as unknown[]).length).toBeLessThanOrEqual(1);
  });

  it('search_regulations reports validation errors as tool errors', async () => {
    const result = (await client.callTool({
      name: 'search_regulations',
      arguments: { query: 'no' },
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/error/i);
    expect(result.structuredContent).toBeUndefined();
  });

  it('get_section returns full section content', async () => {
    const result = (await client.callTool({
      name: 'get_section',
      arguments: { citation: '38 CFR 4.125' },
    })) as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.['citation']).toBe('4.125');
    expect(result.structuredContent?.['markdown']).toContain('Diagnosis of mental disorders.');
    expect(result.structuredContent?.['sourceUrl']).toContain('ecfr.gov');
  });

  it('get_section returns tool errors for unknown citations', async () => {
    const result = (await client.callTool({
      name: 'get_section',
      arguments: { citation: '99.999' },
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('no indexed content');
  });

  it('browse_title38 navigates the hierarchy', async () => {
    const root = (await client.callTool({
      name: 'browse_title38',
      arguments: {},
    })) as ToolCallResult;
    expect((root.structuredContent?.['children'] as Array<{ type: string }>)[0]?.type).toBe(
      'chapter',
    );

    const part = (await client.callTool({
      name: 'browse_title38',
      arguments: { chapter: 'I', part: '4' },
    })) as ToolCallResult;
    expect(part.structuredContent?.['node']).toMatchObject({ type: 'part', identifier: '4' });
    expect(part.structuredContent?.['path']).toHaveLength(2);
  });

  it('index_status reports freshness', async () => {
    const result = (await client.callTool({
      name: 'index_status',
      arguments: {},
    })) as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.['sections']).toBe(4);
    expect(result.structuredContent?.['issueDate']).toBe('2026-10-09');
    expect(result.structuredContent?.['maxAgeDays']).toBe(7);
    // Fixtures predate the expected-counts meta: drift is unknown, not false.
    expect(result.structuredContent?.['structureDrift']).toBeNull();
  });

  it('list_parts returns parts with titles and counts', async () => {
    const result = (await client.callTool({
      name: 'list_parts',
      arguments: {},
    })) as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const parts = result.structuredContent?.['parts'] as Array<{
      part: string;
      title: string | null;
      sections: number;
      appendices: number;
    }>;
    expect(parts).toEqual([
      { part: '4', title: 'Schedule for Rating Disabilities', sections: 2, appendices: 1 },
      { part: '17', title: 'Medical Care', sections: 1, appendices: 0 },
    ]);
  });

  it('search_regulations reports the query terms visible in each hit', async () => {
    const result = (await client.callTool({
      name: 'search_regulations',
      arguments: { query: 'mental disorder' },
    })) as ToolCallResult;
    expect(result.isError).toBeFalsy();
    const hits = result.structuredContent?.['hits'] as Array<{
      citation: string;
      matches: string[];
    }>;
    expect(hits[0]?.matches).toContain('mental');
    expect(hits[0]?.matches).toContain('disorder');
  });

  it('browse_title38 surfaces structure misses as tool errors', async () => {
    const result = (await client.callTool({
      name: 'browse_title38',
      arguments: { chapter: 'I', part: '999' },
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("part '999' not found");
  });

  it('index_status reports store failures as tool errors', async () => {
    temp.store.close();
    const result = (await client.callTool({
      name: 'index_status',
      arguments: {},
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error:');
  });

  it('list_parts reports store failures as tool errors', async () => {
    temp.store.close();
    const result = (await client.callTool({
      name: 'list_parts',
      arguments: {},
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error:');
  });

  it('exposes index metadata as MCP resources', async () => {
    const resources = await client.listResources();
    const uris = resources.resources.map((resource) => resource.uri).sort();
    expect(uris).toEqual(['cfr://index/status', 'cfr://title38/parts']);

    const status = await client.readResource({ uri: 'cfr://index/status' });
    expect(status.contents[0]?.mimeType).toBe('application/json');
    const parsed = JSON.parse((status.contents[0] as { text?: string }).text ?? '{}') as {
      issueDate: string;
      sections: number;
    };
    expect(parsed.issueDate).toBe('2026-10-09');
    expect(parsed.sections).toBe(4);

    const parts = await client.readResource({ uri: 'cfr://title38/parts' });
    const parsedParts = JSON.parse((parts.contents[0] as { text?: string }).text ?? '{}') as {
      parts: Array<Record<string, unknown>>;
    };
    expect(parsedParts.parts[0]).toMatchObject({
      part: '4',
      title: 'Schedule for Rating Disabilities',
    });
  });

  it('rejects unknown resource URIs', async () => {
    await expect(client.readResource({ uri: 'cfr://nope' })).rejects.toThrow();
  });

  it('offers a cfr_research prompt with validated arguments', async () => {
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(['cfr_research']);

    const result = await client.getPrompt({
      name: 'cfr_research',
      arguments: { topic: 'traumatic brain injury', part: '4' },
    });
    const text = (result.messages[0]?.content as { text?: string }).text ?? '';
    expect(text).toContain('traumatic brain injury');
    expect(text).toContain('CFR part 4');
    expect(text).toContain('search_regulations');

    const unscoped = await client.getPrompt({
      name: 'cfr_research',
      arguments: { topic: 'prosthetics' },
    });
    expect((unscoped.messages[0]?.content as { text?: string }).text ?? '').toContain(
      'all of Title 38',
    );

    await expect(client.getPrompt({ name: 'cfr_research', arguments: {} })).rejects.toThrow();
    await expect(
      client.getPrompt({ name: 'cfr_research', arguments: { topic: 'x' } }),
    ).rejects.toThrow();
  });

  it('search_regulations reports store failures as tool errors', async () => {
    temp.store.close();
    const result = (await client.callTool({
      name: 'search_regulations',
      arguments: { query: 'mental disorder' },
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Error:');
  });

  it('reports non-Error failures as unknown error', async () => {
    const badService = new Proxy({} as CFRService, {
      get: () => () => {
        throw 'boom';
      },
    });
    const server = buildMcpServer(badService, createTestLogger());
    const probe = new Client({ name: 'probe', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), probe.connect(clientTransport)]);
    try {
      const result = (await probe.callTool({
        name: 'index_status',
        arguments: {},
      })) as ToolCallResult;
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('unknown error');
    } finally {
      await probe.close();
      await server.close();
    }
  });
});
