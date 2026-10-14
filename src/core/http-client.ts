/**
 * Small HTTP client with the safety properties we want everywhere:
 * fixed caller-controlled URLs, timeouts, size caps, bounded retries with
 * backoff, and sanitized error messages (no stack traces, no raw bodies).
 */

/** Subset of `fetch` we depend on (injectable for tests). */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  fetchFn?: FetchLike;
  userAgent?: string;
  /** Per-request timeout in milliseconds (default 15 000). */
  timeoutMs?: number;
  /** Maximum accepted response size in bytes (default 50 MiB). */
  maxBytes?: number;
  /** Retries after the first attempt for retryable failures (default 2). */
  retries?: number;
  /** Base backoff delay in milliseconds (default 250). */
  retryDelayMs?: number;
  /** Sleep implementation, injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

/** HTTP failure with a sanitized, log-safe message. */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number | undefined;
  /** Pathname only — never the query string (may contain user input). */
  readonly url: string;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.url = url;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
/** Max characters of an upstream error body embedded in a message. */
const MAX_ERROR_BODY_CHARS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stream a response body while enforcing the byte cap: an oversized payload
 * is rejected *as it arrives*, instead of being buffered into memory first
 * and checked afterwards (SPEC §12 #28).
 */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
  pathname: string,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new HttpError(
          `response from ${pathname} exceeds ${maxBytes} bytes`,
          pathname,
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    // Release the connection whether we finished or bailed out early.
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

/**
 * Read at most the first `MAX_ERROR_BODY_CHARS` bytes of an error body —
 * enough for a useful message, never an unbounded read (SPEC §12 #29).
 */
async function readErrorSnippet(response: Response): Promise<string> {
  if (!response.body) return '';
  try {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < MAX_ERROR_BODY_CHARS) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks, total).subarray(0, MAX_ERROR_BODY_CHARS).toString('utf8');
  } catch {
    return '';
  }
}

/** Retry only transient failures: network errors, timeouts, 429 and 5xx. */
function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === undefined || error.status >= 500 || error.status === 429;
  }
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export class HttpClient {
  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions = {}) {
    this.options = options;
  }

  /** GET a URL and return the response body as text. */
  async getText(url: URL, opts: RequestOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const attempts = (opts.retries ?? this.options.retries ?? DEFAULT_RETRIES) + 1;
    const retryDelayMs = this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const sleep = this.options.sleep ?? defaultSleep;

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.fetchOnce(url, timeoutMs, opts.headers);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !isRetryable(error)) break;
        await sleep(retryDelayMs * attempt);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new HttpError(`request failed for ${url.pathname}`, url.pathname);
  }

  /** GET a URL, parse JSON, then validate it with the provided parser. */
  async getJson<T>(url: URL, parse: (raw: unknown) => T, opts: RequestOptions = {}): Promise<T> {
    const text = await this.getText(url, opts);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(`invalid JSON response from ${url.pathname}`, url.pathname);
    }
    return parse(raw);
  }

  private async fetchOnce(
    url: URL,
    timeoutMs: number,
    extraHeaders?: Record<string, string>,
  ): Promise<string> {
    const fetchFn: FetchLike = this.options.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: 'application/xml, application/json;q=0.9, text/plain;q=0.8, */*;q=0.1',
          'user-agent': this.options.userAgent ?? 'cfr-free',
          ...extraHeaders,
        },
      });
    } catch (error) {
      throw new HttpError(
        `request failed for ${url.pathname}: ${errorMessage(error)}`,
        url.pathname,
      );
    }

    if (!response.ok) {
      const detail = (await readErrorSnippet(response)).replace(/\s+/g, ' ');
      const suffix = detail ? `: ${detail}` : '';
      throw new HttpError(
        `HTTP ${response.status} for ${url.pathname}${suffix}`,
        url.pathname,
        response.status,
      );
    }

    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && Number.parseInt(declaredLength, 10) > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new HttpError(
        `response from ${url.pathname} exceeds ${maxBytes} bytes`,
        url.pathname,
        response.status,
      );
    }
    return await readBodyCapped(response, maxBytes, url.pathname);
  }
}
