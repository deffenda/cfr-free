import http from 'node:http';
import { ServiceError, type CFRService } from '../core/service.js';
import { StructureError } from '../core/structure.js';
import type { Logger } from '../logger.js';
import { RateLimiter } from './rate-limit.js';

/**
 * Titan HTTP API: a tiny GET-only JSON surface over the local index.
 *
 * Deliberately dependency-free (`node:http`) and hardened by construction:
 * no request bodies, no templating, no dynamic SQL, validated query strings,
 * fixed routes, and a loopback bind by default (see config.ts).
 */

const JSON_HEADER = 'application/json; charset=utf-8';
const TEXT_HEADER = 'text/plain; version=0.0.4; charset=utf-8';
const NOSNIFF = 'X-Content-Type-Options';
const SEARCH_PREFIX = '/api/v1/search';
const SECTIONS_PREFIX = '/api/v1/sections/';
const BROWSE_PATH = '/api/v1/browse';
const HEALTH_PATH = '/health';
const METRICS_PATH = '/metrics';

// Router-level request-size caps, enforced before validation: zod already
// bounds `q` to 200 chars (≤ 800 UTF-8 bytes) and `part` to 3 digits, so
// these only kill pathological requests (megabyte URLs) one layer earlier.
const MAX_URL_BYTES = 2048;
const MAX_QUERY_BYTES = 800;
const MAX_PART_BYTES = 10;

type JsonBody = Record<string, unknown>;

function sendJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: JsonBody,
  cacheControl?: string,
): void {
  const payload = JSON.stringify(body);
  const headers: http.OutgoingHttpHeaders = {
    'content-type': JSON_HEADER,
    'content-length': Buffer.byteLength(payload, 'utf8'),
    [NOSNIFF]: 'nosniff',
  };
  if (cacheControl !== undefined) headers['cache-control'] = cacheControl;
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(payload);
}

