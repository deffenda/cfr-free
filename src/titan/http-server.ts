import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { CHANGE_LIST_CAP } from '../core/changes.js';
import type { CFRService } from '../core/service.js';
import { ServiceError, StructureError, UpstreamFormatError } from '../core/errors.js';
import { SemaphoreOverflowError } from '../core/semaphore.js';
import type { Logger } from '../logger.js';
import { RateLimiter } from './rate-limit.js';
import { UI_CSP, UI_CSS, UI_HTML, UI_JS } from './ui.js';
import { VERSION } from '../version.js';

/**
 * Titan HTTP API: a tiny GET-only JSON surface over the local index, plus
 * the `/api/v1/diff` and `/api/v1/redline` point-in-time comparisons (two
 * issue dates fetched from eCFR — see handleDiff/handleRedline), plus the
 * read-only web UI at the serve root (`/`, `/ui.js`, `/ui.css` — see
 * ui.ts) that consumes the same surface.
 *
 * Deliberately dependency-free (`node:http`) and hardened by construction:
 * no request bodies, no templating, no dynamic SQL, validated query strings,
 * fixed routes, and a loopback bind by default (see config.ts).
 */

const JSON_HEADER = 'application/json; charset=utf-8';
const TEXT_HEADER = 'text/plain; version=0.0.4; charset=utf-8';
const HTML_HEADER = 'text/html; charset=utf-8';
const JS_HEADER = 'text/javascript; charset=utf-8';
const CSS_HEADER = 'text/css; charset=utf-8';
const YAML_HEADER = 'application/yaml; charset=utf-8';
const NOSNIFF = 'X-Content-Type-Options';

/**
 * `Referrer-Policy: no-referrer` on every response.
 *
 * The API answers with paths and queries that can carry a search term, so
 * a client that follows a link from a response must not leak the URL it
 * was reading to the next site. The UI document says the same thing with a
 * `<meta>` tag; the header is the one that also covers the API routes.
 */
const REFERRER_POLICY = 'referrer-policy';
const SEARCH_PREFIX = '/api/v1/search';
const SECTIONS_PREFIX = '/api/v1/sections/';
const BROWSE_PATH = '/api/v1/browse';
const DIFF_PATH = '/api/v1/diff';
const REDLINE_PATH = '/api/v1/redline';
const HEALTH_PATH = '/health';
const METRICS_PATH = '/metrics';
const UI_PATH = '/';
const UI_JS_PATH = '/ui.js';
const UI_CSS_PATH = '/ui.css';
const API_INDEX_PATH = '/api/v1';
const OPENAPI_PATH = '/openapi.yaml';

// Router-level request-size caps, enforced before validation: zod already
// bounds `q` to 200 chars (≤ 800 UTF-8 bytes) and `part` to 3 digits, so
// these only kill pathological requests (megabyte URLs) one layer earlier.
const MAX_URL_BYTES = 2048;
const MAX_QUERY_BYTES = 800;
const MAX_PART_BYTES = 10;

type JsonBody = Record<string, unknown>;

/**
 * Options for the JSON sender. `revalidatable` marks the response as a
 * cacheable index read: it carries a strong `ETag` over the payload and
 * answers a matching `If-None-Match` with a bodyless 304. Only the three
 * index-backed reads use it — `/health`, `/metrics`, the two eCFR-fetching
 * routes and every error response answer normally.
 */
interface JsonSendOptions {
  readonly revalidatable: boolean;
}

/** The marker for a revalidatable index read (see `JsonSendOptions`). */
const REVALIDATABLE: JsonSendOptions = { revalidatable: true };

/**
 * The strong validator of an index-backed read: a quoted sha256 over the
 * EXACT bytes the response carries (`"sha256-<hex>"`). It is derived from
 * the payload, so the tag changes if and only if the body changes — the
 * property a client needs to confirm the text it quoted is unchanged
 * without downloading it again.
 */
function etagFor(payload: string): string {
  return `"sha256-${createHash('sha256').update(payload, 'utf8').digest('hex')}"`;
}

/**
 * The opaque tag of an entity-tag, without its weak marker. The
 * `If-None-Match` comparison is the WEAK one (RFC 9110 §13.1.2): `W/"x"`
 * and `"x"` are the same validator. The weak marker is `%s"W/"` — the
 * grammar is case-sensitive, so a lowercase `w/` is not a weak marker.
 */
