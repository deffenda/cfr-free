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
    // Fixtures predate the expected-counts meta: drift unknown, not false.
    expect(body['structureDrift']).toBeNull();
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('exposes Prometheus metrics at /metrics', async () => {
    const response = await fetch(`${base}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toContain('# TYPE cfr_free_sections gauge');
    expect(text).toContain('cfr_free_sections 4');
    expect(text).toContain('cfr_free_appendices 1');
    expect(text).toContain('cfr_free_stale 0');
    expect(text).toContain('cfr_free_max_age_days 7');
    // 2026-10-09T00:00:00Z as epoch seconds.
    expect(text).toContain('cfr_free_issue_date_timestamp_seconds 1791504000');
    // Fixtures predate the expectation meta: drift metric is absent, not 0.
    expect(text).not.toContain('cfr_free_structure_drift');
  });

  it('emits the drift gauge in both states once expectations are recorded', async () => {
    // Live rows (0 after an empty replaceAll) vs expectations 0+0: no drift.
    temp.store.replaceAll([], '2026-10-09', {
      synced_at: new Date().toISOString(),
      appendices_count: '0',
      structure_expected_sections: '0',
      structure_expected_appendices: '0',
    });
    const clean = await (await fetch(`${base}/metrics`)).text();
    expect(clean).toContain('cfr_free_structure_drift 0');

    // Expectations 3+1 but zero live rows: drift is visible.
    temp.store.replaceAll([], '2026-10-09', {
      synced_at: new Date().toISOString(),
      appendices_count: '1',
      structure_expected_sections: '3',
      structure_expected_appendices: '1',
    });
    const drifted = await (await fetch(`${base}/metrics`)).text();
    expect(drifted).toContain('cfr_free_structure_drift 1');
  });

  it('serves /metrics for HEAD without a body', async () => {
    const response = await fetch(`${base}/metrics`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('');
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
    // Number('abc') is NaN — rejected by schema validation before any SQL.
    expect((await get('/api/v1/search?q=mental&page=abc')).status).toBe(400);
    expect((await get('/api/v1/search?q=mental&page=2.5')).status).toBe(400);
    expect((await get('/api/v1/search?q=mental&per_page=999')).status).toBe(400);
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

  it('renders metrics for an index that was never synced', async () => {
    const fresh = openTempStore({ seed: false });
    const empty = createHttpServer(new CFRService(fresh.store, 7), createTestLogger());
    await new Promise<void>((resolve) => empty.listen(0, '127.0.0.1', resolve));
    const port = (empty.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      const text = await response.text();
      expect(response.status).toBe(200);
      // Never synced: stale flag on, unknown timestamps zeroed.
      expect(text).toContain('cfr_free_stale 1');
      expect(text).toContain('cfr_free_issue_date_timestamp_seconds 0');
      expect(text).toContain('cfr_free_synced_at_timestamp_seconds 0');
    } finally {
      await new Promise<void>((resolve) => {
        empty.close(() => resolve());
        empty.closeAllConnections();
      });
      fresh.cleanup();
    }
  });

  it('renders an unparseable issue date as epoch 0', async () => {
    temp.store.setMeta('issue_date', 'not-a-date');
    const response = await fetch(`${base}/metrics`);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain('cfr_free_issue_date_timestamp_seconds 0');
  });

  it('logs non-Error dispatch failures with a stringified message', async () => {
    const logger = createTestLogger();
    const service = new CFRService(temp.store, 7);
    service.search = () => {
      throw 'boom';
    };
    const custom = createHttpServer(service, logger);
    await new Promise<void>((resolve) => custom.listen(0, '127.0.0.1', resolve));
    const port = (custom.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/search?q=anything`);
      expect(response.status).toBe(500);
      expect(
        logger.records.some(
          (record) => record.level === 'error' && record.fields?.['message'] === 'boom',
        ),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve) => {
        custom.close(() => resolve());
        custom.closeAllConnections();
      });
    }
  });
});

describe('Titan HTTP request-size caps', () => {
  let temp: TempStore;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    temp = openTempStore();
    server = createHttpServer(new CFRService(temp.store, 7), createTestLogger());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    temp.cleanup();
  });

  it('rejects URLs and query values that exceed the byte caps', async () => {
    // q above 800 bytes but URL under 2048 → 400 at the param cap
    const bigQ = new URLSearchParams({ q: 'x'.repeat(850) }).toString();
    const paramResponse = await fetch(`${base}/api/v1/search?${bigQ}`);
    expect(paramResponse.status).toBe(400);
    expect(((await paramResponse.json()) as Json)['error']).toBe('invalid_input');

    // oversized part parameter
    const partResponse = await fetch(`${base}/api/v1/search?q=mental&part=${'1'.repeat(20)}`);
    expect(partResponse.status).toBe(400);
    expect(((await partResponse.json()) as Json)['message']).toContain('part exceeds');

    // whole URL above 2048 bytes → 414 before validation
    const hugeResponse = await fetch(`${base}/api/v1/search?q=${'y'.repeat(3000)}`);
    expect(hugeResponse.status).toBe(414);
    expect(((await hugeResponse.json()) as Json)['error']).toBe('uri_too_long');
  });

  it('still serves valid queries under the caps', async () => {
    const response = await fetch(`${base}/api/v1/search?q=${encodeURIComponent('§ 4.125')}`);
    expect(response.status).toBe(200);
  });
});

describe('Titan HTTP rate limiting', () => {
  let temp: TempStore;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    temp = openTempStore();
  });

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
    temp.cleanup();
  });

  it('answers 429 with retry-after once the peer budget is spent', async () => {
    server = createHttpServer(new CFRService(temp.store, 7), createTestLogger(), {
      rateLimit: { capacity: 1, refillPerSec: 0.1 },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const first = await fetch(`${base}/health`);
    expect(first.status).toBe(200);

    const second = await fetch(`${base}/health`);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(((await second.json()) as Json)['error']).toBe('rate_limited');
  });

  it('never limits without an explicit rateLimit option (loopback default)', async () => {
    server = createHttpServer(new CFRService(temp.store, 7), createTestLogger());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    for (let i = 0; i < 50; i += 1) {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
    }
  });
});