function sendText(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: string,
  cacheControl?: string,
): void {
  const headers: http.OutgoingHttpHeaders = {
    'content-type': TEXT_HEADER,
    'content-length': Buffer.byteLength(body, 'utf8'),
    [NOSNIFF]: 'nosniff',
  };
  if (cacheControl !== undefined) headers['cache-control'] = cacheControl;
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

function errorBody(code: string, message: string, extra?: JsonBody): JsonBody {
  return { error: code, message, ...extra };
}

function parseOptionalInt(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  return Number(raw);
}

/** First oversized query parameter, or null when every cap holds. */
function oversizedParam(url: URL): string | null {
  const q = url.searchParams.get('q');
  if (q !== null && Buffer.byteLength(q, 'utf8') > MAX_QUERY_BYTES) {
    return `q exceeds ${MAX_QUERY_BYTES} bytes`;
  }
  const part = url.searchParams.get('part');
  if (part !== null && Buffer.byteLength(part, 'utf8') > MAX_PART_BYTES) {
    return `part exceeds ${MAX_PART_BYTES} bytes`;
  }
  return null;
}

function handleSearch(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const result = service.search({
    query: url.searchParams.get('q') ?? '',
    page: parseOptionalInt(url.searchParams.get('page')),
    perPage: parseOptionalInt(url.searchParams.get('per_page')),
    part: url.searchParams.get('part') ?? undefined,
    // Kind is validated by the service's zod schema: invalid values must reach it (400 invalid_input).
    kind: (url.searchParams.get('kind') ?? undefined) as 'section' | 'appendix' | undefined,
    chapter: url.searchParams.get('chapter') ?? undefined,
  });
  sendJson(req, res, 200, { ...result }, 'public, max-age=300');
}

function handleSection(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): void {
  const raw = pathname.slice(SECTIONS_PREFIX.length);
  let citation: string;
  try {
    citation = decodeURIComponent(raw);
  } catch {
    sendJson(req, res, 400, errorBody('invalid_input', 'malformed URL encoding'));
    return;
  }
  const section = service.getSection(citation);
  sendJson(req, res, 200, { ...section }, 'public, max-age=3600');
}

function handleBrowse(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const result = service.browse({
    chapter: url.searchParams.get('chapter') ?? undefined,
    part: url.searchParams.get('part') ?? undefined,
    subpart: url.searchParams.get('subpart') ?? undefined,
  });
  sendJson(
    req,
    res,
    200,
    { node: result.node, path: result.path, children: result.children },
    'public, max-age=3600',
  );
}

function statusFor(error: ServiceError | StructureError): { status: number; code: string } {
  if (error instanceof StructureError) return { status: 404, code: 'not_found' };
  return error.code === 'not_found'
    ? { status: 404, code: 'not_found' }
    : { status: 400, code: 'invalid_input' };
}

function gauge(name: string, help: string, value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}\n`;
}

function toEpochSeconds(iso: string | null): number {
  if (iso === null) return 0;
  const seconds = Math.floor(Date.parse(iso) / 1000);
  return Number.isFinite(seconds) ? seconds : 0;
}

/**
 * Prometheus exposition (SPEC §5: the only non-JSON route, kept for
 * scrapability; everything else stays JSON-only).
 */
function renderMetrics(service: CFRService, disk?: () => DiskSnapshot | null): string {
  const status = service.status();
  let out = '';
  out += gauge('cfr_free_sections', 'Indexed sections in the local index.', status.sections);
  out += gauge('cfr_free_appendices', 'Indexed appendices in the local index.', status.appendices);
  out += gauge(
    'cfr_free_stale',
    '1 when the index is older than cfr_free_max_age_days, else 0.',
    status.stale ? 1 : 0,
  );
  out += gauge(
    'cfr_free_max_age_days',
    'Configured staleness threshold in days.',
    status.maxAgeDays,
  );
  out += gauge(
    'cfr_free_issue_date_timestamp_seconds',
    'eCFR issue date of the indexed title as Unix seconds (0 when unknown).',
    toEpochSeconds(status.issueDate),
  );
  out += gauge(
    'cfr_free_synced_at_timestamp_seconds',
    'Last successful sync as Unix seconds (0 when unknown).',
    toEpochSeconds(status.syncedAt),
  );
  if (status.structureDrift !== null) {
    out += gauge(
      'cfr_free_structure_drift',
      '1 when parsed counts differ from the structure tree, else 0.',
      status.structureDrift ? 1 : 0,
    );
  }
  const diskSnapshot = disk?.() ?? null;
  if (diskSnapshot !== null) {
    out += gauge(
      'cfr_free_disk_free_bytes',
      'Bytes available to unprivileged users on the volume hosting the index, as of boot or the last refresh round.',
      diskSnapshot.freeBytes,
    );
    out += gauge(
      'cfr_free_disk_total_bytes',
      'Total bytes on the volume hosting the index, as of boot or the last refresh round.',
      diskSnapshot.totalBytes,
    );
  }
  return out;
}

function dispatch(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  disk?: () => DiskSnapshot | null,
): void {
  const pathname = url.pathname;
  if (pathname === HEALTH_PATH) {
    const diskSnapshot = disk?.() ?? null;
    sendJson(
      req,
      res,
      200,
      {
        status: 'ok',
        ...service.status(),
        // Additive conditionals: absent entirely (never fabricated as 0)
        // when the platform has no statfs snapshot to offer.
        ...(diskSnapshot === null
          ? {}
          : { diskFree: diskSnapshot.freeBytes, diskTotal: diskSnapshot.totalBytes }),
      },
      'no-store',
    );
    return;
  }
  if (pathname === METRICS_PATH) {
    sendText(req, res, 200, renderMetrics(service, disk), 'no-store');
    return;
  }
  if (pathname === SEARCH_PREFIX) {
    handleSearch(service, req, res, url);
    return;
  }
  if (pathname.startsWith(SECTIONS_PREFIX)) {
    handleSection(service, req, res, pathname);
    return;
  }
  if (pathname === BROWSE_PATH) {
    handleBrowse(service, req, res, url);
    return;
  }
  sendJson(req, res, 404, errorBody('not_found', `no route for ${pathname}`));
}

/** Optional server knobs; the default (loopback) deployment needs none. */
export interface HttpServerOptions {
  /** Per-peer request budget — enabled only when the bind is deliberately remote. */
  readonly rateLimit?: { readonly capacity: number; readonly refillPerSec: number };
  /**
   * Disk-capacity accessor (SPEC §13 #22), read per request so `/health` and
   * `/metrics` reflect the caller's own moment, not a boot-time freeze; the
   * serve-side refresh callback owns the cell it reads. `null` (or absent)
   * omits the fields/gauges entirely rather than fabricating zeros.
   */
  readonly disk?: () => DiskSnapshot | null;
}

/**
 * Filesystem capacity of the volume hosting the index, as sampled by
 * `fs.promises.statfs` — a snapshot ("as of boot or the last refresh
 * round"), not a live reading.
 */
export interface DiskSnapshot {
  /** Bytes available to unprivileged users — `bavail × bsize`. */
  readonly freeBytes: number;
  /** Total bytes on the volume — `blocks × bsize`. */
  readonly totalBytes: number;
}

/**
 * Method, rate, and size gates that run before routing. Returns the parsed
 * URL, or null when the request was already answered with an error.
 */
function precheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  limiter: RateLimiter | null,
): URL | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    sendJson(req, res, 405, errorBody('method_not_allowed', 'only GET and HEAD are supported'));
    return null;
  }
  if (limiter !== null) {
    const verdict = limiter.consume(req.socket.remoteAddress ?? 'unknown');
    if (!verdict.allowed) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil(verdict.retryAfterSec))));
      sendJson(req, res, 429, errorBody('rate_limited', 'too many requests — retry shortly'));
      return null;
    }
  }
  if (Buffer.byteLength(req.url ?? '/', 'utf8') > MAX_URL_BYTES) {
    sendJson(
      req,
      res,
      414,
      errorBody('uri_too_long', `request URL exceeds ${MAX_URL_BYTES} bytes`),
    );
    return null;
  }
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    sendJson(req, res, 400, errorBody('invalid_input', 'malformed request URL'));
    return null;
  }
  const oversized = oversizedParam(url);
  if (oversized !== null) {
    sendJson(req, res, 400, errorBody('invalid_input', oversized));
    return null;
  }
  return url;
}

/** Create (but do not start) the HTTP API server. */
export function createHttpServer(
  service: CFRService,
  logger: Logger,
  options: HttpServerOptions = {},
): http.Server {
  const limiter =
    options.rateLimit === undefined ? null : new RateLimiter({ ...options.rateLimit });
  const server = http.createServer((req, res) => {
    const url = precheck(req, res, limiter);
    if (url === null) return;

    try {
      dispatch(service, req, res, url, options.disk);
    } catch (error) {
      if (error instanceof ServiceError || error instanceof StructureError) {
        const { status, code } = statusFor(error);
        const available = error instanceof StructureError ? error.available : undefined;
        sendJson(
          req,
          res,
          status,
          errorBody(code, error.message, available ? { available } : undefined),
        );
        return;
      }
      logger.error('http request failed', {
        path: url.pathname,
        message: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        sendJson(req, res, 500, errorBody('internal_error', 'internal server error'));
      } else {
        res.end();
      }
    }
  });
  // Bound how long a client may take to complete a request (SPEC §12 #16);
  // the header timeout already defaults to 60 s.
  server.requestTimeout = 60_000;
  return server;
}
