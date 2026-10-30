import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type http from 'node:http';
import type { EcfrApi } from '../src/core/ecfr.js';
import { POINT_IN_TIME_NOTICE } from '../src/core/point-in-time.js';
import { CFRService } from '../src/core/service.js';
import { createHttpServer, type HttpServerOptions } from '../src/titan/http-server.js';
import { createTestLogger, makeSection, openTempStore, type TempStore } from './helpers.js';

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

  /** Start an ad-hoc server with `options`; returns status + raw body text. */
  async function fetchWith(
    options: HttpServerOptions,
    pathname: string,
  ): Promise<{ status: number; text: string }> {
    const custom = createHttpServer(new CFRService(temp.store, 7), createTestLogger(), options);
    await new Promise<void>((resolve) => custom.listen(0, '127.0.0.1', resolve));
    const port = (custom.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
      return { status: response.status, text: await response.text() };
    } finally {
      await new Promise<void>((resolve) => {
        custom.close(() => resolve());
        custom.closeAllConnections();
      });
    }
  }

  const DISK_SNAPSHOT = { freeBytes: 123_456_789, totalBytes: 987_654_321 } as const;

  it('adds diskFree/diskTotal to /health when the disk accessor yields a snapshot', async () => {
    const { status, text } = await fetchWith({ disk: () => DISK_SNAPSHOT }, '/health');
    expect(status).toBe(200);
    const body = JSON.parse(text) as Json;
    expect(body['diskFree']).toBe(123_456_789);
    expect(body['diskTotal']).toBe(987_654_321);
  });

  it('omits the disk fields from /health when no accessor is configured', async () => {
    const { body } = await get('/health');
    expect(body).not.toHaveProperty('diskFree');
    expect(body).not.toHaveProperty('diskTotal');
  });

  it('omits the disk fields from /health when the accessor returns null', async () => {
    const { status, text } = await fetchWith({ disk: () => null }, '/health');
    expect(status).toBe(200);
    const body = JSON.parse(text) as Json;
    expect(body).not.toHaveProperty('diskFree');
    expect(body).not.toHaveProperty('diskTotal');
  });

  it('renders disk gauges with injected values when a snapshot is available', async () => {
    const { status, text } = await fetchWith({ disk: () => DISK_SNAPSHOT }, '/metrics');
    expect(status).toBe(200);
    expect(text).toContain('# HELP cfr_free_disk_free_bytes');
    expect(text).toContain('# TYPE cfr_free_disk_free_bytes gauge');
    expect(text).toContain('cfr_free_disk_free_bytes 123456789');
    expect(text).toContain('# HELP cfr_free_disk_total_bytes');
    expect(text).toContain('cfr_free_disk_total_bytes 987654321');
  });

  it('omits every cfr_free_disk line when no snapshot is available', async () => {
    // Accessor absent (default server) and accessor present but null.
    const absent = await (await fetch(`${base}/metrics`)).text();
    expect(absent).not.toContain('cfr_free_disk');
    const nulled = await fetchWith({ disk: () => null }, '/metrics');
    expect(nulled.text).not.toContain('cfr_free_disk');
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

  it('carries the term grounding on the wire', async () => {
    const { status, body } = await get('/api/v1/search?q=mental+disorder');
    expect(status).toBe(200);
    expect(Array.isArray(body['matchedTerms'])).toBe(true);
    expect(Array.isArray(body['unmatchedTerms'])).toBe(true);
    // The two partition the query's content terms.
    const matched = body['matchedTerms'] as string[];
    const unmatched = body['unmatchedTerms'] as string[];
    expect(matched).toContain('mental');
    expect(unmatched).toEqual([]);
  });

  it('supports pagination and part filters', async () => {
    const { body } = await get('/api/v1/search?q=disorder&page=1&per_page=1&part=4');
    expect((body['hits'] as unknown[]).length).toBeLessThanOrEqual(1);
    expect(body['perPage']).toBe(1);
    expect(body['part']).toBeUndefined();
  });

  it('supports kind and chapter search filters', async () => {
    const { status, body } = await get('/api/v1/search?q=rating+schedule&kind=appendix&chapter=I');
    expect(status).toBe(200);
    expect(body['total']).toBe(1);
    const hits = body['hits'] as Array<{ citation: string }>;
    expect(hits.map((hit) => hit.citation)).toEqual(['Appendix A to Part 4']);
  });

  it('rejects invalid kind and chapter search filters', async () => {
    // Both fail the service's input schema → the standard 400 invalid_input path.
    const kind = await get('/api/v1/search?q=mental+disorder&kind=policy');
    expect(kind.status).toBe(400);
    expect(kind.body['error']).toBe('invalid_input');
    const chapter = await get('/api/v1/search?q=mental+disorder&chapter=4');
    expect(chapter.status).toBe(400);
    expect(chapter.body['error']).toBe('invalid_input');
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
    // Fixture sections cite nothing: the backlink list is present but empty.
    expect(body['citedBy']).toEqual([]);
    expect(headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('resolves the dotted citation the search hit displays (P1-03)', async () => {
    // The displayed legal form must be readable straight back over HTTP.
    const { status, body } = await get(
      '/api/v1/sections/' + encodeURIComponent('38 C.F.R. \u00a7 4.125'),
    );
    expect(status).toBe(200);
    expect(body['citation']).toBe('4.125');
  });

  it('serves the dated source URL alongside the current one (M2(a))', async () => {
    const { status, body } = await get('/api/v1/sections/4.125');
    expect(status).toBe(200);
    expect(body['sourceUrl']).toBe('https://www.ecfr.gov/current/title-38/section-4.125');
    expect(String(body['sourceUrlAtIndexDate'])).toMatch(
      /^https:\/\/www\.ecfr\.gov\/on\/\d{4}-\d{2}-\d{2}\/title-38\/section-4\.125$/,
    );
  });

  it('surfaces citedBy backlinks on the wire', async () => {
    // Self-contained store: the shared fixture seed has no citation edges, so
    // a real backlink needs its own two-section index (4.131 → § 4.130).
    const seeded = openTempStore({
      sections: [
        makeSection({ citation: '4.130', text: 'Evaluation rules for mental disorder claims.' }),
        makeSection({ citation: '4.131', text: 'See § 4.130 for the evaluation procedure.' }),
      ],
    });
    const custom = createHttpServer(new CFRService(seeded.store, 7), createTestLogger());
    await new Promise<void>((resolve) => custom.listen(0, '127.0.0.1', resolve));
    const port = (custom.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/sections/4.130`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(body['citedBy']).toEqual(['4.131']);
    } finally {
      await new Promise<void>((resolve) => {
        custom.close(() => resolve());
        custom.closeAllConnections();
      });
      seeded.cleanup();
    }
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

  it('descends into a subject group over the wire', async () => {
    const group = await get('/api/v1/browse?chapter=I&part=17&subjgrp=ECFRfixturegroup0001');
    expect(group.status).toBe(200);
    expect((group.body['node'] as Json)['type']).toBe('subject_group');
    expect((group.body['children'] as Json[])[0]?.['identifier']).toBe('17.15');
  });

  it('400s a subject-group request that names no part', async () => {
    const { status, body } = await get('/api/v1/browse?chapter=I&subjgrp=ECFRfixturegroup0001');
    expect(status).toBe(400);
    expect(body['error']).toBe('invalid_input');
  });

  it('404s an unknown subject group', async () => {
    const { status, body } = await get('/api/v1/browse?chapter=I&part=17&subjgrp=ECFRnope');
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
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

  it('answers 400 invalid_input when the request URL cannot be parsed', async () => {
    // fetch() normalizes URLs, so drive a raw socket. Verified empirically:
    // Node's HTTP parser delivers the absolute-form target
    // `http://example.com:-1/` verbatim as req.url, while
    // `new URL(req.url, 'http://localhost')` throws on the invalid port —
    // hitting precheck's malformed-URL arm, not the 414 byte-cap path.
    const port = (server.address() as AddressInfo).port;
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(
          'GET http://example.com:-1/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        );
      });
      let received = '';
      socket.setEncoding('latin1');
      socket.on('data', (chunk) => {
        received += chunk;
      });
      socket.on('close', () => resolve(received));
      socket.on('error', reject);
    });
    expect(raw.startsWith('HTTP/1.1 400')).toBe(true);
    expect(raw).toContain('"error":"invalid_input"');
    expect(raw).toContain('malformed request URL');
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

describe('Cross-Origin-Resource-Policy', () => {
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

  /** Fetch `pathname`, drain the body, return status + the CORP header. */
  async function corpOf(
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; corp: string | null }> {
    const response = await fetch(`${base}${pathname}`, init);
    await response.arrayBuffer();
    return {
      status: response.status,
      corp: response.headers.get('cross-origin-resource-policy'),
    };
  }

  it('sends same-origin CORP on GET /health', async () => {
    const { status, corp } = await corpOf('/health');
    expect(status).toBe(200);
    expect(corp).toBe('same-origin');
  });

  it('sends same-origin CORP on GET /metrics', async () => {
    const { status, corp } = await corpOf('/metrics');
    expect(status).toBe(200);
    expect(corp).toBe('same-origin');
  });

  it('sends same-origin CORP on a successful search', async () => {
    const { status, corp } = await corpOf('/api/v1/search?q=mental+disorder');
    expect(status).toBe(200);
    expect(corp).toBe('same-origin');
  });

  it('sends same-origin CORP on validation errors', async () => {
    const { status, corp } = await corpOf('/api/v1/search');
    expect(status).toBe(400);
    expect(corp).toBe('same-origin');
  });

  it('sends same-origin CORP on HEAD responses', async () => {
    const { status, corp } = await corpOf('/health', { method: 'HEAD' });
    expect(status).toBe(200);
    expect(corp).toBe('same-origin');
  });

  it('sends same-origin CORP on 404s for unknown routes', async () => {
    const { status, corp } = await corpOf('/nope');
    expect(status).toBe(404);
    expect(corp).toBe('same-origin');
  });
});

describe('Titan web UI routes', () => {
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

  /** Fetch a UI route with any method; returns status, raw text, headers. */
  async function fetchUi(
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; text: string; headers: Headers }> {
    const response = await fetch(`${base}${pathname}`, init);
    return { status: response.status, text: await response.text(), headers: response.headers };
  }

  // The exact policy string pinned for the HTML document (UI_CSP in
  // src/titan/ui.ts): any drift on either side must fail here.
  const EXPECTED_CSP =
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

  const UI_ROUTES = [
    { path: '/', contentType: 'text/html; charset=utf-8' },
    { path: '/ui.js', contentType: 'text/javascript; charset=utf-8' },
    { path: '/ui.css', contentType: 'text/css; charset=utf-8' },
  ] as const;

  for (const route of UI_ROUTES) {
    it(`GET ${route.path} serves ${route.contentType} with hardening headers`, async () => {
      const { status, text, headers } = await fetchUi(route.path);
      expect(status).toBe(200);
      expect(text.length).toBeGreaterThan(0);
      expect(headers.get('content-type')).toBe(route.contentType);
      expect(headers.get('x-content-type-options')).toBe('nosniff');
      expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(headers.get('cache-control')).toBe('no-store');
    });

    it(`HEAD ${route.path} answers with the same headers and an empty body`, async () => {
      const get = await fetchUi(route.path);
      const head = await fetchUi(route.path, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.text).toBe('');
      expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
      expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
      expect(head.headers.get('cache-control')).toBe('no-store');
      expect(head.headers.get('x-content-type-options')).toBe('nosniff');
      expect(head.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    });
  }

  it('sends the pinned CSP verbatim on / (GET and HEAD)', async () => {
    const get = await fetchUi('/');
    expect(get.headers.get('content-security-policy')).toBe(EXPECTED_CSP);
    const head = await fetchUi('/', { method: 'HEAD' });
    expect(head.headers.get('content-security-policy')).toBe(EXPECTED_CSP);
  });

  it('pinned posture: served HTML has no inline handlers, no inline styles, and exactly one script tag (the /ui.js reference)', async () => {
    const { text: html } = await fetchUi('/');
    // No `on*=` attribute anywhere (no inline event handlers).
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z-]+\s*=/i);
    // No inline <style> and no style="" attribute (style-src 'self' would
    // block them; the UI must ship zero inline styling).
    expect(html).not.toContain('<style');
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle=/i);
    // Exactly one <script> element, and it is the external reference.
    expect(html.match(/<script/g) ?? []).toHaveLength(1);
    expect(html).toContain('<script src="/ui.js"></script>');
  });

  it('pinned posture: ui.js never touches innerHTML/outerHTML, insertAdjacentHTML, document.write, style props, or on*= handlers', async () => {
    const { text: uiJs } = await fetchUi('/ui.js');
    // All dynamic content goes through createElement/textContent; any of
    // these sinks would reopen an HTML-injection path for index content.
    expect(uiJs).not.toMatch(/(inner|outer)HTML/);
    expect(uiJs).not.toContain('insertAdjacentHTML');
    expect(uiJs).not.toContain('document.write');
    // The JS side of the posture too: no style mutation, no property-assigned
    // event handlers (the HTML pin covers the markup side of on*=/style=).
    expect(uiJs).not.toMatch(/\.(style|on[a-z-]+)\s*=/);
  });

  it('pinned posture: the served HTML carries both view tabs and the browse view shell', async () => {
    const { text: html } = await fetchUi('/');
    // Both tab affordances live in the header's Views nav, as plain hash links.
    const tabs = (html.match(/<nav[^>]*aria-label="Views"[^>]*>[\s\S]*?<\/nav>/) ?? [''])[0];
    // The tabs carry ids: the client script finds them by id to mark the
    // current one with `aria-current`.
    expect(tabs).toContain('<a id="tab-search" href="#/search">Search</a>');
    expect(tabs).toContain('<a id="tab-browse" href="#/browse">Browse</a>');
    // The browse view's static shell (error line, breadcrumb nav, heading, list).
    expect(html).toContain('id="browse-view"');
    expect(html).toContain('id="browse-crumbs"');
    expect(html).toContain('id="browse-list"');
  });

  it('pinned posture: ui.js guards route ownership (a late response cannot repaint a route the user left)', async () => {
    // Behaviour is proven in test/ui.test.ts, which EXECUTES this served
    // script against a DOM/fetch stub; these string pins keep the guard
    // from being deleted silently (the served script is what ships).
    const { text: uiJs } = await fetchUi('/ui.js');
    expect(uiJs).toContain('routeGeneration');
    expect(uiJs).toContain('if (generation !== routeGeneration) return;');
  });

  it('pinned posture: ui.js pins both hash routes and builds the /api/v1/browse URL from all four query names', async () => {
    const { text: uiJs } = await fetchUi('/ui.js');
    // The two hash routes that must resolve in parseHash (unknown hashes fall
    // through to search), and the browse URL builder with chapter/part/subpart.
    expect(uiJs).toContain("'#/search'");
    expect(uiJs).toContain("'#/browse'");
    expect(uiJs).toContain('function browseUrl(level) {');
    expect(uiJs).toContain("if (level.chapter !== '') params.set('chapter', level.chapter);");
    expect(uiJs).toContain("if (level.part !== '') params.set('part', level.part);");
    expect(uiJs).toContain("if (level.subpart !== '') params.set('subpart', level.subpart);");
    expect(uiJs).toContain("if (level.subjgrp !== '') params.set('subjgrp', level.subjgrp);");
    expect(uiJs).toContain("return '/api/v1/browse' + (query === '' ? '' : '?' + query);");
    // Leaf links go through the section reader route — never raw hrefs.
    expect(uiJs).toContain('leaf.href = sectionHref(String(entry.identifier));');
  });

  it('keeps 404 for anything that is not an exact UI route', async () => {
    for (const path of ['/ui', '/ui.js.map', '/UI', '/index.html', '/ui.css/']) {
      const { status, headers } = await fetchUi(path);
      expect(status, `${path} must stay a 404`).toBe(404);
      expect(headers.get('content-type')).toContain('application/json');
    }
  });
});

describe('Titan HTTP /api/v1/diff', () => {
  const FROM_DATE = '2026-01-01';
  const TO_DATE = '2026-06-01';
  const DIFF_QUERY = `from=${FROM_DATE}&to=${TO_DATE}`;

  // Stub builders duplicated per suite (test/helpers.ts is not in this
  // packet's allowlist) — same minimal full-title shape test/diff.test.ts uses.
  function diffXml(sections: string): string {
    return `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>${sections}</DIV5></DIV3></DIV1>`;
  }

  function diffSection(citation: string, body: string): string {
    return `<DIV8 N="${citation}" TYPE="SECTION"><HEAD>§ ${citation} Test.</HEAD><P>${body}</P></DIV8>`;
  }

  const DIFF_FROM_XML = diffXml(
    diffSection('4.125', 'Original body.') + diffSection('4.130', 'RFC text.'),
  );
  const DIFF_TO_XML = diffXml(
    diffSection('4.125', 'Amended body.') + diffSection('4.130', 'RFC text.'),
  );

  /**
   * Offline eCFR stub keyed by date; unknown dates reject like the upstream
   * does, carrying the status the real client throws.
   *
   * The default is 500 — a genuine upstream failure, which the API masks as
   * a generic 500. A 404 is a different thing: eCFR has no revision for
   * that date, which is the reader's argument, not a service failure.
   */
  function stubEcfr(
    xmlByDate: Readonly<Record<string, string>> = {},
    failureStatus = 500,
  ): EcfrApi {
    return {
      getFullTitleXml: async (issueDate: string) => {
        const xml = xmlByDate[issueDate];
        if (xml === undefined) {
          const error = new Error(`HTTP ${failureStatus} for ${issueDate}`) as Error & {
            status?: number;
          };
          error.status = failureStatus;
          throw error;
        }
        return xml;
      },
    } as unknown as EcfrApi;
  }

  const happyEcfr = (): EcfrApi => stubEcfr({ [FROM_DATE]: DIFF_FROM_XML, [TO_DATE]: DIFF_TO_XML });

  let temp: TempStore;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    temp = openTempStore();
    server = createHttpServer(
      new CFRService(temp.store, 7, happyEcfr(), createTestLogger()),
      createTestLogger(),
    );
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

  async function get(
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: Json; headers: Headers; text: string }> {
    const response = await fetch(`${base}${pathname}`, init);
    const text = await response.text();
    const body = text.length > 0 ? (JSON.parse(text) as Json) : {};
    return { status: response.status, body, headers: response.headers, text };
  }

  /** Start an ad-hoc server around `service`; returns status + parsed body. */
  async function withService(
    service: CFRService,
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: Json; headers: Headers; text: string }> {
    const custom = createHttpServer(service, createTestLogger());
    await new Promise<void>((resolve) => custom.listen(0, '127.0.0.1', resolve));
    const port = (custom.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
      const text = await response.text();
      const body = text.length > 0 ? (JSON.parse(text) as Json) : {};
      return { status: response.status, body, headers: response.headers, text };
    } finally {
      await new Promise<void>((resolve) => {
        custom.close(() => resolve());
        custom.closeAllConnections();
      });
    }
  }

  it('serves a capped two-date diff as JSON', async () => {
    const { status, body, headers } = await get(`/api/v1/diff?${DIFF_QUERY}`);
    expect(status).toBe(200);
    expect(body).toEqual({
      fromIssueDate: FROM_DATE,
      toIssueDate: TO_DATE,
      changed: ['4.125'],
      added: [],
      removed: [],
      truncated: false,
      notice: POINT_IN_TIME_NOTICE,
    });
    expect(headers.get('content-type')).toContain('application/json');
    expect(headers.get('cache-control')).toBe('public, max-age=3600');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
    // The diff route fetches from eCFR per call: it is not an index-backed
    // read, so it carries no validator and never answers a 304.
    expect(headers.get('etag')).toBeNull();
  });

  it('rejects missing or empty date params with 400 before the service', async () => {
    for (const query of ['', 'from=', `to=${TO_DATE}`, `from=${FROM_DATE}&to=`]) {
      const { status, body } = await get(`/api/v1/diff?${query}`);
      expect(status, `query "${query}" must be a 400`).toBe(400);
      expect(body['error']).toBe('invalid_input');
      expect(String(body['message'])).toContain('both');
    }
  });

  it('rejects an impossible date with 400 before any fetch', async () => {
    const { status, body } = await get(`/api/v1/diff?from=2026-13-01&to=${TO_DATE}`);
    expect(status).toBe(400);
    expect(body['error']).toBe('invalid_input');
    expect(String(body['message'])).toContain('month 01-12');
    // Nothing was fetched: the core check runs before the eCFR client.
    expect(String(body['message'])).not.toContain('internal server error');
  });

  it('answers a clean mapped 400 when no eCFR client was injected', async () => {
    // Default construction (2-arg) — the facade fails closed; the packet
    // allows "500/ServiceError-mapped", and statusFor maps invalid_input to a
    // 400 with the client-safe message rather than a generic internal error.
    const service = new CFRService(temp.store, 7);
    const { status, body } = await withService(service, `/api/v1/diff?${DIFF_QUERY}`);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'invalid_input',
      message: 'diff unavailable — no eCFR client injected',
    });
  });

  it('masks upstream fetch failures as the generic 500', async () => {
    const service = new CFRService(temp.store, 7, stubEcfr({}), createTestLogger());
    const { status, body } = await withService(service, `/api/v1/diff?${DIFF_QUERY}`);
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'internal_error', message: 'internal server error' });
  });

  it("answers a 400 for a date before eCFR's archive, not a generic 500", async () => {
    // eCFR answers 404 for a date outside its point-in-time archive. That is
    // the reader's argument, not a service failure: it must be the same usage
    // error the CLI exits 2 on, so a script does not retry it forever.
    const service = new CFRService(temp.store, 7, stubEcfr({}, 404), createTestLogger());
    const { status, body } = await withService(
      service,
      '/api/v1/diff?from=2016-06-01&to=2020-01-01',
    );
    expect(status).toBe(400);
    expect(body['error']).toBe('invalid_input');
    expect(String(body['message'])).toContain('serves no revision');
    expect(String(body['message'])).toContain('2016-06-01');
    expect(String(body['message'])).toContain('2017-01-01');
    // No upstream detail reaches the client.
    expect(String(body['message'])).not.toContain('HTTP 404');
  });

  it('mirrors GET on HEAD with identical headers and an empty body', async () => {
    const getResponse = await fetch(`${base}/api/v1/diff?${DIFF_QUERY}`);
    const getBody = await getResponse.text();
    const headResponse = await fetch(`${base}/api/v1/diff?${DIFF_QUERY}`, { method: 'HEAD' });
    const headBody = await headResponse.text();
    expect(headResponse.status).toBe(getResponse.status);
    expect(headBody).toBe('');
    expect(headResponse.headers.get('content-type')).toBe(getResponse.headers.get('content-type'));
    expect(headResponse.headers.get('content-length')).toBe(
      getResponse.headers.get('content-length'),
    );
    expect(headResponse.headers.get('cache-control')).toBe(
      getResponse.headers.get('cache-control'),
    );
    // The HEAD body is empty, so parse the GET body captured above: same route,
    // same payload contract.
    expect(JSON.parse(getBody)).toMatchObject({
      fromIssueDate: FROM_DATE,
      toIssueDate: TO_DATE,
    });
  });
});