function stripWeak(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/**
 * Split an `If-None-Match` field value into its entity-tag members. The
 * members are comma-separated, but a comma inside a quoted opaque tag is
 * part of that tag, so the scan tracks the quoting instead of splitting
 * the raw string (RFC 9110 §5.6.1 list syntax).
 */
function splitEntityTags(value: string): string[] {
  const members: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (quoted && char === '\\' && index + 1 < value.length) {
      current += char + value.charAt(index + 1);
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ',' && !quoted) {
      members.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  members.push(current.trim());
  return members;
}

/**
 * Whether the request's `If-None-Match` matches the current ETag
 * (RFC 9110 §13.1.2): `*` matches any current representation, a
 * comma-separated list matches when ANY member matches, and a weak
 * validator (`W/"x"`) matches the strong one (`"x"`).
 */
function ifNoneMatchMatches(req: http.IncomingMessage, etag: string): boolean {
  const header = req.headers['if-none-match'];
  // Node joins a repeated header with ", "; the array form is defensive.
  const value = Array.isArray(header) ? header.join(', ') : header;
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed === '*') return true;
  const current = stripWeak(etag);
  for (const member of splitEntityTags(trimmed)) {
    if (member === '') continue;
    if (stripWeak(member) === current) return true;
  }
  return false;
}

/**
 * The 304 (Not Modified) answer to a matching `If-None-Match`: the
 * representation metadata of the 200 it replaces (content type, ETag,
 * Cache-Control) and NO body. It carries no `content-length` either — on a
 * 304 that field describes the CACHED representation, not an empty one, and
 * a zero would tell the cache the text is empty.
 */
function sendNotModified(
  res: http.ServerResponse,
  etag: string,
  cacheControl: string | undefined,
): void {
  const headers: http.OutgoingHttpHeaders = {
    'content-type': JSON_HEADER,
    etag,
    [NOSNIFF]: 'nosniff',
  };
  if (cacheControl !== undefined) headers['cache-control'] = cacheControl;
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.writeHead(304, headers);
  res.end();
}

/**
 * The JSON sender. A response marked `revalidatable` carries a strong
 * `ETag` over the payload bytes and answers a matching `If-None-Match`
 * with a bodyless 304; every other response answers with its body as
 * before.
 *
 * Only a 200 is eligible for the conditional flow: an error response
 * (400/404/405/…) is never a 304 and carries no validator to revalidate.
 */
function sendJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: JsonBody,
  cacheControl?: string,
  options?: JsonSendOptions,
): void {
  const payload = JSON.stringify(body);
  const etag = options?.revalidatable === true ? etagFor(payload) : undefined;
  if (etag !== undefined && status === 200 && ifNoneMatchMatches(req, etag)) {
    sendNotModified(res, etag, cacheControl);
    return;
  }
  const headers: http.OutgoingHttpHeaders = {
    'content-type': JSON_HEADER,
    'content-length': Buffer.byteLength(payload, 'utf8'),
    [NOSNIFF]: 'nosniff',
    [REFERRER_POLICY]: 'no-referrer',
  };
  if (cacheControl !== undefined) headers['cache-control'] = cacheControl;
  if (etag !== undefined) headers['etag'] = etag;
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
    [REFERRER_POLICY]: 'no-referrer',
  };
  if (cacheControl !== undefined) headers['cache-control'] = cacheControl;
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

/**
 * The web-UI asset sender: always 200 + `Cache-Control: no-store` +
 * NOSNIFF + CORP same-origin, with an optional CSP (sent for the HTML
 * document only — see UI_CSP in ui.ts for the policy and why the
 * subresource routes send none). Like every other sender, HEAD gets the
 * full headers with an empty body.
 */
function sendStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  contentType: string,
  body: string,
  csp: string | undefined,
): void {
  const headers: http.OutgoingHttpHeaders = {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body, 'utf8'),
    [NOSNIFF]: 'nosniff',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    [REFERRER_POLICY]: 'no-referrer',
  };
  if (csp !== undefined) headers['content-security-policy'] = csp;
  res.writeHead(200, headers);
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
  sendJson(req, res, 200, { ...result }, 'public, max-age=300', REVALIDATABLE);
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
  sendJson(req, res, 200, { ...section }, 'public, max-age=3600', REVALIDATABLE);
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
    subjgrp: url.searchParams.get('subjgrp') ?? undefined,
  });
  sendJson(
    req,
    res,
    200,
    { node: result.node, path: result.path, children: result.children },
    'public, max-age=3600',
    REVALIDATABLE,
  );
}

