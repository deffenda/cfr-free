import { describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpError, type FetchLike } from '../src/core/http-client.js';

const URL_UNDER_TEST = new URL('https://example.test/api/resource?secret=abc');

function okResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchFn: FetchLike, overrides = {}): HttpClient {
  return new HttpClient({
    fetchFn,
    sleep: async () => undefined,
    retryDelayMs: 0,
    retries: 2,
    userAgent: 'cfr-free/test',
    ...overrides,
  });
}

describe('HttpClient', () => {
  it('returns the body on success', async () => {
    const client = makeClient(async () => okResponse('hello'));
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('hello');
  });

  it('sends a versioned user-agent and accepts encodings', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const client = makeClient(async (_url, init) => {
      seen.push(init?.headers as Record<string, string> | undefined);
      return okResponse('ok');
    });
    await client.getText(URL_UNDER_TEST);
    expect(seen[0]?.['user-agent']).toBe('cfr-free/test');
    expect(seen[0]?.['accept']).toContain('application/xml');
  });

  it('retries transient 5xx failures then succeeds', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return calls < 3 ? new Response('boom', { status: 503 }) : okResponse('recovered');
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('recovered');
    expect(calls).toBe(3);
  });

  it('does not retry 4xx responses', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return new Response('missing', { status: 404 });
    });
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(HttpError);
    expect(calls).toBe(1);
    try {
      await client.getText(URL_UNDER_TEST);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      if (error instanceof HttpError) {
        expect(error.status).toBe(404);
        // Pathname only — query strings never leak into errors.
        expect(error.url).not.toContain('secret=abc');
        expect(error.message).toContain('/api/resource');
      }
    }
  });

  it('retries network-level TypeErrors', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return okResponse('ok');
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('retries timeouts', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) throw new DOMException('timed out', 'TimeoutError');
      return okResponse('ok');
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up after the configured attempts', async () => {
    let calls = 0;
    const client = makeClient(
      async () => {
        calls += 1;
        return new Response('down', { status: 500 });
      },
      { retries: 1 },
    );
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/HTTP 500/);
    expect(calls).toBe(2);
  });

  it('enforces the declared content-length cap', async () => {
    const client = makeClient(
      async () => new Response('x', { status: 200, headers: { 'content-length': '99999999' } }),
      {
        maxBytes: 1024,
      },
    );
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/exceeds 1024 bytes/);
  });

  it('enforces the actual body cap', async () => {
    const client = makeClient(async () => okResponse('y'.repeat(2048)), { maxBytes: 1024 });
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/exceeds 1024 bytes/);
  });

  it('rejects invalid JSON', async () => {
    const client = makeClient(async () => okResponse('not json'));
    await expect(client.getJson(URL_UNDER_TEST, (raw) => raw)).rejects.toThrow(/invalid JSON/);
  });

  it('validates parsed JSON with the provided parser', async () => {
    const client = makeClient(async () => jsonResponse({ value: 41 }));
    const parse = vi.fn((raw: unknown) => (raw as { value: number }).value + 1);
    await expect(client.getJson(URL_UNDER_TEST, parse)).resolves.toBe(42);
    expect(parse).toHaveBeenCalledOnce();
  });

  it('propagates parser failures', async () => {
    const client = makeClient(async () => jsonResponse({ unexpected: true }));
    await expect(
      client.getJson(URL_UNDER_TEST, () => {
        throw new Error('schema mismatch');
      }),
    ).rejects.toThrow('schema mismatch');
  });

  it('truncates error bodies in messages', async () => {
    const client = makeClient(async () => new Response('e'.repeat(5000), { status: 400 }));
    try {
      await client.getText(URL_UNDER_TEST);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      if (error instanceof HttpError) expect(error.message.length).toBeLessThan(400);
    }
  });

  it('uses the real timer-based sleep when none is injected', async () => {
    let calls = 0;
    const client = new HttpClient({
      retries: 1,
      retryDelayMs: 1,
      fetchFn: async () => {
        calls += 1;
        return calls === 1 ? new Response('warming up', { status: 502 }) : okResponse('ok');
      },
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('surfaces non-Error rejections', async () => {
    const client = makeClient(async () => {
      throw 'a bare string';
    });
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(HttpError);
  });
});