describe('Titan HTTP /api/v1/redline', () => {
  const FROM_DATE = '2026-01-01';
  const TO_DATE = '2026-06-01';
  const REDLINE_QUERY = `from=${FROM_DATE}&to=${TO_DATE}&citation=4.125`;

  // Stub builders duplicated per suite (test/helpers.ts is not in this
  // packet's allowlist) — same minimal full-title shape test/diff.test.ts uses.
  function diffXml(sections: string): string {
    return `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>${sections}</DIV5></DIV3></DIV1>`;
  }

  function diffSection(citation: string, body: string): string {
    return `<DIV8 N="${citation}" TYPE="SECTION"><HEAD>§ ${citation} Test.</HEAD><P>${body}</P></DIV8>`;
  }

  const REDLINE_FROM_XML = diffXml(
    diffSection('4.125', 'Original body.') + diffSection('4.130', 'RFC text.'),
  );
  const REDLINE_TO_XML = diffXml(
    diffSection('4.125', 'Amended body.') + diffSection('4.130', 'RFC text.'),
  );

  /**
   * Offline eCFR stub keyed by date; unknown dates reject like the upstream
   * does, carrying the status the real client throws.
   *
   * The default is 500 — a genuine upstream failure, which the API masks as
   * a generic 500. A 404 is a different thing: eCFR has no revision for
   * that date, which is the reader's argument, not a service failure.
   */
  function stubEcfr(
    xmlByDate: Readonly<Record<string, string>> = {},
    failureStatus = 500,
  ): EcfrApi {
    return {
      getFullTitleXml: async (issueDate: string) => {
        const xml = xmlByDate[issueDate];
        if (xml === undefined) {
          const error = new Error(`HTTP ${failureStatus} for ${issueDate}`) as Error & {
            status?: number;
          };
          error.status = failureStatus;
          throw error;
        }
        return xml;
      },
    } as unknown as EcfrApi;
  }

  const happyEcfr = (): EcfrApi =>
    stubEcfr({ [FROM_DATE]: REDLINE_FROM_XML, [TO_DATE]: REDLINE_TO_XML });

  let temp: TempStore;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    temp = openTempStore();
    server = createHttpServer(
      new CFRService(temp.store, 7, happyEcfr(), createTestLogger()),
      createTestLogger(),
    );
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

  async function get(
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: Json; headers: Headers; text: string }> {
    const response = await fetch(`${base}${pathname}`, init);
    const text = await response.text();
    const body = text.length > 0 ? (JSON.parse(text) as Json) : {};
    return { status: response.status, body, headers: response.headers, text };
  }

  /** Start an ad-hoc server around `service`; returns status + parsed body. */
  async function withService(
    service: CFRService,
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: Json; headers: Headers; text: string }> {
    const custom = createHttpServer(service, createTestLogger());
    await new Promise<void>((resolve) => custom.listen(0, '127.0.0.1', resolve));
    const port = (custom.address() as AddressInfo).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
      const text = await response.text();
      const body = text.length > 0 ? (JSON.parse(text) as Json) : {};
      return { status: response.status, body, headers: response.headers, text };
    } finally {
      await new Promise<void>((resolve) => {
        custom.close(() => resolve());
        custom.closeAllConnections();
      });
    }
  }

  it('serves the core SectionRedline passthrough as JSON', async () => {
    const { status, body, headers } = await get(`/api/v1/redline?${REDLINE_QUERY}`);
    expect(status).toBe(200);
    expect(body).toEqual({
      fromIssueDate: FROM_DATE,
      toIssueDate: TO_DATE,
      citation: '4.125',
      status: 'changed',
      fromText: 'Original body.',
      toText: 'Amended body.',
      hunks: [
        { fromLine: 1, toLine: null, type: 'del', text: 'Original body.' },
        { fromLine: null, toLine: 1, type: 'add', text: 'Amended body.' },
      ],
      coarse: false,
      notice: POINT_IN_TIME_NOTICE,
    });
    expect(headers.get('content-type')).toContain('application/json');
    expect(headers.get('cache-control')).toBe('public, max-age=300');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin');
    // The redline route fetches from eCFR per call: it is not an index-backed
    // read, so it carries no validator and never answers a 304.
    expect(headers.get('etag')).toBeNull();
  });

  it('rejects each missing or empty required param with 400 before the service', async () => {
    for (const query of [
      '',
      'citation=',
      `citation=4.125&to=${TO_DATE}`,
      `from=${FROM_DATE}&citation=4.125`,
      `from=${FROM_DATE}&to=${TO_DATE}&citation=`,
    ]) {
      const { status, body } = await get(`/api/v1/redline?${query}`);
      expect(status, `query "${query}" must be a 400`).toBe(400);
      expect(body['error']).toBe('invalid_input');
      expect(String(body['message'])).toContain('required');
    }
  });

  it('maps a citation missing from BOTH dates to a clean 404', async () => {
    // The stub serves 4.125 on both dates; 99.999 is absent from both parses,
    // so the core throws not_found → statusFor → 404 (not a generic 500).
    const { status, body } = await get(
      `/api/v1/redline?from=${FROM_DATE}&to=${TO_DATE}&citation=99.999`,
    );
    expect(status).toBe(404);
    expect(body['error']).toBe('not_found');
    expect(String(body['message'])).toContain('99.999 not found in Title 38');
    expect(String(body['message'])).toContain(FROM_DATE);
    expect(String(body['message'])).toContain(TO_DATE);
  });

  it('answers a clean mapped 400 when no eCFR client was injected', async () => {
    // Default construction (2-arg) — the facade fails closed; statusFor maps
    // invalid_input to a 400 with the client-safe message rather than a 500.
    const service = new CFRService(temp.store, 7);
    const { status, body } = await withService(service, `/api/v1/redline?${REDLINE_QUERY}`);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'invalid_input',
      message: 'redline unavailable — no eCFR client injected',
    });
  });

  it('masks upstream fetch failures as the generic 500', async () => {
    const service = new CFRService(temp.store, 7, stubEcfr({}), createTestLogger());
    const { status, body } = await withService(service, `/api/v1/redline?${REDLINE_QUERY}`);
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'internal_error', message: 'internal server error' });
  });

  it("answers a 400 for a date before eCFR's archive, not a generic 500", async () => {
    // The same translation the diff route gets: a date outside the archive
    // is the reader's argument, so it is a 400 and not a service failure.
    const service = new CFRService(temp.store, 7, stubEcfr({}, 404), createTestLogger());
    const { status, body } = await withService(
      service,
      `/api/v1/redline?from=2016-06-01&to=2020-01-01&citation=4.125`,
    );
    expect(status).toBe(400);
    expect(body['error']).toBe('invalid_input');
    expect(String(body['message'])).toContain('serves no revision');
    expect(String(body['message'])).not.toContain('HTTP 404');
  });

  it('mirrors GET on HEAD with identical headers and an empty body', async () => {
    const getResponse = await fetch(`${base}/api/v1/redline?${REDLINE_QUERY}`);
    const getBody = await getResponse.text();
    const headResponse = await fetch(`${base}/api/v1/redline?${REDLINE_QUERY}`, {
      method: 'HEAD',
    });
    const headBody = await headResponse.text();
    expect(headResponse.status).toBe(getResponse.status);
    expect(headBody).toBe('');
    expect(headResponse.headers.get('content-type')).toBe(getResponse.headers.get('content-type'));
    expect(headResponse.headers.get('content-length')).toBe(
      getResponse.headers.get('content-length'),
    );
    expect(headResponse.headers.get('cache-control')).toBe(
      getResponse.headers.get('cache-control'),
    );
    // The HEAD body is empty, so parse the GET body captured above: same route,
    // same payload contract.
    expect(JSON.parse(getBody)).toMatchObject({
      fromIssueDate: FROM_DATE,
      toIssueDate: TO_DATE,
      citation: '4.125',
    });
  });
});

