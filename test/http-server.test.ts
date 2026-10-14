import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type http from 'node:http';
import { CFRService } from '../src/core/service.js';
import { createHttpServer } from '../src/titan/http-server.js';
import { createTestLogger, openTempStore, type TempStore } from './helpers.js';

interface Json {
  [key: string]: unknown;
}

describe('Titan HTTP API', () => {
  let temp: TempStore;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    temp = openTempStore();
    const logger = createTestLogger();
    server = createHttpServer(new CFRService(temp.store, 7), logger);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    temp.cleanup();
  });

  async function get(
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: Json; headers: Headers }> {
    const response = await fetch(`${base}${pathname}`, init);
    const text = await response.text();
    const body = text.length > 0 ? (JSON.parse(text) as Json) : {};
    return { status: response.status, body, headers: response.headers };
  }

  it('serves health with freshness metadata', async () => {
    const { status, body, headers } = await get('/health');
    expect(status).toBe(200);
    expect(body['status']).toBe('ok');
    expect(body['sections']).toBe(4);
    expect(body['issueDate']).toBe('2026-10-09');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('searches with validated query params', async () => {
    const { status, body } = await get('/api/v1/search?q=mental+disorder');
    expect(status).toBe(200);
    expect(Number(body['total'])).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(body['hits'])).toBe(true);
  });

  it('supports pagination and part filters', async () => {
    const { body } = await get('/api/v1/search?q=disorder&page=1&per_page=1&part=4');
    expect((body['hits'] as unknown[]).length).toBeLessThanOrEqual(1);
    expect(body['perPage']).toBe(1);
    expect(body['part']).toBeUndefined();
  });

  it('rejects missing or invalid search input', async () => {
    expect((await get('/api/v1/search')).status).toBe(400);
    expect((await get('/api/v1/search?q=no')).status).toBe(400);
    expect((await get('/api/v1/search?q=mental+disorder&part=abc')).status).toBe(400);
  });

  it('returns full sections by citation', async () => {
    const { status, body, headers } = await get('/api/v1/sections/4.125');
    expect(status).toBe(200);
    expect(body['citation']).toBe('4.125');
    expect(headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('handles URL-encoded citations', async () => {
    const { status, body } = await get('/api/v1/sections/Appendix%20A%20to%20Part%204');
    expect(status).toBe(200);
    expect(body['kind']).toBe('appendix');
  });

  it('maps unknown citations to 404', async () => {
    const { status, body } = await get('/api/v1/sections/99.999');
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
  });

  it('maps invalid citations to 400', async () => {
    const { status, body } = await get('/api/v1/sections/not-a-citation');
    expect(status).toBe(400);
    expect(body['error']).toBe('invalid_input');
  });

  it('rejects malformed percent-encoding', async () => {
    const { status, body } = await get('/api/v1/sections/%E0%A4%A');
    expect(status).toBe(400);
    expect(body['error']).toBe('invalid_input');
  });

  it('browses the hierarchy', async () => {
    const root = await get('/api/v1/browse');
    expect(root.status).toBe(200);
    expect((root.body['children'] as Json[])[0]?.['type']).toBe('chapter');

    const part = await get('/api/v1/browse?chapter=I&part=4');
    expect(part.status).toBe(200);
    expect((part.body['node'] as Json)['identifier']).toBe('4');
  });

  it('returns structure misses as 404 with available identifiers', async () => {
    const { status, body } = await get('/api/v1/browse?chapter=I&part=999');
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
    expect(body['available']).toEqual(['4', '17']);
  });

  it('404s unknown routes', async () => {
    const { status, body } = await get('/nope');
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
  });

  it('405s non-GET methods with an Allow header', async () => {
    const { status, body, headers } = await get('/health', { method: 'POST' });
    expect(status).toBe(405);
    expect(body['error']).toBe('method_not_allowed');
    expect(headers.get('allow')).toBe('GET, HEAD');
  });

  it('serves HEAD requests without a body', async () => {
    const response = await fetch(`${base}/health`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('masks unexpected failures as generic 500s', async () => {
    const logger = createTestLogger();
    const exploding = {
      search: () => {
        throw new Error('secret internal detail');
      },
    } as unknown as CFRService;
    const custom = createHttpServer(exploding, logger);
    await new Promise<void>((resolve) => custom.listen(0, '127.0.0.1', resolve));
    const port = (custom.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/search?q=anything`);
      expect(response.status).toBe(500);
      const body = (await response.json()) as Json;
      expect(body['error']).toBe('internal_error');
      expect(JSON.stringify(body)).not.toContain('secret');
      expect(logger.records.some((record) => record.level === 'error')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => {
        custom.close(() => resolve());
        custom.closeAllConnections();
      });
    }
  });
});