/**
 * `GET /api/v1/diff?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>` — both params required
 * on the wire: missing/empty params are a 400 BEFORE the service is touched,
 * and no default-to resolution crosses the HTTP surface (the titan server does
 * hold a store, but resolving `to` from its `issue_date` meta would hide a
 * store dependency behind the service — the CLI keeps that convenience).
 *
 * The `await` rejects into the same catch every sync handler uses:
 * `ServiceError` maps through `statusFor` (400/404 + client-safe message),
 * a full upstream queue (`SemaphoreOverflowError`) answers 503
 * `upstream_busy`, and anything else (`HttpError` from an upstream fetch,
 * `SyncError`) falls to the generic 500 path with the detail logged
 * server-side only.
 */
async function handleDiff(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const fromDate = url.searchParams.get('from');
  const toDate = url.searchParams.get('to');
  if (fromDate === null || fromDate === '' || toDate === null || toDate === '') {
    sendJson(
      req,
      res,
      400,
      errorBody('invalid_input', "both 'from' and 'to' query parameters are required (YYYY-MM-DD)"),
    );
    return;
  }
  const diff = await service.diffBetween(fromDate, toDate);
  // Pure function of two fixed issue dates — cacheable like section reads.
  // Lists are capped HERE, at the wire layer: core returns FULL sorted lists
  // (caps belong to the presenting layers only), and `truncated` flags any cut.
  sendJson(
    req,
    res,
    200,
    {
      fromIssueDate: diff.fromIssueDate,
      toIssueDate: diff.toIssueDate,
      changed: diff.changed.slice(0, CHANGE_LIST_CAP),
      added: diff.added.slice(0, CHANGE_LIST_CAP),
      removed: diff.removed.slice(0, CHANGE_LIST_CAP),
      truncated:
        diff.changed.length > CHANGE_LIST_CAP ||
        diff.added.length > CHANGE_LIST_CAP ||
        diff.removed.length > CHANGE_LIST_CAP,
      notice: diff.notice,
    },
    'public, max-age=3600',
  );
}

/**
 * `GET /api/v1/redline?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&citation=<cite>` —
 * all three params required on the wire: missing/empty params are a 400
 * BEFORE the service is touched, same pre-service gate as handleDiff. The
 * body is the core's `SectionRedline` passed through verbatim — the wire adds
 * no fields and caps nothing (the core's coarse fallback at MAX_REDLINE_LINES
 * is the only bound).
 *
 * The `await` rejects into the same catch every sync handler uses:
 * `ServiceError` maps through `statusFor` (invalid_input → 400, not_found →
 * 404 — a citation missing from BOTH dates), a full upstream queue
 * (`SemaphoreOverflowError`) answers 503 `upstream_busy`, and anything else
 * (`HttpError` from an upstream fetch, `SyncError`) falls to the generic 500
 * path with the detail logged server-side only.
 */
async function handleRedline(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const fromDate = url.searchParams.get('from');
  const toDate = url.searchParams.get('to');
  const citation = url.searchParams.get('citation');
  if (
    fromDate === null ||
    fromDate === '' ||
    toDate === null ||
    toDate === '' ||
    citation === null ||
    citation === ''
  ) {
    sendJson(
      req,
      res,
      400,
      errorBody(
        'invalid_input',
        "all of 'from', 'to' and 'citation' query parameters are required (YYYY-MM-DD dates)",
      ),
    );
    return;
  }
  const redline = await service.redlineBetween(fromDate, toDate, citation);
  // Pure function of two fixed dates + one citation: cacheable like the diff
  // route. 5 min (not 3600) because a redline spans two upstream fetches and
  // the from/to window is only rarely an identical document; errors below carry
  // no Cache-Control header (matching handleDiff's shape).
  sendJson(req, res, 200, { ...redline }, 'public, max-age=300');
}

