import http from 'node:http';
import { ServiceError, type CFRService } from '../core/service.js';
import { StructureError } from '../core/structure.js';
import type { Logger } from '../logger.js';

/**
 * Titan HTTP API: a tiny GET-only JSON surface over the local index.
 *
 * Deliberately dependency-free (`node:http`) and hardened by construction:
 * no request bodies, no templating, no dynamic SQL, validated query strings,
 * fixed routes, and a loopback bind by default (see config.ts).
 */

const JSON_HEADER = 'application/json; charset=utf-8';
const NOSNIFF = 'X-Content-Type-Options';
const SEARCH_PREFIX = '/api/v1/search';
const SECTIONS_PREFIX = '/api/v1/sections/';
const BROWSE_PATH = '/api/v1/browse';
const HEALTH_PATH = '/health';

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
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(payload);
}

function errorBody(code: string, message: string, extra?: JsonBody): JsonBody {
  return { error: code, message, ...extra };
}

function parseOptionalInt(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  return Number(raw);
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

function dispatch(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const pathname = url.pathname;
  if (pathname === HEALTH_PATH) {
    sendJson(req, res, 200, { status: 'ok', ...service.status() }, 'no-store');
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

/** Create (but do not start) the HTTP API server. */
export function createHttpServer(service: CFRService, logger: Logger): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      sendJson(req, res, 405, errorBody('method_not_allowed', 'only GET and HEAD are supported'));
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendJson(req, res, 400, errorBody('invalid_input', 'malformed request URL'));
      return;
    }

    try {
      dispatch(service, req, res, url);
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
