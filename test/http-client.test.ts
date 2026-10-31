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

  it('says an answer that was not JSON was an answer, not a dead network', async () => {
    // eCFR answered 200 and the body was a page of HTML — a captive
    // portal, a proxy, a CDN error page. The upstream spoke, so the failure
    // must not read as a transport failure: the reader's router is fine.
    // The status travels with it, because "HTTP 200" and "no status at all"
    // mean different things to whoever reads the log.
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return okResponse('<html><body>Sign in to continue</body></html>');
    });
    try {
      await client.getJson(URL_UNDER_TEST, (raw) => raw);
      expect.unreachable('the body is not JSON, so getJson must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      if (error instanceof HttpError) {
        expect(error.kind).toBe('parse');
        expect(error.status).toBe(200);
        expect(error.message).toContain('invalid JSON response');
      }
    }
    // The fetch itself succeeded, so the body is not fetched again: the
    // failure is in what came back, and the same answer would come back.
    expect(calls).toBe(1);
  });

  it('says a body over the cap was too large, not a success', async () => {
    // The cap carries the status of the answer it came with, and a status
    // alone would report "HTTP 200" — which reads like a success report.
    const client = makeClient(async () => okResponse('body', { 'content-length': '99' }), {
      maxBytes: 10,
    });
    try {
      await client.getText(URL_UNDER_TEST);
      expect.unreachable('the body is over the cap, so getText must reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      if (error instanceof HttpError) {
        expect(error.kind).toBe('size');
        expect(error.status).toBe(200);
        expect(error.message).toContain('exceeds 10 bytes');
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

  it('stops reading an oversized stream instead of buffering it', async () => {
    // No content-length: the cap can only be enforced while streaming.
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(600));
        if (pulls >= 100) controller.close();
      },
    });
    const client = makeClient(async () => new Response(stream), { maxBytes: 1024 });
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/exceeds 1024 bytes/);
    // Rejected after ~2 chunks; the remaining stream must never be pulled.
    expect(pulls).toBeLessThan(10);
  });

  it('reads only a bounded snippet of an error body', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(100).fill(0x65));
        if (pulls >= 1000) controller.close();
      },
    });
    const client = makeClient(async () => new Response(stream, { status: 400 }), { retries: 0 });
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/HTTP 400/);
    expect(pulls).toBeLessThan(10);
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

  it('retries 429 responses', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return calls === 1 ? new Response('slow down', { status: 429 }) : okResponse('ok');
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('retries AbortError rejections', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) throw new DOMException('aborted', 'AbortError');
      return okResponse('ok');
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('treats status-less failures as retryable and survives broken error streams', async () => {
    let calls = 0;
    const brokenErrorBody = {
      getReader: () => ({
        read: async () => {
          throw new Error('stream broke');
        },
        cancel: async () => undefined,
      }),
    };
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) {
        // Odd fetch implementations may omit both `status` and a usable body.
        return {
          ok: false,
          status: undefined,
          headers: new Headers(),
          body: brokenErrorBody,
        } as unknown as Response;
      }
      return okResponse('ok');
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('returns an empty body when the response has no body', async () => {
    const client = makeClient(async () => new Response(null, { status: 200 }));
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('');
  });

  it('retries an error response with a null body', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      }
      return okResponse('ok');
    });
    await expect(client.getText(URL_UNDER_TEST)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('uses the default retry budget when none is configured', async () => {
    let calls = 0;
    const client = new HttpClient({
      fetchFn: async () => {
        calls += 1;
        return new Response('boom', { status: 500 });
      },
      sleep: async () => undefined,
      retryDelayMs: 0,
      userAgent: 'cfr-free/test',
    });
    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(HttpError);
    expect(calls).toBeGreaterThan(1);
  });

  it('falls back to the global fetch when no fetchFn is configured', async () => {
    const client = new HttpClient({ userAgent: 'cfr-free/test', retries: 0 });
    await expect(client.getText(new URL('data:text/plain,global-fetch'))).resolves.toBe(
      'global-fetch',
    );
  });
});