function statusFor(error: ServiceError | StructureError): { status: number; code: string } {
  if (error instanceof StructureError) return { status: 404, code: 'not_found' };
  if (error.code === 'unavailable') return { status: 500, code: 'internal_error' };
  if (error.code === 'not_found') return { status: 404, code: 'not_found' };
  return { status: 400, code: 'invalid_input' };
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

/**
 * The API index: what this instance serves, and what each route needs.
 *
 * A self-hosted service has to be discoverable on its own. Without this,
 * a developer or an agent probing the instance finds a bare 404, and the
 * contract — `docs/openapi.yaml` — is only reachable in the repository.
 *
 * The conformance suite checks this list against the spec, so the two
 * cannot drift.
 */
const ROUTE_INDEX: JsonBody = {
  service: 'cfr-free',
  version: VERSION,
  openapi: OPENAPI_PATH,
  routes: [
    {
      method: 'GET',
      path: '/api/v1',
      summary: 'This index — the routes below.',
      required: [],
    },
    {
      method: 'GET',
      path: '/api/v1/search',
      summary: 'Ranked provisions for a query.',
      required: ['q'],
    },
    {
      method: 'GET',
      path: '/api/v1/sections/{citation}',
      summary: 'One provision by citation.',
      required: ['citation'],
    },
    {
      method: 'GET',
      path: '/api/v1/browse',
      summary: 'The hierarchy, from its root or from a node.',
      required: [],
    },
    {
      method: 'GET',
      path: '/api/v1/diff',
      summary: 'Changes between two issue dates.',
      required: ['from', 'to'],
    },
    {
      method: 'GET',
      path: '/api/v1/redline',
      summary: 'Line-level redline of one provision.',
      required: ['from', 'to', 'citation'],
    },
    { method: 'GET', path: '/health', summary: 'Freshness and status.', required: [] },
    { method: 'GET', path: '/metrics', summary: 'Prometheus exposition text.', required: [] },
  ],
};

/**
 * The OpenAPI document, read from the package and cached.
 *
 * `../../docs/openapi.yaml` is the repository's copy in development
 * (`src/titan/`) and the package's copy in a build (`dist/titan/`). It is
 * read lazily and cached: a deployment without the file must still serve
 * every other route, and the route that needs it should say so.
 */
let openApiDocument: string | null = null;

function readOpenApiDocument(): string | null {
  if (openApiDocument !== null) return openApiDocument;
  try {
    openApiDocument = readFileSync(new URL('../../docs/openapi.yaml', import.meta.url), 'utf8');
  } catch {
    return null;
  }
  return openApiDocument;
}

/**
 * The discovery routes: the API index and the OpenAPI document.
 *
 * Returns whether it answered the request, so the router can carry on.
 */
function handleDiscovery(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): boolean {
  if (pathname === API_INDEX_PATH) {
    sendJson(req, res, 200, ROUTE_INDEX, 'no-store');
    return true;
  }
  if (pathname === OPENAPI_PATH) {
    const document = readOpenApiDocument();
    if (document === null) {
      sendJson(
        req,
        res,
        500,
        errorBody('internal_error', 'the OpenAPI document is not available in this installation'),
      );
      return true;
    }
    sendStatic(req, res, YAML_HEADER, document, undefined);
    return true;
  }
  return false;
}

async function dispatch(
  service: CFRService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  disk?: () => DiskSnapshot | null,
): Promise<void> {
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
  if (pathname === DIFF_PATH) {
    await handleDiff(service, req, res, url);
    return;
  }
  if (pathname === REDLINE_PATH) {
    await handleRedline(service, req, res, url);
    return;
  }
  if (handleDiscovery(req, res, pathname)) return;
  if (pathname === UI_PATH) {
    sendStatic(req, res, HTML_HEADER, UI_HTML, UI_CSP);
    return;
  }
  if (pathname === UI_JS_PATH) {
    sendStatic(req, res, JS_HEADER, UI_JS, undefined);
    return;
  }
  if (pathname === UI_CSS_PATH) {
    sendStatic(req, res, CSS_HEADER, UI_CSS, undefined);
    return;
  }
  sendJson(req, res, 404, errorBody('not_found', `no route for ${pathname}`));
}

/** Optional server knobs; the default (loopback) deployment needs none. */
export interface HttpServerOptions {
  /** Per-peer request budget — enabled only when the bind is deliberately remote. */
  readonly rateLimit?: { readonly capacity: number; readonly refillPerSec: number };
  /**
   * Disk-capacity accessor (delivery log §13 #22), read per request so `/health` and
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

/** The request's URL, or null when it does not parse. */
function parseRequestUrl(raw: string | undefined): URL | null {
  try {
    return new URL(raw ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

/** The token cost of a route that pulls the whole upstream document. */
export const EXPENSIVE_ROUTE_COST = 10;

/**
 * What a request costs the server, in rate-limit tokens.
 *
 * The index routes read the LOCAL index: one token each. The diff and
 * redline routes fetch the complete Title 38 document from eCFR — ~2 MB on
 * the wire, ~16 MB parsed — so they charge a route a peer cannot buy with
 * a single token. One token per request meant the published image's budget
 * (60 burst, 10 a second) bought ten whole upstream documents a second —
 * twenty of them, counting the two documents a diff or a redline pulls.
 */
function requestCost(pathname: string): number {
  if (pathname === DIFF_PATH || pathname === REDLINE_PATH) return EXPENSIVE_ROUTE_COST;
  return 1;
}

/**
 * The cost of a request the router will REFUSE (a bad method, an
 * oversized URL): one token.
 *
 * The request does no work, so it does not cost what a routed request
 * costs — but it is still a request, and an uncharged one is free to
 * repeat. The budget bounds how much traffic the server will look at,
 * not only how much work it will do.
 */
const REFUSED_REQUEST_COST = 1;

/**
 * Method, rate, and size gates that run before routing. Returns the parsed
 * URL, or null when the request was already answered with an error.
 */
function precheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  limiter: RateLimiter | null,
): URL | null {
  const methodRefused = req.method !== 'GET' && req.method !== 'HEAD';
  const urlTooLong = Buffer.byteLength(req.url ?? '/', 'utf8') > MAX_URL_BYTES;
  // The URL is parsed before the limiter, because the cost of a request
  // depends on the route it will take.
  const url = parseRequestUrl(req.url);
  if (limiter !== null) {
    // Every request is charged, including the ones the gates below
    // refuse: a refused request is still a request, and leaving the
    // refusal free would let a peer send unlimited 2 KB URLs (or
    // unlimited POSTs) without ever touching the budget.
    const refused = methodRefused || urlTooLong || url === null;
    const cost = refused ? REFUSED_REQUEST_COST : requestCost(url.pathname);
    const verdict = limiter.consume(req.socket.remoteAddress ?? 'unknown', cost);
    if (!verdict.allowed) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil(verdict.retryAfterSec))));
      sendJson(req, res, 429, errorBody('rate_limited', 'too many requests — retry shortly'));
      return null;
    }
  }
  if (methodRefused) {
    res.setHeader('allow', 'GET, HEAD');
    sendJson(req, res, 405, errorBody('method_not_allowed', 'only GET and HEAD are supported'));
    return null;
  }
  if (urlTooLong) {
    sendJson(
      req,
      res,
      414,
      errorBody('uri_too_long', `request URL exceeds ${MAX_URL_BYTES} bytes`),
    );
    return null;
  }
  if (url === null) {
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
    // `dispatch` is async since the diff and redline routes await the eCFR
    // facade, so one async task wraps the whole cycle: precheck runs first (it
    // answers its own errors synchronously and never throws), then `await
    // dispatch` puts async rejections in front of the SAME catch the sync
    // handlers have always used — ServiceError/StructureError → statusFor
    // (400/404/500 + client-safe message), anything else → logged + generic 500.
    void (async () => {
      const url = precheck(req, res, limiter);
      if (url === null) return;

      try {
        await dispatch(service, req, res, url, options.disk);
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
        // An upstream-DATA fault: eCFR answered, and what it sent is not what
        // the contract allows. That is a bad gateway, not an internal error —
        // and it must not be collapsed into a generic 500, or the most
        // actionable messages in the codebase are swallowed (CR-21).
        if (error instanceof UpstreamFormatError) {
          logger.error('upstream data fault', {
            path: url.pathname,
            message: error.message,
          });
          if (!res.headersSent) {
            sendJson(req, res, 502, errorBody('upstream_error', 'upstream data was not usable'));
          } else {
            res.end();
          }
          return;
        }
        if (error instanceof SemaphoreOverflowError) {
          // The upstream queue is full: the request could not be parked
          // behind the fetches already in flight. A fast, explicit
          // refusal beats a request that waits minutes for a permit.
          logger.warn('http request refused — upstream queue full', {
            path: url.pathname,
          });
          sendJson(
            req,
            res,
            503,
            errorBody('upstream_busy', 'too many requests in flight — retry shortly'),
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
    })();
  });
  // Bound how long a client may take to complete a request (delivery log §12 #16);
  // the header timeout already defaults to 60 s.
  server.requestTimeout = 60_000;
  // The rate limiter runs inside `precheck`, which is reached only after
  // the request line and the headers are complete — so a client that
  // dribbles its headers holds a socket without spending a token. The
  // header timeout bounds that wait, and the connection cap bounds the
  // sockets themselves.
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 256;
  return server;
}