describe('Titan HTTP conditional requests (ETag / 304)', () => {
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

  /** Fetch a path; the body is read once, as text (a 304 has none). */
  async function request(
    pathname: string,
    init?: RequestInit,
  ): Promise<{ status: number; text: string; headers: Headers }> {
    const response = await fetch(`${base}${pathname}`, init);
    return { status: response.status, text: await response.text(), headers: response.headers };
  }

  /** The three index-backed reads, with the Cache-Control each one carries. */
  const INDEX_READS = [
    { path: '/api/v1/search?q=mental+disorder', cacheControl: 'public, max-age=300' },
    { path: '/api/v1/sections/4.125', cacheControl: 'public, max-age=3600' },
    { path: '/api/v1/browse', cacheControl: 'public, max-age=3600' },
  ] as const;

  /** The ETag shape: a quoted sha256 over the response payload. */
  const ETAG_SHAPE = /^"sha256-[0-9a-f]{64}"$/;

  for (const route of INDEX_READS) {
    it(`GET ${route.path} carries an ETag and the usual Cache-Control`, async () => {
      const { status, headers } = await request(route.path);
      expect(status).toBe(200);
      expect(headers.get('etag')).toMatch(ETAG_SHAPE);
      expect(headers.get('cache-control')).toBe(route.cacheControl);
    });

    it(`GET ${route.path} answers 304 to a matching If-None-Match`, async () => {
      const first = await request(route.path);
      const etag = first.headers.get('etag');
      expect(etag).not.toBeNull();

      const { status, text, headers } = await request(route.path, {
        headers: { 'if-none-match': etag as string },
      });
      expect(status).toBe(304);
      expect(headers.get('etag')).toBe(etag);
      expect(headers.get('cache-control')).toBe(route.cacheControl);
      // The same representation metadata as the 200 it replaces...
      expect(headers.get('content-type')).toBe(first.headers.get('content-type'));
      // ...and no body. No content-length either: on a 304 that field would
      // describe the CACHED representation, not an empty one.
      expect(text).toBe('');
      expect(headers.get('content-length')).toBeNull();
    });

    it(`GET ${route.path} answers 200 with the body to a non-matching If-None-Match`, async () => {
      const { status, text } = await request(route.path, {
        headers: { 'if-none-match': '"something-else"' },
      });
      expect(status).toBe(200);
      expect(text.length).toBeGreaterThan(0);
      expect((JSON.parse(text) as Json)['error']).toBeUndefined();
    });
  }

  it('matches If-None-Match per RFC 9110 §13.1.2 (star, weak validator, list)', async () => {
    const path = '/api/v1/search?q=mental+disorder';
    const etag = (await request(path)).headers.get('etag') as string;

    // `*` matches any current representation.
    const star = await request(path, { headers: { 'if-none-match': '*' } });
    expect(star.status).toBe(304);
    expect(star.text).toBe('');

    // The comparison is the WEAK one: W/"x" matches the strong "x".
    const weak = await request(path, { headers: { 'if-none-match': `W/${etag}` } });
    expect(weak.status).toBe(304);
    expect(weak.text).toBe('');

    // A list matches when ANY member matches.
    const list = await request(path, { headers: { 'if-none-match': `"other", ${etag}` } });
    expect(list.status).toBe(304);
    expect(list.text).toBe('');

    // A member whose quoted tag holds a comma or an escaped quote must not
    // break the list: the current ETag is still found after it.
    const awkward = await request(path, {
      headers: { 'if-none-match': `"a,b", "c\\"d", ${etag}` },
    });
    expect(awkward.status).toBe(304);
    expect(awkward.text).toBe('');

    // A list whose members all miss is a normal 200.
    const miss = await request(path, { headers: { 'if-none-match': '"other", "another"' } });
    expect(miss.status).toBe(200);
    expect(miss.text.length).toBeGreaterThan(0);
  });

  it('gives different responses different ETags and the same response the same one', async () => {
    // Two different sections.
    const first = await request('/api/v1/sections/4.125');
    const second = await request('/api/v1/sections/4.130');
    expect(first.headers.get('etag')).not.toBe(second.headers.get('etag'));

    // Two different searches.
    const searchA = await request('/api/v1/search?q=mental+disorder');
    const searchB = await request('/api/v1/search?q=hearing+impairment');
    expect(searchA.headers.get('etag')).not.toBe(searchB.headers.get('etag'));

    // The same request twice: the validator is deterministic.
    const again = await request('/api/v1/search?q=mental+disorder');
    expect(again.headers.get('etag')).toBe(searchA.headers.get('etag'));
    const sectionAgain = await request('/api/v1/sections/4.125');
    expect(sectionAgain.headers.get('etag')).toBe(first.headers.get('etag'));
  });

  it('changes the ETag when the indexed text changes, and only then', async () => {
    const before = await request('/api/v1/sections/4.125');
    const beforeEtag = before.headers.get('etag') as string;

    // Re-index the same citation with different text.
    temp.store.replaceAll(
      [makeSection({ citation: '4.125', text: 'Amended body text for the same citation.' })],
      '2026-10-09',
      {
        issue_date: '2026-10-09',
        synced_at: new Date().toISOString(),
        appendices_count: '0',
        parser_version: '1',
      },
    );

    const after = await request('/api/v1/sections/4.125');
    const afterEtag = after.headers.get('etag') as string;
    expect(afterEtag).not.toBe(beforeEtag);
    // The stale validator gets the new body, not a 304: the text DID change.
    const revalidated = await request('/api/v1/sections/4.125', {
      headers: { 'if-none-match': beforeEtag },
    });
    expect(revalidated.status).toBe(200);
    expect(revalidated.text).toContain('Amended body text');
  });

  it('never answers an error with a 304, whatever the request carries', async () => {
    // A 404 for an unknown citation.
    const missing = await request('/api/v1/sections/99.999', {
      headers: { 'if-none-match': '*' },
    });
    expect(missing.status).toBe(404);
    expect((JSON.parse(missing.text) as Json)['error']).toBe('not_found');
    // An error carries no validator to revalidate.
    expect(missing.headers.get('etag')).toBeNull();

    // A 400 from the service's own input validation.
    const invalid = await request('/api/v1/search?q=no', {
      headers: { 'if-none-match': '*' },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('etag')).toBeNull();

    // A 404 for an unknown browse node.
    const unknownNode = await request('/api/v1/browse?chapter=I&part=999', {
      headers: { 'if-none-match': '*' },
    });
    expect(unknownNode.status).toBe(404);
    expect(unknownNode.headers.get('etag')).toBeNull();

    // The 405 precheck answers before any routing.
    const wrongMethod = await request('/api/v1/search?q=mental+disorder', {
      method: 'POST',
      headers: { 'if-none-match': '*' },
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('etag')).toBeNull();
  });

  it('keeps HEAD as it was: the full headers and an empty body', async () => {
    const get = await request('/api/v1/sections/4.125');
    const head = await request('/api/v1/sections/4.125', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.text).toBe('');
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
    expect(head.headers.get('cache-control')).toBe(get.headers.get('cache-control'));
  });

  it('answers a HEAD with a matching If-None-Match with a bodyless 304', async () => {
    const get = await request('/api/v1/sections/4.125');
    const head = await request('/api/v1/sections/4.125', {
      method: 'HEAD',
      headers: { 'if-none-match': get.headers.get('etag') as string },
    });
    expect(head.status).toBe(304);
    expect(head.text).toBe('');
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(head.headers.get('cache-control')).toBe(get.headers.get('cache-control'));
  });

  it('gives no validator to the routes that are not index-backed reads', async () => {
    // /health and /metrics are no-store; the UI assets are static.
    for (const path of ['/health', '/metrics', '/', '/ui.js', '/ui.css']) {
      const { status, headers } = await request(path);
      expect(status, `${path} must stay a 200`).toBe(200);
      expect(headers.get('etag'), `${path} must carry no ETag`).toBeNull();
    }
  });
});
