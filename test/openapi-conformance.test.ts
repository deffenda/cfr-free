/**
 * OpenAPI conformance: `docs/openapi.yaml` protecting itself.
 *
 * The spec is static (nothing serves it), so this file enforces the
 * contract — the document's own structure and provenance comments, and the
 * live server's responses against the document:
 *
 * 1. Spec well-formedness — parses the real YAML with the `yaml` package
 *    (a declared devDependency) and checks the structural rules an outside
 *    scan tripped on: path templates declared, HEAD twins mirroring GET
 *    parameters, every `$ref` resolvable under `#/components/`, response
 *    statuses bound to Response Objects, `required ⊆ properties`, and only
 *    documented conditionals left optional.
 *
 * 2. Response conformance — boots the real HTTP server in-process over a
 *    seeded temp store (test/http-server.test.ts bootstrap) and, for EVERY
 *    path × method the spec declares, asserts the live status is declared,
 *    the live 200 body validates against the spec's own response schema
 *    (Ajv2020 + ajv-formats, `$ref`s resolved locally), and HEAD answers
 *    with an empty body. Documented error statuses are probed the same way.
 *    A second server seeded through the real `syncIndex` path exercises the
 *    non-null SyncChanges branch of Health.lastChanges (the fixture store
 *    has no sync history, so it exercises the null branch).
 *
 * 3. Provenance drift — every citation in the document must name a symbol
 *    that exists, in real code, and that still does what the citation
 *    claims for it: the `# source:` comments, and the inline `file#symbol`
 *    anchors in the response descriptions. The anchors are SYMBOLS, not
 *    lines, so inserting a line above the router does not invalidate them.
 *
 * Deterministic by construction: in-process server, injected fetch, no
 * sleeps, and no external process — the spec is parsed in-process by the
 * `yaml` package, so the contract needs nothing installed beyond this
 * repository's own devDependencies.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import type http from 'node:http';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
import { parse as parseYaml, parseDocument, visit } from 'yaml';
import { EcfrApi } from '../src/core/ecfr.js';
import { SemaphoreOverflowError } from '../src/core/semaphore.js';
import { HttpClient } from '../src/core/http-client.js';
import type { FetchLike } from '../src/core/http-client.js';
import { CFRService } from '../src/core/service.js';
import { syncIndex } from '../src/core/sync.js';
import { createHttpServer } from '../src/titan/http-server.js';
import { FIXTURE_STRUCTURE, createTestLogger, openTempStore, type TempStore } from './helpers.js';

// ---------------------------------------------------------------------------
// Spec loading: the real YAML, parsed in-process by the `yaml` package.
// A parse failure must fail the suite loudly — never skip: a silently
// missing spec would disable every contract check below.
// ---------------------------------------------------------------------------

const SPEC_PATH = fileURLToPath(new URL('../docs/openapi.yaml', import.meta.url));

interface SpecParameter {
  readonly name: string;
  readonly in: string;
}

interface SpecOperation {
  readonly responses?: Record<string, unknown> | undefined;
  readonly parameters?: readonly unknown[] | undefined;
}

interface SpecPathItem {
  readonly parameters?: readonly unknown[] | undefined;
  readonly [member: string]: unknown;
}

interface SpecDocument {
  readonly openapi?: unknown;
  readonly paths?: Record<string, SpecPathItem> | undefined;
  readonly components?:
    | {
        readonly responses?: Record<string, unknown> | undefined;
        readonly schemas?: Record<string, Record<string, unknown>> | undefined;
      }
    | undefined;
}

function loadSpec(): SpecDocument {
  const source = readFileSync(SPEC_PATH, 'utf8');
  try {
    return parseYaml(source) as SpecDocument;
  } catch (error) {
    throw new Error(
      `docs/openapi.yaml could not be parsed as YAML (${error instanceof Error ? error.message : String(error)}) — ` +
        'the OpenAPI contract cannot be checked without it, so the test fails instead of skipping.',
      { cause: error },
    );
  }
}

const SPEC = loadSpec();

function specPaths(): Record<string, SpecPathItem> {
  return SPEC.paths ?? {};
}

function specSchemas(): Record<string, Record<string, unknown>> {
  return SPEC.components?.schemas ?? {};
}

// ---------------------------------------------------------------------------
// Local $ref tooling: pointer resolution, whole-document ref collection, and
// a deep resolver that inlines `#/components/...` references so Ajv compiles
// a self-contained schema.
// ---------------------------------------------------------------------------

function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  const FORBIDDEN = new Set<string>(['__proto__', 'constructor', 'prototype']);
  let node: unknown = doc;
  for (const rawSegment of ref.slice(2).split('/')) {
    if (node === null || typeof node !== 'object') return undefined;
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    // Own-property lookups only: a `$ref` must never traverse Object.prototype
    // (a path hitting `__proto__`/`constructor` resolves to nothing — the right
    // answer, since this repo's spec points only at `#/components/...`).
    const holder = node as Record<string, unknown>;
    if (!Object.hasOwn(holder, segment) || FORBIDDEN.has(segment)) return undefined;
    node = holder[segment];
    if (node === undefined) return undefined;
  }
  return node;
}

function collectRefs(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') out.push(value);
    else collectRefs(value, out);
  }
}

function resolveSchemaRefs(node: unknown, doc: unknown, stack: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((item) => resolveSchemaRefs(item, doc, stack));
  if (node === null || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  const ref = record['$ref'];
  if (typeof ref === 'string') {
    if (stack.includes(ref))
      throw new Error(`circular $ref chain: ${[...stack, ref].join(' -> ')}`);
    const target = resolvePointer(doc, ref);
    if (target === undefined) throw new Error(`unresolvable $ref: ${ref}`);
    return resolveSchemaRefs(target, doc, [...stack, ref]);
  }
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = resolveSchemaRefs(value, doc, stack);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Ajv (OAS 3.1 dialect) for live-body validation.
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ strict: false, allErrors: true });
// ajv-formats ships CJS whose exports object doubles as the plugin and
// self-references it as `.default` — reachable from every module interop.
addFormats.default(ajv);

function schemaLabel(schema: unknown): string {
  if (schema !== null && typeof schema === 'object') {
    const ref = (schema as Record<string, unknown>)['$ref'];
    if (typeof ref === 'string') return ref.slice(ref.lastIndexOf('/') + 1) || ref;
  }
  return 'declared schema';
}

function parseJsonBody(label: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${label}: body is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

function mediaTypeOf(headers: Headers): string {
  const raw = headers.get('content-type');
  if (raw === null) return '';
  return (raw.split(';')[0] ?? '').trim();
}

function declaredResponseHeaders(response: Record<string, unknown>): string[] {
  const headers = response['headers'];
  return headers !== null && typeof headers === 'object' ? Object.keys(headers as object) : [];
}

/** Assert the live content-type is one the spec declares; returns it. */
function assertMediaDeclared(
  label: string,
  response: Record<string, unknown>,
  headers: Headers,
): string {
  const content = response['content'];
  const declared =
    content !== null && typeof content === 'object' ? Object.keys(content as object) : [];
  const actual = mediaTypeOf(headers);
  if (!declared.includes(actual)) {
    throw new Error(
      `${label}: content-type "${actual}" is not declared (spec declares: ${declared.join(', ') || 'no content'})`,
    );
  }
  return actual;
}

/**
 * Assert a live response body matches the spec: declared headers present,
 * actual media type declared, and the body valid against the locally
 * resolved response schema.
 */
function assertBodyConforms(
  label: string,
  response: Record<string, unknown>,
  headers: Headers,
  text: string,
): void {
  for (const name of declaredResponseHeaders(response)) {
    if (!headers.has(name))
      throw new Error(`${label}: declared header "${name}" missing from the live response`);
  }
  const media = assertMediaDeclared(label, response, headers);
  const content = response['content'];
  if (content === null || typeof content !== 'object')
    throw new Error(`${label}: response declares no content`);
  const mediaEntry = (content as Record<string, unknown>)[media];
  if (mediaEntry === null || typeof mediaEntry !== 'object')
    throw new Error(`${label}: no entry for ${media}`);
  const schema = (mediaEntry as Record<string, unknown>)['schema'];
  if (schema === undefined) throw new Error(`${label}: no schema declared for ${media}`);
  const resolved = resolveSchemaRefs(schema, SPEC, []);
  if (resolved === null || typeof resolved !== 'object')
    throw new Error(`${label}: resolved schema is not an object`);
  const validate = ajv.compile(resolved as AnySchema);
  const body = media.startsWith('application/json') ? parseJsonBody(label, text) : text;
  if (!validate(body)) {
    throw new Error(
      `${label}: body violates ${schemaLabel(schema)} — ${ajv.errorsText(validate.errors)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Spec navigation helpers.
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

const KNOWN_PATHS = [
  '/',
  '/ui.js',
  '/ui.css',
  '/health',
  '/metrics',
  '/api/v1/search',
  '/api/v1/sections/{citation}',
  '/api/v1/browse',
  '/api/v1/diff',
  '/api/v1/redline',
] as const;

interface OperationEntry {
  readonly method: (typeof HTTP_METHODS)[number];
  readonly operation: SpecOperation;
}

function operationsOf(pathItem: SpecPathItem): OperationEntry[] {
  const entries: OperationEntry[] = [];
  for (const method of HTTP_METHODS) {
    const value = pathItem[method];
    if (value !== null && typeof value === 'object')
      entries.push({ method, operation: value as SpecOperation });
  }
  return entries;
}

function parametersOf(raw: readonly unknown[] | undefined): SpecParameter[] {
  if (raw === undefined) return [];
  const params: SpecParameter[] = [];
  for (const value of raw) {
    if (value === null || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (typeof record['name'] === 'string' && typeof record['in'] === 'string') {
      params.push({ name: record['name'], in: record['in'] });
    }
  }
  return params;
}

function operationOf(specPath: string, method: 'get' | 'head'): SpecOperation {
  const pathItem = specPaths()[specPath];
  if (pathItem === undefined) throw new Error(`docs/openapi.yaml no longer documents ${specPath}`);
  const operation = pathItem[method];
  if (operation === null || typeof operation !== 'object') {
    throw new Error(`${specPath} no longer documents a ${method.toUpperCase()} operation`);
  }
  return operation as SpecOperation;
}

function declaredStatuses(operation: SpecOperation): string[] {
  return operation.responses === undefined ? [] : Object.keys(operation.responses);
}

/** The Response Object for a status, following a `#/components/responses/` $ref. */
function responseFor(
  operation: SpecOperation,
  status: string,
): Record<string, unknown> | undefined {
  const entry = operation.responses === undefined ? undefined : operation.responses[status];
  if (entry === null || typeof entry !== 'object') return undefined;
  const record = entry as Record<string, unknown>;
  const ref = record['$ref'];
  if (typeof ref === 'string') {
    const target = resolvePointer(SPEC, ref);
    if (target === null || typeof target !== 'object') return undefined;
    return target as Record<string, unknown>;
  }
  return record;
}

function responseDescriptionViolations(label: string, response: Record<string, unknown>): string[] {
  const description = response['description'];
  return typeof description === 'string' && description.length > 0
    ? []
    : [`${label}: Response Object has no description`];
}

function responseBindingViolations(label: string, entry: unknown): string[] {
  if (entry === null || typeof entry !== 'object') return [`${label}: response is not an object`];
  const record = entry as Record<string, unknown>;
  const ref = record['$ref'];
  if (typeof ref !== 'string') return responseDescriptionViolations(label, record);
  if (!ref.startsWith('#/components/responses/')) {
    return [`${label}: $ref ${ref} must point into #/components/responses/`];
  }
  const resolved = resolvePointer(SPEC, ref);
  if (resolved === undefined || resolved === null || typeof resolved !== 'object') {
    return [`${label}: $ref ${ref} does not resolve`];
  }
  return responseDescriptionViolations(label, resolved as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Suite 1 — spec well-formedness.
// ---------------------------------------------------------------------------

// docs/openapi.yaml info.description: "All schema fields listed under
// required are always present (the optional Health.diskFree/diskTotal are
// the deliberate exception)"; NotFound documents browse's `available` the
// same way. Every other declared property is an always-present field:
// dropping one from `required` (or declaring a new optional property)
// silently widens the contract while the server keeps emitting the field.
const CONDITIONAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Error: ['available'],
  Health: ['diskFree', 'diskTotal'],
  // The core omits these keys when the provision did not exist on that date
  // (added/removed) — the same "absent when not applicable" shape as Health's
  // disk fields and browse's `available`.
  RedlineResult: ['fromText', 'toText'],
};

describe('OpenAPI spec well-formedness (docs/openapi.yaml)', () => {
  it('declares an OpenAPI 3.1.x document', () => {
    const version = SPEC.openapi;
    expect(typeof version, 'openapi: header is missing').toBe('string');
    expect(
      String(version).startsWith('3.1'),
      `openapi: ${String(version)} must be 3.1.x — the nullable type-array syntax (type: [string, "null"]) depends on it`,
    ).toBe(true);
  });

  it('documents a non-empty paths object including every known API path', () => {
    const paths = Object.keys(specPaths());
    expect(paths.length, 'paths: must not be empty').toBeGreaterThan(0);
    expect(
      KNOWN_PATHS.filter((known) => !paths.includes(known)),
      'known API paths missing from docs/openapi.yaml',
    ).toEqual([]);
  });

  it('declares each path template variable at the path-item or in every operation', () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(specPaths())) {
      const variables = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? '');
      for (const variable of variables) {
        const atPathItem = parametersOf(pathItem.parameters).some(
          (param) => param.name === variable && param.in === 'path',
        );
        if (atPathItem) continue;
        const operations = operationsOf(pathItem);
        if (operations.length === 0) {
          violations.push(`${path}: template {${variable}} has no operation to declare it`);
          continue;
        }
        for (const { method, operation } of operations) {
          const declared = parametersOf(operation.parameters).some(
            (param) => param.name === variable && param.in === 'path',
          );
          if (!declared) {
            violations.push(
              `${path}: template {${variable}} is not declared by the ${method.toUpperCase()} operation ` +
                '(declare it there or at the path-item level)',
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('mirrors every GET parameter in the HEAD twin (name + in)', () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(specPaths())) {
      const operations = operationsOf(pathItem);
      const get = operations.find((entry) => entry.method === 'get');
      const head = operations.find((entry) => entry.method === 'head');
      if (get === undefined || head === undefined) continue;
      const headParams = parametersOf(head.operation.parameters);
      for (const param of parametersOf(get.operation.parameters)) {
        const mirrored = headParams.some(
          (other) => other.name === param.name && other.in === param.in,
        );
        if (!mirrored) {
          violations.push(`${path}: HEAD is missing {${param.in}} ${param.name} declared by GET`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('resolves every $ref to a #/components/... target in this document', () => {
    const refs: string[] = [];
    collectRefs(SPEC, refs);
    expect(refs.length, 'spec contains no $ref at all').toBeGreaterThan(0);
    const broken = [...new Set(refs)].filter(
      (ref) => !ref.startsWith('#/components/') || resolvePointer(SPEC, ref) === undefined,
    );
    expect(broken, 'unresolvable or non-#/components $ref').toEqual([]);
  });

  it('binds every operation response status to a resolvable Response Object', () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(specPaths())) {
      for (const { method, operation } of operationsOf(pathItem)) {
        const label = `${path} ${method.toUpperCase()}`;
        const responses = operation.responses;
        if (responses === undefined || Object.keys(responses).length === 0) {
          violations.push(`${label}: operation declares no responses`);
          continue;
        }
        for (const [status, entry] of Object.entries(responses)) {
          violations.push(...responseBindingViolations(`${label} ${status}`, entry));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps every schema required list inside its properties', () => {
    const violations: string[] = [];
    for (const [name, schema] of Object.entries(specSchemas())) {
      const properties = schema['properties'];
      const keys =
        properties !== null && typeof properties === 'object'
          ? Object.keys(properties as object)
          : [];
      const required = schema['required'];
      if (required === undefined) continue;
      if (!Array.isArray(required)) {
        violations.push(`${name}: required is not an array`);
        continue;
      }
      for (const field of required) {
        if (typeof field !== 'string')
          violations.push(`${name}: required contains a non-string entry`);
        else if (!keys.includes(field))
          violations.push(`${name}: required field "${field}" is not in properties`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('requires every always-present property (only documented conditionals stay optional)', () => {
    const violations: string[] = [];
    for (const [name, schema] of Object.entries(specSchemas())) {
      const properties = schema['properties'];
      const keys =
        properties !== null && typeof properties === 'object'
          ? Object.keys(properties as object)
          : [];
      const required = Array.isArray(schema['required'])
        ? schema['required'].filter((field): field is string => typeof field === 'string')
        : [];
      const conditional = CONDITIONAL_FIELDS[name] ?? [];
      const undocumentedOptional = keys.filter(
        (key) => !required.includes(key) && !conditional.includes(key),
      );
      const staleConditional = conditional.filter(
        (key) => !keys.includes(key) || required.includes(key),
      );
      for (const key of undocumentedOptional) {
        violations.push(
          `${name}: property "${key}" is optional but not documented as conditional — ` +
            'restore it under required (the server emits it on every response)',
        );
      }
      for (const key of staleConditional) {
        violations.push(
          `${name}: "${key}" is listed as conditional but is not a plain optional property — update CONDITIONAL_FIELDS`,
        );
      }
    }
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — response conformance against the live in-process server.
// ---------------------------------------------------------------------------

// One concrete request per spec path. Every enumerated spec path MUST have
// an entry: a newly documented path fails test collection until its probe
// exists, so the matrix cannot silently lag the spec.
const ROUTE_PROBES: Readonly<
  Record<string, { readonly requestPath: string; readonly query?: string }>
> = {
  '/': { requestPath: '/' },
  '/ui.js': { requestPath: '/ui.js' },
  '/ui.css': { requestPath: '/ui.css' },
  '/health': { requestPath: '/health' },
  '/metrics': { requestPath: '/metrics' },
  '/api/v1/search': { requestPath: '/api/v1/search', query: 'q=veteran&per_page=1' },
  '/api/v1/sections/{citation}': { requestPath: '/api/v1/sections/4.125' },
  '/api/v1/browse': { requestPath: '/api/v1/browse' },
  '/api/v1/diff': { requestPath: '/api/v1/diff', query: 'from=2026-01-01&to=2026-06-01' },
  '/api/v1/redline': {
    requestPath: '/api/v1/redline',
    query: 'from=2026-01-01&to=2026-06-01&citation=4.125',
  },
};

/**
 * Offline eCFR stub for the `/api/v1/diff` happy probe: one section amended
 * between the two probe dates, so the route answers a real 200 DiffResult
 * (stub builders are duplicated per suite — test/helpers.ts is not shared
 * for these).
 */
function makeDiffEcfr(): EcfrApi {
  const xml = (body: string): string =>
    `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Test.</HEAD><P>${body}</P></DIV8></DIV5></DIV3></DIV1>`;
  const byDate: Readonly<Record<string, string>> = {
    '2026-01-01': xml('Original body.'),
    '2026-06-01': xml('Amended body.'),
  };
  return {
    getFullTitleXml: async (issueDate: string) => {
      const doc = byDate[issueDate];
      if (doc === undefined) throw new Error(`HTTP 404 for ${issueDate}`);
      return doc;
    },
  } as unknown as EcfrApi;
}

/**
 * Offline eCFR stub for the `/api/v1/redline` probes (D2's makeDiffEcfr
 * mirrored): the same two probe dates, one section amended between them, plus
 * a second section absent from BOTH dates so the 404 probe (a citation
 * missing from both parses) is exercised for real.
 */
function makeRedlineEcfr(): EcfrApi {
  const xml = (body: string): string =>
    `<ECFR><DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD><DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD><DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD><DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Test.</HEAD><P>${body}</P></DIV8></DIV5></DIV3></DIV1>`;
  const byDate: Readonly<Record<string, string>> = {
    '2026-01-01': xml('Original body.'),
    '2026-06-01': xml('Amended body.'),
  };
  return {
    getFullTitleXml: async (issueDate: string) => {
      const doc = byDate[issueDate];
      if (doc === undefined) throw new Error(`HTTP 404 for ${issueDate}`);
      return doc;
    },
  } as unknown as EcfrApi;
}

/** The issue date whose fetch refuses because the upstream queue is full. */
const BUSY_DATE = '2026-03-03';

/**
 * Offline eCFR stub for the `503 upstream_busy` probe: the upstream wait
 * queue was full, so the request is refused at once instead of being parked
 * behind the fetches already in flight.
 */
function makeBusyEcfr(): EcfrApi {
  return {
    getFullTitleXml: async (issueDate: string) => {
      if (issueDate === BUSY_DATE) throw new SemaphoreOverflowError(16);
      throw new Error(`HTTP 404 for ${issueDate}`);
    },
  } as unknown as EcfrApi;
}

/**
 * Date-keyed stub merge: the happy probe for `/api/v1/diff` and the probes for
 * `/api/v1/redline` share the same two dates, so one client serves both — each
 * stub owns its own date registry, and the first to answer wins.
 */
function mergeEcfr(...clients: readonly EcfrApi[]): EcfrApi {
  return {
    getFullTitleXml: async (issueDate: string) => {
      for (const client of clients) {
        try {
          return await client.getFullTitleXml(issueDate);
        } catch (error) {
          // A full upstream queue is a real answer, not a "this stub has
          // no such date" miss: it must reach the client as the
          // documented 503, not be swallowed by the next stub.
          if (error instanceof SemaphoreOverflowError) throw error;
          // Fall through to the next stub's registry.
        }
      }
      throw new Error(`HTTP 404 for ${issueDate}`);
    },
  } as unknown as EcfrApi;
}

interface HappyProbeRow {
  readonly label: string;
  readonly specPath: string;
  readonly operation: 'get' | 'head';
  readonly method: 'GET' | 'HEAD';
  readonly url: string;
}
function buildHappyProbeRows(): HappyProbeRow[] {
  const rows: HappyProbeRow[] = [];
  for (const specPath of Object.keys(specPaths())) {
    const probe = ROUTE_PROBES[specPath];
    if (probe === undefined) {
      throw new Error(
        `docs/openapi.yaml now documents ${specPath} — add a probe for it to ROUTE_PROBES in test/openapi-conformance.test.ts`,
      );
    }
    const url =
      probe.query === undefined ? probe.requestPath : `${probe.requestPath}?${probe.query}`;
    for (const method of ['GET', 'HEAD'] as const) {
      rows.push({
        label: `${method} ${url}`,
        specPath,
        operation: method.toLowerCase() as 'get' | 'head',
        method,
        url,
      });
    }
  }
  return rows;
}

interface ErrorProbeRow {
  readonly label: string;
  readonly specPath: string;
  /** Operation whose declared responses document this status. */
  readonly operation: 'get' | 'head';
  readonly method: 'GET' | 'HEAD' | 'POST';
  readonly url: string;
  readonly expectedStatus: number;
}

const ERROR_PROBES: readonly ErrorProbeRow[] = [
  {
    label: 'search HEAD without required q',
    specPath: '/api/v1/search',
    operation: 'head',
    method: 'HEAD',
    url: '/api/v1/search',
    expectedStatus: 400,
  },
  {
    label: 'sections HEAD with an invalid citation',
    specPath: '/api/v1/sections/{citation}',
    operation: 'head',
    method: 'HEAD',
    url: '/api/v1/sections/zz',
    expectedStatus: 400,
  },
  {
    label: 'browse GET subpart without part',
    specPath: '/api/v1/browse',
    operation: 'get',
    method: 'GET',
    url: '/api/v1/browse?subpart=A',
    expectedStatus: 400,
  },
  {
    label: 'diff GET without required date params',
    specPath: '/api/v1/diff',
    operation: 'get',
    method: 'GET',
    url: '/api/v1/diff',
    expectedStatus: 400,
  },
  {
    label: 'redline GET without required params',
    specPath: '/api/v1/redline',
    operation: 'get',
    method: 'GET',
    url: '/api/v1/redline',
    expectedStatus: 400,
  },
  {
    label: 'redline GET with a citation missing from both dates',
    specPath: '/api/v1/redline',
    operation: 'get',
    method: 'GET',
    url: '/api/v1/redline?from=2026-01-01&to=2026-06-01&citation=99.999',
    expectedStatus: 404,
  },
  {
    label: 'sections GET unknown citation',
    specPath: '/api/v1/sections/{citation}',
    operation: 'get',
    method: 'GET',
    url: '/api/v1/sections/99.999',
    expectedStatus: 404,
  },
  {
    label: 'POST /health (non-GET/HEAD method)',
    specPath: '/health',
    operation: 'get',
    method: 'POST',
    url: '/health',
    expectedStatus: 405,
  },
  {
    label: 'POST / (web UI route, non-GET/HEAD method)',
    specPath: '/',
    operation: 'get',
    method: 'POST',
    url: '/',
    expectedStatus: 405,
  },
  {
    label: 'search URL over 2048 bytes',
    specPath: '/api/v1/search',
    operation: 'get',
    method: 'GET',
    url: `/api/v1/search?q=${'x'.repeat(3000)}`,
    expectedStatus: 414,
  },
  {
    label: 'diff GET when the upstream fetch queue is full',
    specPath: '/api/v1/diff',
    operation: 'get',
    method: 'GET',
    url: `/api/v1/diff?from=${BUSY_DATE}&to=2026-06-01`,
    expectedStatus: 503,
  },
  {
    label: 'redline GET when the upstream fetch queue is full',
    specPath: '/api/v1/redline',
    operation: 'get',
    method: 'GET',
    url: `/api/v1/redline?from=${BUSY_DATE}&to=2026-06-01&citation=4.125`,
    expectedStatus: 503,
  },
];

describe('OpenAPI response conformance (in-process server vs spec)', () => {
  let temp: TempStore;
  let server: http.Server;
  let base: string;

  const rows = buildHappyProbeRows();

  beforeAll(async () => {
    temp = openTempStore();
    // The happy probes for /api/v1/diff and /api/v1/redline need a fetching
    // client, so this server carries the merged stub stack — every other route
    // still reads the fixture store exactly as before.
    const ecfr = mergeEcfr(makeDiffEcfr(), makeRedlineEcfr(), makeBusyEcfr());
    server = createHttpServer(
      new CFRService(temp.store, 7, ecfr, createTestLogger()),
      createTestLogger(),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    temp.cleanup();
  });

  for (const row of rows) {
    it(`${row.label}: status declared${row.method === 'HEAD' ? ', empty body' : ', 200 body schema-valid'}`, async () => {
      const operation = operationOf(row.specPath, row.operation);
      const response = await fetch(`${base}${row.url}`, { method: row.method });
      const text = await response.text();
      expect(
        declaredStatuses(operation),
        `${row.label}: live status ${response.status} is not declared by the spec`,
      ).toContain(String(response.status));
      expect(response.status, `${row.label}: happy-path probe expected 200`).toBe(200);
      const ok200 = responseFor(operation, '200');
      if (ok200 === undefined) throw new Error(`${row.label}: spec 200 response does not resolve`);
      if (row.method === 'HEAD') {
        expect(text, `${row.label}: HEAD must not carry a body`).toBe('');
        return;
      }
      assertBodyConforms(row.label, ok200, response.headers, text);
    });
  }

  for (const probe of ERROR_PROBES) {
    it(`${probe.label} → ${probe.expectedStatus} as documented`, async () => {
      const operation = operationOf(probe.specPath, probe.operation);
      const response = await fetch(`${base}${probe.url}`, { method: probe.method });
      const text = await response.text();
      expect(
        declaredStatuses(operation),
        `${probe.label}: live status ${response.status} is not declared by the spec`,
      ).toContain(String(response.status));
      expect(
        response.status,
        `${probe.label}: expected the documented ${probe.expectedStatus}`,
      ).toBe(probe.expectedStatus);
      const documented = responseFor(operation, String(probe.expectedStatus));
      if (documented === undefined) {
        throw new Error(`${probe.label}: spec response ${probe.expectedStatus} does not resolve`);
      }
      if (probe.method === 'HEAD') {
        expect(text, `${probe.label}: HEAD must not carry a body`).toBe('');
        return;
      }
      assertBodyConforms(probe.label, documented, response.headers, text);
    });
  }

  it('sends HEAD with the same content headers as its GET twin', async () => {
    const violations: string[] = [];
    for (const row of rows) {
      if (row.method !== 'GET') continue;
      const get = await fetch(`${base}${row.url}`);
      const head = await fetch(`${base}${row.url}`, { method: 'HEAD' });
      for (const header of ['content-type', 'cache-control']) {
        const getValue = get.headers.get(header);
        const headValue = head.headers.get(header);
        if (getValue !== headValue) {
          violations.push(
            `${row.url}: GET ${header}=${String(getValue)} vs HEAD ${header}=${String(headValue)}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('/health covers every schema-required field after fixture seeding', async () => {
    const response = await fetch(`${base}/health`);
    const text = await response.text();
    expect(response.status).toBe(200);
    const body = parseJsonBody('GET /health', text) as Record<string, unknown>;
    const healthSchema = specSchemas()['Health'];
    if (healthSchema === undefined) throw new Error('components.schemas.Health missing');
    const required = healthSchema['required'];
    expect(Array.isArray(required), 'Health.required must be an array').toBe(true);
    const missing = (required as string[]).filter((field) => !(field in body));
    expect(missing, '/health body is missing schema-required fields').toEqual([]);
    // No sync history and no statfs accessor in this store: the nullable
    // branches must be exactly what the schema allows (null), and the
    // documented conditional fields must stay absent.
    expect(
      body['lastChanges'],
      'fixture store has no sync — lastChanges must take the null branch',
    ).toBeNull();
    expect(body['structureDrift'], 'fixtures predate the expectations meta').toBeNull();
    expect(body).not.toHaveProperty('diskFree');
  });

  it('/api/v1/sections covers every schema-required field (incl. citedBy)', async () => {
    const response = await fetch(`${base}/api/v1/sections/4.125`);
    const text = await response.text();
    expect(response.status).toBe(200);
    const body = parseJsonBody('GET /api/v1/sections/4.125', text) as Record<string, unknown>;
    const sectionSchema = specSchemas()['SectionDetail'];
    if (sectionSchema === undefined) throw new Error('components.schemas.SectionDetail missing');
    const required = sectionSchema['required'];
    expect(Array.isArray(required), 'SectionDetail.required must be an array').toBe(true);
    const missing = (required as string[]).filter((field) => !(field in body));
    expect(missing, 'section body is missing schema-required fields').toEqual([]);
    // Fixtures cite nothing: the backlink list must still be present, empty.
    expect(body['citedBy']).toEqual([]);
  });

  it('serves hit items that conform to the SearchHit schema (fixture query)', async () => {
    const response = await fetch(`${base}/api/v1/search?q=mental+disorder&per_page=1`);
    const text = await response.text();
    expect(response.status).toBe(200);
    const body = parseJsonBody('GET /api/v1/search?q=mental+disorder', text) as Record<
      string,
      unknown
    >;
    const hits = body['hits'];
    expect(
      Array.isArray(hits) && hits.length > 0,
      'fixture index must yield at least one hit',
    ).toBe(true);
    const hit = (hits as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect('partTitle' in hit).toBe(true);
    expect(hit['partTitle'] === null || typeof hit['partTitle'] === 'string').toBe(true);
    const operation = operationOf('/api/v1/search', 'get');
    const ok200 = responseFor(operation, '200');
    if (ok200 === undefined) throw new Error('search 200 response does not resolve');
    assertBodyConforms('GET /api/v1/search?q=mental+disorder', ok200, response.headers, text);
  });
});

// ---------------------------------------------------------------------------
// Suite 2b — /health.lastChanges through the real sync path: the fixture
// store above never synced (null branch); this one exercises the recorded
// SyncChanges branch. Deterministic fake eCFR, mirrored from test/sync.test.ts.
// ---------------------------------------------------------------------------

const SYNC_ISSUE_DATE = '2026-10-09';

const SYNC_FULL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
<DIV1 N="38" TYPE="TITLE"><HEAD>Title 38</HEAD>
<DIV3 N="I" TYPE="CHAPTER"><HEAD>Chapter I</HEAD>
<DIV5 N="4" TYPE="PART"><HEAD>Part 4</HEAD>
<DIV8 N="4.125" TYPE="SECTION"><HEAD>§ 4.125 Diagnosis of mental disorders.</HEAD><P>Body text.</P></DIV8>
</DIV5>
<DIV9 N="Appendix A to Part 4" TYPE="APPENDIX"><HEAD>Appendix A to Part 4—Table</HEAD><P>Appendix text.</P></DIV9>
</DIV3>
</ECFR>`;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeSyncFetch(): FetchLike {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/titles.json')) {
      return jsonResponse({
        titles: [
          {
            number: 35,
            name: 'Reserved',
            latest_issue_date: null,
            up_to_date_as_of: null,
            latest_amended_on: null,
          },
          {
            number: 38,
            name: 'Pensions, Bonuses, and Veterans’ Relief',
            latest_issue_date: '2026-08-27',
            up_to_date_as_of: SYNC_ISSUE_DATE,
            latest_amended_on: '2026-08-27',
          },
        ],
      });
    }
    if (url.pathname.includes('/structure/')) return jsonResponse(FIXTURE_STRUCTURE);
    if (url.pathname.includes('/full/')) {
      return new Response(SYNC_FULL_XML, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    }
    return new Response('not found', { status: 404 });
  };
}

describe('OpenAPI conformance: sync-seeded /health (lastChanges non-null branch)', () => {
  it('validates the recorded SyncChanges against the Health schema', async () => {
    const temp = openTempStore({ seed: false });
    const logger = createTestLogger();
    const http = new HttpClient({
      fetchFn: makeSyncFetch(),
      sleep: async () => undefined,
      retryDelayMs: 0,
      retries: 0,
    });
    await syncIndex({ ecfr: new EcfrApi(http), store: temp.store, logger });
    expect(
      temp.store.getMeta('last_changes'),
      'syncIndex must record last_changes meta',
    ).not.toBeNull();
    const server = createHttpServer(new CFRService(temp.store, 7), logger);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${base}/health`);
      const text = await response.text();
      expect(response.status).toBe(200);
      const body = parseJsonBody('GET /health (sync-seeded)', text) as Record<string, unknown>;
      expect(
        body['lastChanges'],
        'the SyncChanges branch must actually be exercised',
      ).not.toBeNull();
      const operation = operationOf('/health', 'get');
      const ok200 = responseFor(operation, '200');
      if (ok200 === undefined) throw new Error('/health 200 response does not resolve');
      assertBodyConforms('GET /health (sync-seeded)', ok200, response.headers, text);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      temp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — provenance drift: every citation in docs/openapi.yaml must name a
// symbol that EXISTS, in real code, and that still does what the citation
// claims for it.
//
// The anchor is a SYMBOL, not a line: the router can grow a hundred lines
// and `#dispatch` still names the same function, so a citation is a claim
// about the implementation rather than a tripwire on every insertion above
// it.
//
// Three questions, asked of every citation:
//
//   1. Does the symbol exist? The cited file is parsed with the TypeScript
//      compiler's own API, so the declarations are the compiler's: a
//      definition that is commented out is not in the tree at all, and a
//      method is a declaration wherever it lives — a class body, an object
//      literal, an interface, a type literal, an enum.
//
//   2. Does it carry the construct the citation claims? Every cited symbol
//      has its own expectation (SYMBOL_CONSTRUCTS), so a citation repointed
//      at a real symbol that does not carry it fails here. The construct is
//      not UNIQUE to the symbol — a local that holds the result carries it
//      too — so the route binding (3) is what says which symbol is the one
//      the route is served by.
//
//   3. Is it the right symbol for the route it documents? A citation inside
//      a path item names the handler that route calls, and the router's own
//      dispatch says which handler that is: a citation repointed at the
//      handler of another route fails here.
//
// The inline `file#symbol` anchors in the response descriptions are
// citations too, and are held to the first two questions.
// ---------------------------------------------------------------------------

/**
 * The construct each cited symbol must carry.
 *
 * One global keyword list cannot tell `#dispatch` from `#handleSection`:
 * both bodies call `sendJson`, so repointing a citation at the wrong real
 * symbol passed. The expectation is per symbol, and every entry is a
 * construct that symbol carries.
 *
 * The construct is NOT unique to the symbol: a LOCAL that holds the result
 * of the call carries it as well — `service.search` is carried by the
 * `result` of the search handler, `service.getSection` by `section`,
 * `service.diffBetween` by `diff`, `service.redlineBetween` by `redline`,
 * `JSON.stringify` by `payload` and `createServer` by `server`. So the
 * construct alone cannot say that a citation names the HANDLER; the route
 * binding does, because the router's own dispatch says which symbol serves
 * the route the citation documents.
 */
const SYMBOL_CONSTRUCTS: Readonly<Record<string, readonly string[]>> = {
  dispatch: ['pathname ==='],
  handleSearch: ['service.search'],
  handleSection: ['service.getSection'],
  handleBrowse: ['service.browse'],
  handleDiff: ['service.diffBetween'],
  handleRedline: ['service.redlineBetween'],
  precheck: ['retry-after'],
  statusFor: ['error.code'],
  createHttpServer: ['createServer'],
  sendNotModified: ['304'],
  sendJson: ['JSON.stringify'],
  sendStatic: ['content-security-policy'],
  etagFor: ['sha256'],
};

/**
 * The fallback for a symbol with no entry above: its declaration must carry
 * at least one of these, so a citation cannot check out a name that declares
 * nothing.
 */
const GENERAL_CONSTRUCTS = [
  'pathname ===',
  'sendJson',
  'sendText',
  'errorBody',
  'setHeader',
  'res.end',
  'res.statusCode',
  'invalid_input',
  'not_found',
  'method_not_allowed',
  'uri_too_long',
  'rate_limited',
  'internal_error',
] as const;

/** The file whose symbols carry the per-symbol expectations above. */
const ROUTER_FILE = 'src/titan/http-server.ts';

/**
 * True when `file` names the router.
 *
 * The path is NORMALIZED before the comparison: the expectations and the
 * route binding belong to the router's CONTRACT, and a citation that
 * spells the same file as `./src/titan/http-server.ts` must not slip out
 * of it by spelling it differently.
 */
function isRouterFile(file: string): boolean {
  return posix.normalize(file) === ROUTER_FILE;
}

/**
 * The constructs a citation of `symbol` in `file` expects its declaration
 * to carry.
 *
 * The per-symbol expectations were chosen for the ROUTER, so they apply
 * only there: a same-named symbol in another file is held to the general
 * list, not to the router's contract.
 */
function expectedConstructs(file: string, symbol: string): readonly string[] {
  if (isRouterFile(file)) return SYMBOL_CONSTRUCTS[symbol] ?? GENERAL_CONSTRUCTS;
  return GENERAL_CONSTRUCTS;
}

/**
 * A `# source:` citation: the marker, then the tail it introduces. The tail
 * is a comma-separated list of `file#symbol` pairs; a bare symbol inherits
 * the file of the pair before it.
 *
 * The marker must START the comment. The file's own convention note quotes
 * the marker inline, and a note that quotes it must not be read as a
 * citation — a citation that checks out nothing is worse than none.
 */
const CITATION_RE = /^\s*#\s*source:\s*(.*)$/;

/**
 * A `# source:` marker wherever the COMMENT carries it.
 *
 * The marker is looked for in the comment, not at the start of the line:
 * a contributor who writes the marker at the end of a line of YAML wrote
 * something the citation parser cannot read, and that is reported rather
 * than ignored — a citation that is never checked is a silent skip.
 *
 * The marker must open the comment or follow whitespace, so the
 * convention note — which quotes the marker inside backticks — is not
 * read as one.
 */
const MARKER_RE = /(^|\s)#\s*source:/;

/**
 * A YAML key: the indent, the name, and the colon that ends it.
 *
 * What follows the colon is read apart from the key: a key that carries
 * a VALUE is a mapping entry and not a path key, and a key that carries
 * a COMMENT is still the key it is.
 */
const KEY_RE = /^(\s*)([^\s#][^:]*):/;

/** `path/to/file.ts#symbol` — a file and the symbol it must define. */
const SYMBOL_PAIR_RE = /^([\w./-]+\.\w+)#([A-Za-z_$][\w$]*)$/;

/** A bare symbol name. */
const BARE_SYMBOL_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * An inline `file#symbol` anchor in the document's prose.
 *
 * The file part must name a SOURCE module — a TypeScript or JavaScript
 * file, whose symbols the resolver can resolve. An anchor whose file is
 * a document (`README.md`, `openapi.yaml`) or an asset
 * (`ui-client.css`) names a heading or a rule, not a declaration, and
 * the resolver would report it as a violation the moment the document
 * cited one: those extensions are not read as anchors at all.
 *
 * The file part must ALSO resolve inside the repository, and that is
 * what tells a citation (`src/titan/http-server.ts#sendJson`) from a
 * link with a fragment (`https://example.com/index.ts#intro`: the file
 * part of that anchor is outside the repository, so it names a page of
 * the web and not a declaration of this one). The rule is applied where
 * the file is resolved — see `anchorIsCitation`.
 */
const INLINE_ANCHOR_RE = /([\w./-]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))#([A-Za-z_$][\w$]*)/g;

/**
 * Whether an inline anchor is a citation or a link.
 *
 * An anchor whose file part does not resolve INSIDE the repository is a
 * link, and a link must not fail the gate. An anchor whose file resolves
 * but does not exist is a stale claim, and the check says so — the two are
 * not the same fact.
 *
 * The rule is the FILE, not the scheme: a host without a scheme resolves
 * inside the repository like any other path, so `example.com/index.ts`
 * names a file of the repository and is a claim about it — not a link.
 */
function anchorIsCitation(file: string): boolean {
  return citedFilePath(file) !== null;
}

/** One symbol a citation names, and the file it must be defined in. */
interface CitedSymbol {
  readonly file: string;
  readonly symbol: string;
  /** False when the citation does not parse as a symbol reference at all. */
  readonly wellFormed: boolean;
}

/**
 * Split a citation tail on the commas that are NOT inside parentheses: a
 * parenthetical is prose and may itself contain commas ("precheck (encoding,
 * URL parse, byte caps)").
 */
function splitTail(tail: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of tail) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * What a wrapped parenthetical contributed: the symbols it names, and the
 * segments it should be read as.
 */
interface Wrapped {
  readonly symbols: readonly CitedSymbol[];
  /** Segments to put back on the queue — a pair is unwrapped into them. */
  readonly segments: readonly string[];
}

/**
 * Read one wrapped parenthetical.
 *
 * A wrapped PAIR names a symbol: it is unwrapped and read as segments. A
 * wrapped BARE word is the ambiguous case — "(the router)" is prose and
 * "(handleSearch)" is a citation, and the shape alone cannot tell them
 * apart. So the FILE decides: a word the inherited file declares is a
 * citation, and a word it does not declare is prose. `isDeclared` answers
 * that question; without it a wrapped bare word is prose, because a word
 * nothing declares must never become a violation.
 */
function readWrapped(
  inner: string,
  file: string,
  isDeclared?: (file: string, symbol: string) => boolean,
): Wrapped {
  if (inner.includes('#')) return { symbols: [], segments: splitTail(inner) };
  if (isDeclared === undefined || file === '' || !BARE_SYMBOL_RE.test(inner)) {
    return { symbols: [], segments: [] };
  }
  const symbols: CitedSymbol[] = isDeclared(file, inner)
    ? [{ file, symbol: inner, wellFormed: true }]
    : [];
  return { symbols, segments: [] };
}

/** What one segment of a tail contributes. */
interface Read {
  readonly symbols: readonly CitedSymbol[];
  /** Segments to put back on the queue — a pair is unwrapped into them. */
  readonly segments: readonly string[];
  /** The file the segment leaves behind as the inherited one. */
  readonly file: string;
}

/**
 * Read one segment of a citation tail.
 *
 * A segment may carry parentheticals, and they are prose ("the router",
 * "revalidatable send", "encoding, URL parse, byte caps"). A bare word
 * among them is a citation only if the file declares it — see
 * `readWrapped`.
 */
function readSegment(
  segment: string,
  file: string,
  isDeclared?: (file: string, symbol: string) => boolean,
): Read {
  const symbols: CitedSymbol[] = [];
  const segments: string[] = [];
  let inherited = file;
  for (const part of segment.split(/(\([^)]*\))/)) {
    const text = part.trim();
    if (text === '') continue;
    if (text.startsWith('(') && text.endsWith(')')) {
      const wrapped = readWrapped(text.slice(1, -1).trim(), inherited, isDeclared);
      symbols.push(...wrapped.symbols);
      segments.push(...wrapped.segments);
      continue;
    }
    const pair = SYMBOL_PAIR_RE.exec(text);
    if (pair !== null) {
      inherited = pair[1] ?? '';
      symbols.push({ file: inherited, symbol: pair[2] ?? '', wellFormed: true });
      continue;
    }
    if (BARE_SYMBOL_RE.test(text) && inherited !== '') {
      symbols.push({ file: inherited, symbol: text, wellFormed: true });
      continue;
    }
    // An unparsable token is a violation, never a silent skip: a citation
    // that names nothing checks out nothing.
    symbols.push({ file: inherited, symbol: text, wellFormed: false });
  }
  return { symbols, segments, file: inherited };
}

/**
 * The route-binding violation for a cited symbol, or null when the
 * binding checks out.
 *
 * The binding is asked only of the ROUTER: it is a claim about the
 * router's dispatch, and a citation of another file's symbol is not a
 * claim about a route — asking it reported "the router has no path
 * constant" for a file that was never the router.
 */
function checkRouteBindingFor(
  file: string,
  where: string,
  source: string,
  path: string,
  symbol: string,
): string | null {
  if (!isRouterFile(file)) return null;
  return checkRouteBinding(where, source, path, symbol);
}

/**
 * The violation for one cited symbol, or null when it checks out.
 *
 * This is the entry point every citation goes through, and it asks three
 * things in order: the cited file's own source, the declaration the
 * citation names, and — when the citation documents a route — the router's
 * binding of that route to a handler.
 *
 * The source is a parameter so the check can be pinned against a fixture:
 * a guard that can only be exercised through the repository's own files
 * cannot be shown to fail when it is removed.
 */
function checkCitedSymbol(
  where: string,
  file: string,
  symbol: string,
  path: string | null,
  source?: string,
): string | null {
  const text = source ?? citedSource(file);
  if (text === null) {
    const resolved = citedFilePath(file);
    if (resolved === null) return `${where} — ${file} resolves outside the repository`;
    return `${where} — ${file} does not exist`;
  }
  const violation = checkDeclaration(where, file, text, symbol);
  if (violation !== null) return violation;
  // A citation that documents a construct rather than a route makes no
  // claim about the router's dispatch, so the binding is not asked of it.
  if (path === null) return null;
  return checkRouteBindingFor(file, where, text, path, symbol);
}

/**
 * The symbols a `# source:` tail names.
 *
 * A parenthetical is prose ("(the router)", "(encoding, URL parse, byte
 * caps)") and is dropped before the tail is read: a prose word must never
 * be mistaken for a symbol. A parenthetical that WRAPS a symbol reference
 * is not prose — it is a citation written in parentheses, and it is
 * unwrapped and checked rather than dropped.
 *
 * The rule for which is which is the PAIR: a wrapped segment names a
 * symbol when it carries a `file#symbol` pair, because a pair says which
 * file it is about.
 */
function citedSymbols(
  tail: string,
  isDeclared?: (file: string, symbol: string) => boolean,
): CitedSymbol[] {
  const cited: CitedSymbol[] = [];
  let file = '';
  const pending = [...splitTail(tail)];
  while (pending.length > 0) {
    const raw = pending.shift() ?? '';
    const segment = raw.trim();
    if (segment === '') continue;
    const read = readSegment(segment, file, isDeclared);
    cited.push(...read.symbols);
    file = read.file;
    pending.unshift(...read.segments);
  }
  return cited;
}

/** What the document's `# source:` citations contribute. */
interface DocumentCitations {
  /** How many symbol references the citations name. */
  readonly citations: number;
  /** The violations among them. */
  readonly violations: readonly string[];
}

/**
 * The document's `# source:` citations, checked.
 *
 * The scan is a FUNCTION so that a pin can drive it against a fixture: the
 * route binding is asked of a citation HERE, at the call site the shipped
 * document goes through, and a pin that drove the resolver directly would
 * leave that call site unpinned — the document's own path-item citations
 * could stop being route-bound and the suite would stay green.
 */
function scanDocumentCitations(
  specText: string,
  document = 'docs/openapi.yaml',
): DocumentCitations {
  const violations: string[] = [];
  let citations = 0;
  // A wrapped bare word is a citation only if the file declares it, so
  // the parser asks the file.
  const isDeclared = (file: string, symbol: string): boolean => {
    const source = citedSource(file);
    return source !== null && declarationFacts(source, symbol) !== null;
  };
  for (const citation of citationsIn(specText)) {
    const path = citation.path;
    for (const cited of citedSymbols(citation.tail, isDeclared)) {
      citations += 1;
      const where = `${document}:${citation.line} cites ${cited.file}#${cited.symbol}`;
      if (!cited.wellFormed) {
        violations.push(`${where} — not a symbol reference`);
        continue;
      }
      const violation = checkCitedSymbol(where, cited.file, cited.symbol, path);
      if (violation !== null) violations.push(violation);
    }
    // A citation in the paths mapping with no path item above it claims a
    // route the document does not name, so the binding cannot be asked of
    // it — and a check that cannot be run must say so, not pass.
    if (citation.pathUnknown) {
      violations.push(
        `${document}:${citation.line} — the document does not say which path this citation documents, so the route binding cannot be checked`,
      );
    }
  }
  // A marker the parser cannot read is a citation nobody checked, and it is
  // reported rather than ignored.
  for (const malformed of malformedCitationsIn(specText)) {
    violations.push(`${document}:${malformed.line} — ${malformed.reason}`);
  }
  return { citations, violations };
}

/** The name a declaration node declares, or null when it declares none. */
function declarationName(node: ts.Node): string | null {
  if (ts.isVariableDeclaration(node)) return node.name.getText();
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name === undefined ? null : node.name.getText();
  }
  return null;
}

/** The name a member node declares, or null when it declares none. */
function memberName(node: ts.Node): string | null {
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isEnumMember(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.name.getText();
  }
  return null;
}

/**
 * The name a node declares, or null when the node declares nothing.
 *
 * A member counts: a method is a declaration wherever it lives — a class
 * body, an object literal, an interface, a type literal, an enum — so a
 * citation stays resolvable when the code around it is reorganised.
 */
function declaredName(node: ts.Node): string | null {
  return declarationName(node) ?? memberName(node);
}

/**
 * What a declaration CARRIES, read out of its AST.
 *
 * A construct is not a word in the source text: it is a node. A comment
 * that says `service.search` is not a call to `service.search`, and a
 * declaration that only mentions the construct in a comment does not carry
 * it — the comment is not in the tree. The three sets below are the nodes
 * a citation's construct is looked up in.
 */
interface DeclarationFacts {
  /** Identifiers and literal values the declaration mentions. */
  readonly words: ReadonlySet<string>;
  /** Dotted property accesses: `service.search`, `res.end`. */
  readonly properties: ReadonlySet<string>;
  /** Comparisons: `pathname ===`. */
  readonly comparisons: ReadonlySet<string>;
}

/**
 * The facts a declaration node carries.
 *
 * The walk is the compiler's own: a node that is not in the tree is not
 * here, so a commented-out call is not a call.
 */
function factsOf(node: ts.Node): DeclarationFacts {
  const words = new Set<string>();
  const properties = new Set<string>();
  const comparisons = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current)) words.add(current.text);
    if (ts.isStringLiteral(current) || ts.isNumericLiteral(current)) words.add(current.text);
    if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression)) {
      properties.add(`${current.expression.text}.${current.name.text}`);
    }
    if (ts.isBinaryExpression(current)) {
      const left = ts.isIdentifier(current.left) ? current.left.text : current.left.getText();
      const operator = ts.tokenToString(current.operatorToken.kind) ?? '';
      if (operator !== '') comparisons.add(`${left} ${operator}`);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return { words, properties, comparisons };
}

/** A router path constant: its name and the path it holds. */
interface PathConstant {
  readonly name: string;
  readonly path: string;
}

/**
 * How the router's dispatch compares the path against a constant: an
 * EXACT route (`pathname === SEARCH_PATH`) serves that path and no other,
 * a PREFIX route (`pathname.startsWith(SECTIONS_PREFIX)`) serves every
 * path under the constant.
 */
type RouteKind = 'exact' | 'prefix';

/**
 * One branch of the router's dispatch: the handler it calls, and how it
 * compares the path against the constant it tests.
 */
interface Branch {
  /** The symbols the branch calls. */
  readonly calls: ReadonlySet<string>;
  /** How the branch compares the path against the constant. */
  readonly kind: RouteKind;
}

/**
 * The parsed form of a cited file: the compiler's tree, the names it
 * declares, the path constants it holds, and what each of those
 * constants' branches calls.
 *
 * The file is parsed ONCE and everything is read out of it in ONE walk.
 * The resolver asks the same file the same questions many times — once
 * per citation, once per wrapped bare word, once per route binding — and
 * walking the tree again for each of them cost the suite its timeout.
 */
interface CitedFile {
  /** Every name the file declares, mapped to what its declaration carries. */
  readonly names: ReadonlyMap<string, DeclarationFacts>;
  /** The path constants the file holds. */
  readonly paths: readonly PathConstant[];
  /** The branches that test each path constant. */
  readonly branches: ReadonlyMap<string, readonly Branch[]>;
}

const citedFiles = new Map<string, CitedFile>();

function citedFile(source: string): CitedFile {
  const cached = citedFiles.get(source);
  if (cached !== undefined) return cached;
  const tree = ts.createSourceFile(
    'cited.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Map<string, DeclarationFacts>();
  const paths: { name: string; path: string }[] = [];
  const branches = new Map<string, Branch[]>();
  const visit = (node: ts.Node): void => {
    const name = declaredName(node);
    if (name !== null && !names.has(name)) names.set(name, factsOf(node));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      if (init !== undefined && ts.isStringLiteral(init)) {
        paths.push({ name: node.name.text, path: init.text });
      }
    }
    if (ts.isIfStatement(node)) {
      // The router compares the path against a constant and calls one
      // handler: the branch is the authority on which handler serves
      // which route.
      const called = new Set<string>();
      const inner = (current: ts.Node): void => {
        if (ts.isIdentifier(current)) called.add(current.text);
        ts.forEachChild(current, inner);
      };
      inner(node.thenStatement);
      const kind: RouteKind = isPrefixTest(node.expression) ? 'prefix' : 'exact';
      for (const constant of identifierNames(node.expression)) {
        const existing = branches.get(constant);
        const branch: Branch = { calls: called, kind };
        if (existing === undefined) branches.set(constant, [branch]);
        else existing.push(branch);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const file: CitedFile = { names, paths, branches };
  citedFiles.set(source, file);
  return file;
}

/**
 * What the declaration of `symbol` in `source` carries, or null when the
 * file declares no such symbol.
 *
 * The declarations are the TypeScript compiler's own, which is what makes
 * the check exact: a definition that is commented out is not in the tree at
 * all, and a method is a declaration wherever it lives.
 */
function declarationFacts(source: string, symbol: string): DeclarationFacts | null {
  return citedFile(source).names.get(symbol) ?? null;
}

/**
 * The identifiers a node mentions.
 *
 * Read as WORDS, not as text: `pathname === SEARCH_PREFIX` names two
 * identifiers, and matching the constant's name inside a longer text would
 * confuse `UI_PATH` with `UI_JS_PATH`.
 */
function identifierNames(node: ts.Node): readonly string[] {
  const found: string[] = [];
  const walk = (current: ts.Node): void => {
    if (ts.isIdentifier(current)) found.push(current.text);
    ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
}

/**
 * True when the router's condition tests the path with `startsWith` — a
 * PREFIX route, which serves every path under the constant.
 */
function isPrefixTest(expression: ts.Expression): boolean {
  let prefix = false;
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'startsWith'
    ) {
      prefix = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(expression);
  return prefix;
}

/**
 * The branch of `constant` that serves `wanted`, or undefined when none
 * of them does.
 *
 * A branch that compares the path with `===` serves that path and no
 * other; a branch that compares it with `startsWith` serves every path
 * under the constant.
 */
function servingBranch(
  branches: readonly Branch[],
  path: string,
  wanted: string,
): Branch | undefined {
  return branches.find((branch) =>
    branch.kind === 'prefix' ? wanted.startsWith(path) : wanted === path,
  );
}

/**
 * True when the router's branch for `constant` calls `symbol` on the
 * route `wanted`.
 *
 * The router is the authority on which handler serves which route: it
 * compares the path against a constant and calls one handler. A citation
 * inside a path item claims a handler for that route, so the claim is
 * checked against the router's own branch — which is what makes a citation
 * repointed at another route's handler fail.
 */
function branchCalls(
  source: string,
  constant: PathConstant,
  wanted: string,
  symbol: string,
): boolean {
  const branches = citedFile(source).branches.get(constant.name) ?? [];
  return servingBranch(branches, constant.path, wanted)?.calls.has(symbol) ?? false;
}

/** The repository root — a cited path may not leave it. */
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * The absolute path of a cited file, or null when it resolves outside the
 * repository: the path is read out of a document, and a document must not be
 * able to point the suite at the rest of the filesystem.
 */
function citedFilePath(file: string): string | null {
  const resolved = resolve(REPO_ROOT, file);
  if (resolved !== REPO_ROOT && !resolved.startsWith(`${REPO_ROOT}${sep}`)) return null;
  return resolved;
}

/**
 * The source of a cited file, cached by its path.
 *
 * The resolver reads the same cited file once per citation and once per
 * wrapped bare word; reading it from disk each time was pure overhead.
 */
const sourceCache = new Map<string, string>();

/**
 * How many times each file was read from disk. The cache pin reads this
 * counter: a cited file must be read ONCE, however many citations name it.
 */
const readCounts = new Map<string, number>();

function citedSource(file: string): string | null {
  const path = citedFilePath(file);
  if (path === null) return null;
  const cached = sourceCache.get(path);
  if (cached !== undefined) return cached;
  if (!existsSync(path)) return null;
  const source = readFileSync(path, 'utf8');
  sourceCache.set(path, source);
  readCounts.set(path, (readCounts.get(path) ?? 0) + 1);
  return source;
}

/**
 * True when a declaration carries the construct a citation claims.
 *
 * The construct's SHAPE says where it is looked for: a dotted name is a
 * property access (`service.search`), a comparison is a comparison
 * (`pathname ===`), and a plain word is an identifier or a literal
 * (`retry-after`, `sha256`). The three kinds do not overlap, so a string
 * literal that happens to read `service.search` cannot stand in for the
 * call, and a comment that names the construct is not a node at all.
 */
function carriesConstruct(facts: DeclarationFacts, construct: string): boolean {
  if (construct.includes(' ')) return facts.comparisons.has(construct);
  if (construct.includes('.')) return facts.properties.has(construct);
  return facts.words.has(construct);
}

/**
 * The violation message for one cited symbol in a file's SOURCE, or null
 * when it checks out.
 *
 * The source is a parameter so the check can be pinned against a fixture:
 * a guard that can only be exercised through the repository's own files
 * cannot be shown to fail when it is removed.
 */
function checkDeclaration(
  where: string,
  file: string,
  source: string,
  symbol: string,
): string | null {
  const facts = declarationFacts(source, symbol);
  if (facts === null) return `${where} — ${file} declares no symbol named ${symbol}`;
  const expected = expectedConstructs(file, symbol);
  if (!expected.some((construct) => carriesConstruct(facts, construct))) {
    return `${where} — ${symbol} carries none of ${expected.join(', ')}`;
  }
  return null;
}

/**
 * The violation message for one cited symbol that documents no route, or
 * null when it checks out.
 *
 * A citation that names a symbol and no route is checked against the
 * declaration alone: the router's dispatch is not a claim such a citation
 * makes.
 */
function checkCitation(
  where: string,
  file: string,
  symbol: string,
  source?: string,
): string | null {
  return checkCitedSymbol(where, file, symbol, null, source);
}

/**
 * The router's path constant that serves `wanted`, or undefined when the
 * router holds none.
 *
 * The router's own dispatch is the authority: a constant compared with
 * `===` serves that path and no other, and a constant compared with
 * `startsWith` serves every path under it. The longest serving constant
 * wins.
 */
function pathConstantFor(source: string, wanted: string): PathConstant | undefined {
  const file = citedFile(source);
  let best: PathConstant | undefined;
  for (const entry of file.paths) {
    const branches = file.branches.get(entry.name) ?? [];
    // A constant no branch tests serves its own path only — the router
    // holds it, so the citation can be checked against it.
    const served =
      branches.length === 0
        ? entry.path === wanted
        : servingBranch(branches, entry.path, wanted) !== undefined;
    if (!served) continue;
    if (best === undefined || entry.path.length > best.path.length) best = entry;
  }
  return best;
}

/**
 * The violation message for a citation that names a handler the route it
 * documents does not call, or null when the route does call it.
 */
function checkRouteBinding(
  where: string,
  source: string,
  path: string,
  symbol: string,
): string | null {
  // `dispatch` IS the router: every route is served by it.
  if (symbol === 'dispatch') return null;
  const wanted = path.replace(/\{[^}]*\}/g, '');
  const constant = pathConstantFor(source, wanted);
  if (constant === undefined) {
    // The router holds no constant for this path, so the claim cannot be
    // checked — and a check that cannot be run must say so, not pass.
    return `${where} — the router has no path constant for ${path}, so the citation cannot be checked`;
  }
  if (branchCalls(source, constant, wanted, symbol)) return null;
  return `${where} — ${path} is served by the router, not by ${symbol}`;
}

/**
 * The offsets the YAML block scalars occupy — the strings, not the
 * comments.
 *
 * A `#` line is a COMMENT only outside a block scalar; inside one it is
 * part of a string. The citation scan has to know the difference: prose
 * that happens to start with `# source:` must not be read as a citation, and
 * the inline anchors in the descriptions must be found even though they sit
 * inside strings.
 */
function blockScalarRanges(specText: string): readonly (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  visit(parseDocument(specText), {
    Scalar(_key, node) {
      const type = node.type;
      if (type !== 'BLOCK_LITERAL' && type !== 'BLOCK_FOLDED') return;
      const range = node.range;
      if (range === undefined || range === null) return;
      ranges.push([range[0], range[1]]);
    },
  });
  return ranges;
}

/** True when `offset` falls inside one of the ranges. */
function insideRanges(ranges: readonly (readonly [number, number])[], offset: number): boolean {
  return ranges.some(([start, end]) => offset >= start && offset <= end);
}

/** The offset each line of the text starts at. */
function lineOffsets(text: string): readonly number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    offsets.push(at);
    at += line.length + 1;
  }
  return offsets;
}

/**
 * What a citation documents: a ROUTE, a shared construct, or a path the
 * document does not name.
 *
 * A citation that documents a route makes a claim about the router's
 * dispatch, and the claim is checked. A citation that documents a
 * construct makes no such claim, and none is asked of it. A citation in
 * the paths mapping with no path item above it claims a route the
 * document does not name, and that claim cannot be checked at all.
 */
type DocumentedPath =
  | { readonly kind: 'route'; readonly path: string }
  | { readonly kind: 'construct' }
  | { readonly kind: 'unknown' };

/**
 * The path a citation documents.
 *
 * A citation sits inside the path item it documents — between the path key
 * and its first operation — so the path is the nearest path key above it.
 * The walk stops at the first key at indent two or less: `responses:` and
 * `schemas:` are such keys, and a citation under one of them documents a
 * construct, not a route.
 *
 * A path key may carry a comment of its own, and the comment does not make
 * it a different key: the key is still the key the citation sits under.
 * A key that carries a VALUE is not a path key, and the walk steps over it.
 */
function documentedPath(lines: readonly string[], citationLine: number): DocumentedPath {
  for (let at = citationLine - 1; at >= 0; at -= 1) {
    const line = lines[at] ?? '';
    const key = KEY_RE.exec(line);
    if (key === null) continue;
    // What follows the colon decides what the line is: nothing, or a
    // comment — the key is still the key — or a value, which makes the
    // line a mapping entry and not a key.
    const after = line.slice(key[0].length);
    if (after.trim() !== '' && !/^\s+#/.test(after)) continue;
    if ((key[1] ?? '').length > 2) continue;
    const name = (key[2] ?? '').trim();
    if (name.startsWith('/')) return { kind: 'route', path: name };
    // The paths mapping holds the routes, so a citation inside it that has
    // no path key above it documents a route the document does not name.
    if (name === 'paths') return { kind: 'unknown' };
    return { kind: 'construct' };
  }
  return { kind: 'construct' };
}

/** A citation in the document: the line it is on, its tail, and the route it documents. */
interface Citation {
  readonly line: number;
  readonly tail: string;
  /** The path the citation documents, or null for a shared construct. */
  readonly path: string | null;
  /** True when the document does not say which path the citation documents. */
  readonly pathUnknown: boolean;
}

/**
 * The `# source:` citations in the document.
 *
 * A citation is a YAML COMMENT, and a `#` line inside a block scalar is part
 * of a string instead — so a line of prose that happens to start with
 * `# source:` is not a citation and is not counted as one.
 */
function citationsIn(specText: string): readonly Citation[] {
  const blocks = blockScalarRanges(specText);
  const offsets = lineOffsets(specText);
  const lines = specText.split('\n');
  const citations: Citation[] = [];
  for (const [index, line] of lines.entries()) {
    const offset = offsets[index] ?? 0;
    if (insideRanges(blocks, offset)) continue;
    const match = CITATION_RE.exec(line);
    if (match === null) continue;
    const documented = documentedPath(lines, index);
    citations.push({
      line: index + 1,
      tail: match[1] ?? '',
      path: documented.kind === 'route' ? documented.path : null,
      pathUnknown: documented.kind === 'unknown',
    });
  }
  return citations;
}

/**
 * The index at which the line's YAML comment starts, or -1 when the line
 * carries no comment.
 *
 * A `#` inside a quoted scalar is part of the string, not a comment, so the
 * quotes are read before the comment is looked for: a value that quotes the
 * marker must not be read as a marker.
 */
function commentStart(line: string): number {
  let quote: string | null = null;
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at] ?? '';
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (at === 0 || /\s/.test(line[at - 1] ?? ''))) return at;
  }
  return -1;
}

/** A `# source:` marker the citation parser cannot read. */
interface MalformedCitation {
  /** The line the marker is on. */
  readonly line: number;
  /** Why the parser cannot read it. */
  readonly reason: string;
}

/**
 * The `# source:` markers the citation parser cannot read.
 *
 * A citation is a comment that STARTS the line, so a marker written
 * anywhere else — at the end of a line of YAML, or after another note in
 * the same comment — is not a citation. It was not read as one, and it
 * was not reported either: a contributor who wrote it got no check and no
 * signal that the check was missing. A marker the parser cannot read is
 * reported instead of ignored.
 */
function malformedCitationsIn(specText: string): readonly MalformedCitation[] {
  const blocks = blockScalarRanges(specText);
  const offsets = lineOffsets(specText);
  const malformed: MalformedCitation[] = [];
  for (const [index, line] of specText.split('\n').entries()) {
    const offset = offsets[index] ?? 0;
    if (insideRanges(blocks, offset)) continue;
    // A citation is read elsewhere; only a marker that is NOT one is left.
    if (CITATION_RE.test(line)) continue;
    const start = commentStart(line);
    if (start === -1) continue;
    if (!MARKER_RE.test(line.slice(start))) continue;
    malformed.push({
      line: index + 1,
      reason: 'the `# source:` marker must start the comment, so the citation cannot be read',
    });
  }
  return malformed;
}

/** An inline `file#symbol` anchor in the document's prose. */
interface InlineAnchor {
  readonly line: number;
  readonly file: string;
  readonly symbol: string;
}

/**
 * The inline `file#symbol` anchors in the document.
 *
 * The response descriptions name the symbol they come from in prose, and
 * those names were unchecked: renaming `sendJson` left eight stale
 * provenance claims in the document and the suite green. The anchors are
 * found in the document's CONTENT — a YAML comment is the `# source:`
 * channel and is not scanned, so the convention note's own placeholder is
 * never mistaken for an anchor.
 */
function inlineAnchorsIn(specText: string): readonly InlineAnchor[] {
  const blocks = blockScalarRanges(specText);
  const offsets = lineOffsets(specText);
  const anchors: InlineAnchor[] = [];
  for (const [index, line] of specText.split('\n').entries()) {
    const offset = offsets[index] ?? 0;
    const isComment = !insideRanges(blocks, offset) && line.trimStart().startsWith('#');
    if (isComment) continue;
    for (const match of line.matchAll(INLINE_ANCHOR_RE)) {
      anchors.push({ line: index + 1, file: match[1] ?? '', symbol: match[2] ?? '' });
    }
  }
  return anchors;
}

describe('OpenAPI source citations (docs/openapi.yaml # source: lines)', () => {
  it('every cited symbol exists in the cited file and carries its construct', () => {
    // The citations name a SYMBOL, not a line. A line anchor made this
    // suite a tripwire on every insertion above the router: the cited line
    // moved, the suite failed, and the failure pointed at the router rather
    // than at the doc that had to change with it. A symbol is stable — the
    // router can grow a hundred lines and `#dispatch` still names the same
    // function — and the claim the citation makes is the one the check now
    // makes: that the symbol exists, in real code, and still does what the
    // citation says it does.
    const specText = readFileSync(SPEC_PATH, 'utf8');
    const scan = scanDocumentCitations(specText);
    expect(scan.citations, 'docs/openapi.yaml must contain # source: citations').toBeGreaterThan(0);
    expect(scan.violations, 'drifted # source: citations in docs/openapi.yaml').toEqual([]);
  }, 30_000);

  it('every inline anchor in the document names a symbol that exists', () => {
    // The response descriptions name the symbol they come from in prose,
    // and those names were unchecked: renaming `sendJson` left eight stale
    // provenance claims in the document and the suite green. The anchors are
    // found in the document's CONTENT — a YAML comment is the `# source:`
    // channel and is not scanned, so the convention note's own placeholder
    // is never mistaken for an anchor.
    const specText = readFileSync(SPEC_PATH, 'utf8');
    const violations: string[] = [];
    const anchors = inlineAnchorsIn(specText);
    for (const anchor of anchors) {
      const where = `docs/openapi.yaml:${anchor.line} cites ${anchor.file}#${anchor.symbol}`;
      // An anchor whose file part does not resolve inside the repository
      // is a LINK, not a citation, and must not fail the gate.
      if (!anchorIsCitation(anchor.file)) continue;
      const violation = checkCitation(where, anchor.file, anchor.symbol);
      if (violation !== null) violations.push(violation);
    }
    expect(anchors.length, 'docs/openapi.yaml must contain inline #symbol anchors').toBeGreaterThan(
      0,
    );
    expect(violations, 'drifted inline anchors in docs/openapi.yaml').toEqual([]);
  });

  it('reads a # source: line inside a block scalar as prose, not as a citation', () => {
    // A block scalar's body is a STRING: a `#` line inside one is part of
    // the text, not a comment. Read as a citation it would either be
    // silently unchecked or fail the suite for no reason at all — and the
    // two outcomes must not depend on whether the symbol it names happens
    // to exist.
    const spec = [
      'info:',
      '  description: |',
      '    # source: src/titan/http-server.ts#notacitation',
      'paths:',
      '  /x:',
      '    # source: src/titan/http-server.ts#dispatch',
      '    get:',
      '      description: x',
      '',
    ].join('\n');
    const citations = citationsIn(spec);
    expect(citations.map((citation) => citation.tail)).toEqual([
      'src/titan/http-server.ts#dispatch',
    ]);
    // A citation inside a path item documents that path.
    expect(citations[0]?.path).toBe('/x');
  });

  it('counts the inline anchors in the document content only', () => {
    // The convention note quotes a placeholder anchor in a COMMENT. A
    // comment is the `# source:` channel and is not scanned, so the
    // placeholder is never mistaken for a claim about the code — while the
    // same anchor written in the prose IS a claim, and is checked.
    const spec = [
      '# a note quoting src/titan/http-server.ts#symbol',
      'info:',
      '  description: |',
      '    served by src/titan/http-server.ts#sendJson',
      '',
    ].join('\n');
    expect(inlineAnchorsIn(spec).map((anchor) => anchor.symbol)).toEqual(['sendJson']);
    // An INDENTED comment is a comment too: the comment channel is the
    // `# source:` channel, whatever the comment's indent, so an anchor
    // quoted in an indented comment is not a claim about the code.
    const indented = [
      'paths:',
      '  /x:',
      '    # a note quoting src/titan/http-server.ts#symbol',
      '',
    ].join('\n');
    expect(inlineAnchorsIn(indented)).toEqual([]);
  });

  it('refuses a citation that names no symbol at all', () => {
    // A citation that cannot be parsed checks out nothing, so the parser
    // must report it rather than skip it.
    expect(citedSymbols('src/titan/http-server.ts').map((cited) => cited.wellFormed)).toEqual([
      false,
    ]);
    expect(citedSymbols('src/titan/http-server.ts#dispatch').map((c) => c.wellFormed)).toEqual([
      true,
    ]);
    // A prose word in a parenthetical is prose, not a symbol.
    expect(citedSymbols('src/titan/http-server.ts#dispatch (the router)')).toHaveLength(1);
    // A bare symbol inherits the file of the pair before it.
    expect(citedSymbols('src/titan/http-server.ts#dispatch, handleSearch')).toEqual([
      { file: 'src/titan/http-server.ts', symbol: 'dispatch', wellFormed: true },
      { file: 'src/titan/http-server.ts', symbol: 'handleSearch', wellFormed: true },
    ]);
    // A citation wrapped in parentheses is a citation, not prose: it is
    // unwrapped and checked, never dropped.
    expect(citedSymbols('(src/titan/http-server.ts#dispatch)')).toEqual([
      { file: 'src/titan/http-server.ts', symbol: 'dispatch', wellFormed: true },
    ]);
    // A parenthetical that names no symbol stays prose.
    expect(citedSymbols('src/titan/http-server.ts#dispatch, (the router)')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — the citation resolver's GUARDS, pinned.
//
// Every guard of the resolver above that DECIDES A VERDICT is pinned by a
// fixture below: break the guard on purpose and the suite goes red. A
// guard that nothing pins is a comment, not a check, and a comment does
// not stop a citation from drifting.
//
// The claim was checked by MUTATION, not by reading: the resolver's guards
// were broken on purpose, one at a time — a hundred and two mutations —
// and the suite was seen to go red, with four exceptions.
//
// A later sweep of the same guards found SEVEN survivors, not four: the
// four above, and three more that DO decide a verdict and are therefore
// load-bearing. Those three are pinned now, so the claim above holds
// again. All seven are named here with the others, so that the list
// matches the sweep that found them:
//
//   1. `citedSymbols` skips an empty segment that `readSegment` skips
//      anyway — decides nothing;
//   2. `citedSymbols` trims the segment it reads — decides nothing;
//   3. the defaults the parsers never produce — an operator token, a
//      match group, a line offset, a pending segment — cannot fire, so
//      the `??` around them, and the guard on the operator token, decide
//      nothing;
//   4. `citedFilePath` resolves a cited path against the REPOSITORY ROOT,
//      and the suite always runs from the repository root, so resolving
//      it against the working directory instead would decide nothing here
//      either;
//   5. `carriesConstruct`'s COMPARISON branch — a construct with a space
//      in it is looked for among the declaration's comparisons — decides
//      a verdict, and is pinned now;
//   6. `commentStart`'s QUOTE-CLOSE rule — a `#` inside a quoted scalar
//      belongs to the scalar — decides a verdict, and is pinned now;
//   7. `commentStart`'s WHITESPACE rule — a `#` opens a comment only when
//      whitespace precedes it — decides a verdict, and is pinned now.
//
// A further guard decides no verdict and was not among the mutations:
// `blockScalarRanges` guards a range the YAML parser always sets.
//
// A second sweep re-ran the guards this round touched — the four
// survivors above, the citation marker, the path attribution and the
// scans that use them — and broke the four guards this round added:
// twenty-nine mutations, twenty-five CAUGHT, and the same four
// SURVIVED. The one that was caught by nothing before it — a comment
// line read as a path key — is pinned now.
//
// The sweep also broke each entry of the general construct list, each
// extension of the anchor pattern, and the values the rules compare (the
// tie-break of the serving constant, the indent of the path level, the
// bounds of a block scalar).
//
// Each pin below is driven by a FIXTURE, so it says something about the
// GUARD rather than about the repository's current contents. Four pins
// read the repository's own files on purpose — the boundary, the missing
// file, the anchor's file part and the read cache — and each names the
// files it reads. Every pin was mutation-checked — the guard was broken
// on purpose, the pin was seen to fail, and the guard was put back.
// ---------------------------------------------------------------------------

/**
 * A router fixture: the path constants, the dispatch branches that compare
 * the path against them, and the handlers those branches call — each
 * handler carrying the construct the router's contract claims for it.
 */
const ROUTER_FIXTURE = [
  "const SEARCH_PATH = '/api/v1/search';",
  "const SECTION_PATH = '/api/v1/section';",
  '',
  'function handleSearch(): void {',
  '  service.search({});',
  '}',
  '',
  'function handleSection(): void {',
  '  service.getSection("");',
  '}',
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname === SEARCH_PATH) {',
  '    handleSearch();',
  '  }',
  '  if (pathname === SECTION_PATH) {',
  '    handleSection();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A source fixture whose definition of `handleSearch` is COMMENTED OUT, next
 * to a symbol that is really there.
 */
const COMMENTED_FIXTURE = [
  '// function handleSearch(query: string): string {',
  '//   return service.search(query);',
  '// }',
  '',
  'function handleOther(query: string): string {',
  '  sendJson();',
  '}',
  '',
].join('\n');

/**
 * A source fixture that declares a method in every place a method can live:
 * a class body, an object literal, an interface, a type literal, an enum —
 * and a member in every form a member can take: a method, a property, an
 * assignment, an accessor.
 */
const MEMBER_FIXTURE = [
  'class Router {',
  '  handleClass(): string {',
  '    return "class";',
  '  }',
  '  handleProperty: string = "property";',
  '  get handleGetter(): string {',
  '    return "getter";',
  '  }',
  '  set handleSetter(value: string) {',
  '    void value;',
  '  }',
  '}',
  '',
  'const literal = {',
  '  handleObject(): string {',
  '    return "object";',
  '  }',
  '  handleAssignment: "assigned",',
  '};',
  '',
  'interface Api {',
  '  handleInterface(): string;',
  '}',
  '',
  'type Handlers = {',
  '  handleType(): string;',
  '};',
  '',
  'enum Modes {',
  '  handleEnum,',
  '}',
  '',
].join('\n');

/**
 * A source fixture that declares a symbol in every form a declaration can
 * take: a `const`, a function, a class, an interface, a type alias, an enum.
 */
const DECLARATION_FIXTURE = [
  'const handleConst = "const";',
  'function handleFunction(): void {}',
  'class HandleClass {}',
  'interface HandleInterface {}',
  'type HandleType = string;',
  'enum HandleEnum { First }',
  '',
].join('\n');

/**
 * A source fixture that declares the SAME name twice: the first carries the
 * construct the router's contract claims for it, the second does not.
 */
const DUPLICATE_FIXTURE = [
  'function handleSearch(): void {',
  '  service.search({});',
  '}',
  '',
  'function handleSearch(): void {',
  '  service.query({});',
  '}',
  '',
].join('\n');

/**
 * A source fixture whose `handleSearch` MENTIONS `service.search` in a
 * comment and calls something else.
 */
const COMMENT_CONSTRUCT_FIXTURE = [
  'function handleSearch(): void {',
  '  // service.search is what this handler does.',
  '  service.query({});',
  '}',
  '',
].join('\n');

/**
 * A source fixture whose `handleSearch` READS `service.search` as a string
 * and calls something else.
 */
const STRING_CONSTRUCT_FIXTURE = [
  'function handleSearch(): void {',
  '  const note = "service.search";',
  '  void note;',
  '}',
  '',
].join('\n');

/**
 * A source fixture whose `handleSearch` really CALLS `service.search`.
 */
const CALLED_CONSTRUCT_FIXTURE = [
  'function handleSearch(): void {',
  '  service.search({});',
  '}',
  '',
].join('\n');

/**
 * A source fixture that carries nothing of the general list but `res.end`.
 */
const RES_END_FIXTURE = [
  'function handleOther(res: { end: () => void }): void {',
  '  res.end();',
  '}',
  '',
].join('\n');

/**
 * A router fixture whose constant is a PREFIX of the route it serves.
 */
const PREFIX_ROUTER_FIXTURE = [
  "const FOO_PATH = '/api/v1/foo';",
  '',
  'function handleFoo(): void {',
  '  service.search({});',
  '}',
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname.startsWith(FOO_PATH)) {',
  '    handleFoo();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A router fixture whose constant is the ROOT path — which serves the root,
 * not every route.
 */
const ROOT_ROUTER_FIXTURE = [
  "const UI_PATH = '/';",
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname === UI_PATH) {',
  '    handleUi();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A router fixture whose constant NO branch tests.
 */
const UNTESTED_ROUTER_FIXTURE = [
  "const ORPHAN_PATH = '/api/v1/orphan';",
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname === "/api/v1/other") {',
  '    handleOther();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A source fixture whose `handleSearch` carries `sendJson` — a construct of
 * the GENERAL list, and not of the router's own list for that symbol.
 */
const SAME_NAME_FIXTURE = ['function handleSearch(): void {', '  sendJson();', '}', ''].join('\n');

/**
 * A source fixture that declares a symbol and holds NO path constant:
 * a file that is not the router has no routes to bind a citation to.
 */
const NO_ROUTES_FIXTURE = [
  'export function handleSearch(): string {',
  '  return "search";',
  '}',
  '',
].join('\n');

/**
 * A source fixture whose `precheck` carries the PLAIN WORD the router's
 * contract claims for it (`retry-after`), and whose `etagFor` carries
 * none of the constructs at all.
 */
const PLAIN_WORD_FIXTURE = [
  'function precheck(): void {',
  '  res.setHeader("retry-after", "1");',
  '}',
  '',
  'function etagFor(): void {',
  '  void 0;',
  '}',
  '',
].join('\n');

/**
 * A router fixture in which MORE THAN ONE constant serves the same route:
 * a short prefix, and two constants of the same length — the exact route
 * and an alias of it.
 */
const OVERLAPPING_ROUTER_FIXTURE = [
  "const API_PREFIX = '/api/v1';",
  "const SEARCH_PATH = '/api/v1/search';",
  "const SEARCH_ALIAS = '/api/v1/search';",
  '',
  'function handleApi(): void {',
  '  service.browse({});',
  '}',
  '',
  'function handleSearch(): void {',
  '  service.search({});',
  '}',
  '',
  'function handleAlias(): void {',
  '  service.getSection("");',
  '}',
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname.startsWith(API_PREFIX)) {',
  '    handleApi();',
  '  }',
  '  if (pathname === SEARCH_PATH) {',
  '    handleSearch();',
  '  }',
  '  if (pathname === SEARCH_ALIAS) {',
  '    handleAlias();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A router fixture whose path constant holds the CONCRETE path the
 * document documents as a template.
 */
const CONCRETE_ROUTER_FIXTURE = [
  "const SECTION_PATH = '/api/v1/sections/';",
  '',
  'function handleSection(): void {',
  '  service.getSection("");',
  '}',
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname === SECTION_PATH) {',
  '    handleSection();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A router fixture whose path constant holds the TEMPLATE itself and is
 * compared exactly.
 */
const TEMPLATE_ROUTER_FIXTURE = [
  "const SECTION_PATH = '/api/v1/sections/{citation}';",
  '',
  'function handleSection(): void {',
  '  service.getSection("");',
  '}',
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname === SECTION_PATH) {',
  '    handleSection();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A source fixture per entry of the general construct list, each carrying
 * that entry and NOTHING ELSE of the list — so dropping any one entry from
 * the list turns the pin red.
 *
 * The map is typed by the list itself: an entry added to the list without
 * a fixture here is a TYPE ERROR, not a silent gap.
 */
const GENERAL_CONSTRUCT_FIXTURES: Readonly<Record<(typeof GENERAL_CONSTRUCTS)[number], string>> = {
  'pathname ===': [
    'function handleOther(pathname: string): void {',
    "  if (pathname === '/api/v1/other') {",
    '    void 0;',
    '  }',
    '}',
    '',
  ].join('\n'),
  sendJson: ['function handleOther(): void {', '  sendJson();', '}', ''].join('\n'),
  sendText: ['function handleOther(): void {', '  sendText();', '}', ''].join('\n'),
  errorBody: ['function handleOther(): void {', '  errorBody();', '}', ''].join('\n'),
  setHeader: ['function handleOther(): void {', "  setHeader('x', 'y');", '}', ''].join('\n'),
  'res.end': RES_END_FIXTURE,
  'res.statusCode': [
    'function handleOther(res: { statusCode: number }): void {',
    '  void res.statusCode;',
    '}',
    '',
  ].join('\n'),
  invalid_input: [
    'function handleOther(): void {',
    '  const code = "invalid_input";',
    '  void code;',
    '}',
    '',
  ].join('\n'),
  not_found: [
    'function handleOther(): void {',
    '  const code = "not_found";',
    '  void code;',
    '}',
    '',
  ].join('\n'),
  method_not_allowed: [
    'function handleOther(): void {',
    '  const code = "method_not_allowed";',
    '  void code;',
    '}',
    '',
  ].join('\n'),
  uri_too_long: [
    'function handleOther(): void {',
    '  const code = "uri_too_long";',
    '  void code;',
    '}',
    '',
  ].join('\n'),
  rate_limited: [
    'function handleOther(): void {',
    '  const code = "rate_limited";',
    '  void code;',
    '}',
    '',
  ].join('\n'),
  internal_error: [
    'function handleOther(): void {',
    '  const code = "internal_error";',
    '  void code;',
    '}',
    '',
  ].join('\n'),
};

/**
 * The general construct fixtures, as entries.
 *
 * The entries are read out of the MAP, not out of the list: a construct
 * dropped from the list leaves its fixture behind, and a pin that walked
 * the list would never look at it — the entry would simply stop being
 * exercised. The map's own type says the other way round: an entry ADDED
 * to the list without a fixture does not compile.
 */
const GENERAL_CONSTRUCT_ENTRIES: readonly (readonly [string, string])[] = Object.entries(
  GENERAL_CONSTRUCT_FIXTURES,
);

/**
 * Every extension the inline-anchor pattern reads as a source module.
 *
 * The list is written out here, and not read out of the pattern, so that
 * dropping an extension from the pattern turns the pin red.
 */
const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'] as const;

/**
 * A source fixture whose comparison's left side is NOT an identifier.
 */
const COMPARISON_FIXTURE = [
  'function handleOther(res: { statusCode: number }): void {',
  '  if (res.statusCode === 200) {',
  '    void 0;',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A source fixture whose comparison's left side is an identifier written
 * with an ESCAPE: the name is what the code means, and the spelling is
 * only how it is written down.
 */
const ESCAPED_COMPARISON_FIXTURE = [
  'function handleOther(\\u0070athname: string): void {',
  '  if (\\u0070athname === "/api/v1/other") {',
  '    void 0;',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A source fixture with a declaration that has NO NAME: a default export.
 */
const UNNAMED_FIXTURE = ['export default function () {}', ''].join('\n');

/**
 * A source fixture whose declaration is a DESTRUCTURING: it has no name
 * to be named by.
 */
const DESTRUCTURED_FIXTURE = ["const { a } = '/api/v1/x';", ''].join('\n');

/**
 * A source fixture whose named declaration holds a NUMBER: a path constant
 * holds a STRING, so a number is not a path.
 */
const NON_STRING_FIXTURE = ['const SEARCH_PATH = 42;', ''].join('\n');

/**
 * A router fixture that tests the SAME constant twice: an exact route and
 * a prefix route under it.
 */
const SECOND_BRANCH_ROUTER_FIXTURE = [
  "const X_PATH = '/api/v1/x';",
  '',
  'function handleFirst(): void {',
  '  service.browse({});',
  '}',
  '',
  'function handleSecond(): void {',
  '  service.search({});',
  '}',
  '',
  'function dispatch(pathname: string): void {',
  '  if (pathname === X_PATH) {',
  '    handleFirst();',
  '  }',
  '  if (pathname.startsWith(X_PATH)) {',
  '    handleSecond();',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A router fixture whose `dispatch` compares the path against NOTHING: the
 * comparison the router's contract claims for it is missing.
 */
const NO_COMPARISON_ROUTER_FIXTURE = [
  'function dispatch(pathname: string): void {',
  '  handleSearch();',
  '}',
  '',
].join('\n');

/**
 * A document fixture whose quoted value is CLOSED and followed by a real
 * comment: the comment after a quoted value is a comment.
 */
const QUOTED_VALUE_THEN_COMMENT = [
  'info:',
  '  description: "x" # source: src/titan/http-server.ts#handleSearch',
  '',
].join('\n');

/**
 * A document fixture whose plain value carries a `#` with no space before
 * it: the `#` is part of the value, not the start of a comment.
 */
const PLAIN_VALUE_WITH_HASH = [
  'info:',
  '  description: x# source: src/titan/http-server.ts#handleSearch',
  '',
].join('\n');

/**
 * The facts a fixture's symbol carries, or a failure when the fixture does
 * not declare it: a pin must not read a different fixture than the one it
 * names.
 */
function factsOfSymbol(source: string, symbol: string): DeclarationFacts {
  const facts = declarationFacts(source, symbol);
  if (facts === null) throw new Error(`the fixture must declare ${symbol}`);
  return facts;
}

describe('OpenAPI citation resolver: guards pinned against fixtures', () => {
  it("pins the route binding: a citation naming another route's handler is a violation", () => {
    // The router is the authority on which handler serves which route: it
    // compares the path against a constant and calls one handler. A citation
    // inside a path item claims a handler for that route, so a citation
    // repointed at the handler of another route must be reported — and the
    // claim that DOES match must still pass, or the pin would be satisfied
    // by a check that always complains.
    expect(checkRouteBinding('w', ROUTER_FIXTURE, '/api/v1/search', 'handleSearch')).toBeNull();
    const violation = checkRouteBinding('w', ROUTER_FIXTURE, '/api/v1/section', 'handleSearch');
    expect(violation).not.toBeNull();
    expect(violation).toContain('/api/v1/section');
    expect(violation).toContain('handleSearch');
    // `dispatch` IS the router: every route is served by it, so the binding
    // is not asked of it.
    expect(checkRouteBinding('w', ROUTER_FIXTURE, '/api/v1/search', 'dispatch')).toBeNull();
    // The branch's CALLS are the identifiers of its BODY, not of its
    // condition: a symbol the condition merely names is not the handler
    // the route calls. The dispatch compares the path against a constant,
    // so its condition names `pathname` and `SEARCH_PATH` — and neither
    // of them is the handler that serves the route.
    expect(checkRouteBinding('w', ROUTER_FIXTURE, '/api/v1/search', 'pathname')).not.toBeNull();
    expect(checkRouteBinding('w', ROUTER_FIXTURE, '/api/v1/search', 'SEARCH_PATH')).not.toBeNull();
  });

  it('pins the route binding through the citation check: the document reaches it', () => {
    // The route binding is reached THROUGH the citation check — the entry
    // point every citation in the document goes through — so the pin has
    // to drive THAT entry point. A guard that is only exercised directly
    // can be disconnected from the document and the suite stays green: the
    // per-symbol construct list is satisfied by every handler of the
    // router, so with the wiring gone a repointed citation is invisible.
    const violation = checkCitedSymbol(
      'w',
      ROUTER_FILE,
      'handleSearch',
      '/api/v1/section',
      ROUTER_FIXTURE,
    );
    expect(violation).not.toBeNull();
    expect(violation).toContain('/api/v1/section');
    expect(violation).toContain('handleSearch');
    // And the citation that DOES match must still pass, or the pin would
    // be satisfied by a check that always complains.
    expect(
      checkCitedSymbol('w', ROUTER_FILE, 'handleSearch', '/api/v1/search', ROUTER_FIXTURE),
    ).toBeNull();
  });

  it('pins the declaration through the citation check: the document reaches it', () => {
    // The DECLARATION is checked at the document's call site: a symbol the
    // cited file does not declare is reported THROUGH the citation check,
    // so the wiring that asks for it cannot be dropped without the suite
    // going red.
    //
    // The route-binding pin above cannot see this: every handler of the
    // router carries the construct the citation claims for it, so with the
    // declaration check removed that pin still passes — the whole
    // symbol-existence half of the rule would be a comment.
    expect(checkCitedSymbol('w', ROUTER_FILE, 'ghost', null, COMMENTED_FIXTURE)).toContain(
      'declares no symbol named ghost',
    );
    // And a symbol that IS declared but does not carry the construct the
    // router's contract claims for it is reported through the same path.
    expect(checkCitedSymbol('w', ROUTER_FILE, 'handleSearch', null, SAME_NAME_FIXTURE)).toContain(
      'carries none of service.search',
    );
    // The claim that DOES check out must still pass, or the pin would be
    // satisfied by a check that always complains.
    expect(checkCitedSymbol('w', ROUTER_FILE, 'handleSearch', null, CALLED_CONSTRUCT_FIXTURE)).toBe(
      null,
    );
  });

  it('pins the document route binding: a path item citation names the route handler', () => {
    // A citation inside a path item claims a handler for THAT route, so a
    // citation repointed at another route's handler must be reported. The
    // pin drives the DOCUMENT'S scan — the same function the shipped
    // document goes through — so the call site that hands the route along
    // is pinned too, not only the resolver behind it.
    const spec = [
      'paths:',
      '  /api/v1/sections/{citation}:',
      '    # source: src/titan/http-server.ts#handleSearch',
      '',
    ].join('\n');
    const scan = scanDocumentCitations(spec, 'fixture.yaml');
    expect(scan.citations).toBe(1);
    expect(scan.violations).toHaveLength(1);
    expect(scan.violations[0]).toContain('is served by the router, not by handleSearch');
    // The violation names the line the citation is ON: the citation sits
    // on the third line of the fixture, and a line number off by one
    // would point the reader at the wrong line.
    expect(scan.violations[0]).toContain('fixture.yaml:3');
    // The citation that DOES name the route's handler passes.
    const bound = [
      'paths:',
      '  /api/v1/sections/{citation}:',
      '    # source: src/titan/http-server.ts#handleSection',
      '',
    ].join('\n');
    expect(scanDocumentCitations(bound, 'fixture.yaml').violations).toEqual([]);
    // And a citation that names no symbol at all is a violation, and it
    // is reported as one.
    const malformed = ['paths:', '  /x:', '    # source: src/titan/http-server.ts', ''].join('\n');
    const unparsable = scanDocumentCitations(malformed, 'fixture.yaml');
    expect(unparsable.violations).toHaveLength(1);
    expect(unparsable.violations[0]).toContain('not a symbol reference');
  });

  it('pins the repository boundary: a cited path outside the repository is refused', () => {
    // A cited path is read out of a document, so a document must not be able
    // to point the suite at the rest of the filesystem: a path that leaves
    // the repository resolves to nothing, and the citation says so.
    expect(citedFilePath('../outside.ts')).toBeNull();
    expect(citedFilePath('src/../../etc/passwd')).toBeNull();
    expect(citedFilePath('../../etc/passwd')).toBeNull();
    // The repository root is INSIDE the repository: a cited path of '.' is
    // the root and not a path outside it.
    expect(citedFilePath('.')).toBe(REPO_ROOT);
    const inside = citedFilePath('src/titan/http-server.ts');
    expect(inside).not.toBeNull();
    expect(inside?.startsWith(`${REPO_ROOT}${sep}`)).toBe(true);
    expect(existsSync(inside ?? '')).toBe(true);
    expect(checkCitation('w', '../outside.ts', 'dispatch')).toContain(
      'resolves outside the repository',
    );
    expect(checkCitation('w', 'src/../../etc/passwd', 'dispatch')).toContain(
      'resolves outside the repository',
    );
  });

  it('pins the missing file: a file that does not exist is reported, not thrown', () => {
    // A cited file inside the repository that is not there is a STALE
    // CLAIM, and the check must say so. Reading the file anyway would
    // throw ENOENT and take the whole suite down with it; reporting
    // nothing would let the claim drift unnoticed.
    expect(checkCitation('w', 'src/titan/missing.ts', 'ghost')).toContain('does not exist');
    expect(citedSource('src/titan/missing.ts')).toBeNull();
  });

  it('pins the declaration kinds: a declaration is a declaration wherever it is written', () => {
    // A `const`, a function, a class, an interface, a type alias and an
    // enum are all declarations, and a citation of any of them must
    // resolve: a guard that named only some of them would quietly stop
    // resolving the others.
    for (const symbol of [
      'handleConst',
      'handleFunction',
      'HandleClass',
      'HandleInterface',
      'HandleType',
      'HandleEnum',
    ]) {
      expect(declarationFacts(DECLARATION_FIXTURE, symbol), symbol).not.toBeNull();
    }
  });

  it('pins the commented-out declaration: a commented definition is not a declaration', () => {
    // The declarations are the TypeScript compiler's own, which is what
    // makes the check exact: a definition that is commented out is not in
    // the tree at all, so it is not a declaration and a citation of it does
    // not check out. The same symbol defined for real IS found.
    expect(declarationFacts(COMMENTED_FIXTURE, 'handleSearch')).toBeNull();
    expect(declarationFacts(COMMENTED_FIXTURE, 'handleOther')).not.toBeNull();
    expect(checkDeclaration('w', 'src/core/other.ts', COMMENTED_FIXTURE, 'handleSearch')).toContain(
      'declares no symbol named handleSearch',
    );
    expect(checkDeclaration('w', 'src/core/other.ts', COMMENTED_FIXTURE, 'handleOther')).toBeNull();
  });

  it('pins the member declaration: a method is a declaration wherever it lives', () => {
    // A member counts: a method is a declaration wherever it lives — a class
    // body, an object literal, an interface, a type literal, an enum — and
    // in every form it can take: a method, a property, an assignment, an
    // accessor. So a citation stays resolvable when the code around it is
    // reorganised.
    for (const symbol of [
      'handleClass',
      'handleProperty',
      'handleGetter',
      'handleSetter',
      'handleObject',
      'handleAssignment',
      'handleInterface',
      'handleType',
      'handleEnum',
    ]) {
      expect(declarationFacts(MEMBER_FIXTURE, symbol), symbol).not.toBeNull();
    }
  });

  it('pins the construct scoping: the per-symbol expectations belong to the router alone', () => {
    // The per-symbol expectations were chosen for the ROUTER, so they apply
    // only there: a same-named symbol in another file is held to the general
    // list, not to the router's contract. The same source is a violation in
    // the router and a pass elsewhere.
    //
    // They follow the FILE, not the spelling: the expectations belong to
    // the router's contract, and a citation that writes the same file as
    // `./src/titan/http-server.ts` names the same contract.
    expect(expectedConstructs('src/titan/http-server.ts', 'handleSearch')).toEqual([
      'service.search',
    ]);
    expect(expectedConstructs('./src/titan/http-server.ts', 'handleSearch')).toEqual([
      'service.search',
    ]);
    expect(expectedConstructs('src/core/other.ts', 'handleSearch')).toEqual(GENERAL_CONSTRUCTS);
    expect(
      checkDeclaration('w', 'src/titan/http-server.ts', SAME_NAME_FIXTURE, 'handleSearch'),
    ).toContain('service.search');
    expect(
      checkDeclaration('w', './src/titan/http-server.ts', SAME_NAME_FIXTURE, 'handleSearch'),
    ).toContain('service.search');
    expect(
      checkDeclaration('w', 'src/core/other.ts', SAME_NAME_FIXTURE, 'handleSearch'),
    ).toBeNull();
  });

  it('pins the construct: a construct in a comment is not a construct', () => {
    // The construct a citation claims is read out of the declaration's
    // AST, so a declaration that only mentions it in a COMMENT does not
    // carry it — a comment is not in the tree. The same goes for a string
    // that merely reads like the call: the three kinds of construct do
    // not overlap.
    expect(checkDeclaration('w', ROUTER_FILE, COMMENT_CONSTRUCT_FIXTURE, 'handleSearch')).toContain(
      'carries none of service.search',
    );
    expect(checkDeclaration('w', ROUTER_FILE, STRING_CONSTRUCT_FIXTURE, 'handleSearch')).toContain(
      'carries none of service.search',
    );
    // The call itself is what carries the construct.
    expect(checkDeclaration('w', ROUTER_FILE, CALLED_CONSTRUCT_FIXTURE, 'handleSearch')).toBeNull();
  });

  it('pins the plain construct: a plain word is carried by the declaration', () => {
    // A construct's SHAPE says where it is looked for, and a plain word
    // (`retry-after`, `sha256`) is looked for among the identifiers and
    // literals of the declaration. A declaration that carries the word
    // passes, and a declaration that does not is reported — the plain-word
    // branch is not a shortcut that accepts every symbol.
    expect(checkDeclaration('w', ROUTER_FILE, PLAIN_WORD_FIXTURE, 'precheck')).toBeNull();
    expect(checkDeclaration('w', ROUTER_FILE, PLAIN_WORD_FIXTURE, 'etagFor')).toContain(
      'carries none of sha256',
    );
  });

  it('pins the comparison construct: a comparison is looked for among the comparisons', () => {
    // The construct with a SPACE in it is a comparison, and it is looked
    // for among the declaration's comparisons. The router's contract claims
    // `pathname ===` for `dispatch`, so a `dispatch` that compares the
    // path against nothing carries NONE of it and is reported — the
    // comparison branch is not a shortcut that accepts every symbol.
    expect(checkDeclaration('w', ROUTER_FILE, NO_COMPARISON_ROUTER_FIXTURE, 'dispatch')).toContain(
      'carries none of pathname ===',
    );
    // And the comparison is found when it is really there.
    expect(checkDeclaration('w', ROUTER_FILE, ROUTER_FIXTURE, 'dispatch')).toBeNull();
  });

  it('pins the general construct list: every entry of it is reachable', () => {
    // A symbol with no entry of its own is held to the general list, and
    // every entry of that list must be reachable — otherwise a
    // declaration that carries one of them is reported for carrying
    // nothing. One fixture per entry, and each fixture carries ONLY that
    // entry, so dropping any one of them turns this pin red.
    for (const [construct, fixture] of GENERAL_CONSTRUCT_ENTRIES) {
      expect(
        checkDeclaration('w', 'src/core/other.ts', fixture, 'handleOther'),
        construct,
      ).toBeNull();
    }
  });

  it('pins the inline anchor: a link is not a citation, and a source file is', () => {
    // The file part of an inline anchor must name a SOURCE module — a
    // TypeScript or JavaScript file, whose symbols the resolver can
    // resolve. An anchor whose file is a document (`README.md`) or an
    // asset (`ui-client.css`) names a heading or a rule, not a
    // declaration, and the resolver would report it as a violation the
    // moment the document cited one: those extensions are not read as
    // anchors at all.
    //
    // And an anchor whose file does not resolve INSIDE the repository is
    // a LINK: a URL with a fragment must not fail the gate. A file that
    // resolves but does not exist is a stale claim, and the check says
    // so — the two are not the same fact.
    //
    // A source file at the repository's ROOT is a citation too: the
    // rule is the FILE, not its depth.
    const spec = [
      'info:',
      '  description: served by src/titan/http-server.ts#sendJson, configured by vitest.config.ts#thresholds',
      '',
    ].join('\n');
    expect(inlineAnchorsIn(spec).map((anchor) => anchor.symbol)).toEqual([
      'sendJson',
      'thresholds',
    ]);
    const linked = ['info:', '  description: see example.com#intro for details', ''].join('\n');
    expect(inlineAnchorsIn(linked)).toEqual([]);
    const asset = ['info:', '  description: styled by src/titan/ui-client.css#bodyRule', ''].join(
      '\n',
    );
    expect(inlineAnchorsIn(asset)).toEqual([]);
    // A document is not a source module either: `README.md#intro` names a
    // heading, not a declaration, and the resolver could not resolve it.
    const markdown = ['info:', '  description: see README.md#intro for details', ''].join('\n');
    expect(inlineAnchorsIn(markdown)).toEqual([]);
    // A link is not a citation; a missing file INSIDE the repository is a
    // stale claim and stays one.
    expect(anchorIsCitation('src/titan/http-server.ts')).toBe(true);
    expect(anchorIsCitation('src/titan/missing.ts')).toBe(true);
    // A schemeless host RESOLVES inside the repository — `example.com` is
    // a directory of the repository root — so it is a citation, and a
    // stale one. The rule is the FILE, not the scheme: an anchor whose
    // file part does not resolve inside the repository is a link, and a
    // schemeless URL to a `.ts`/`.js` file is read as a claim.
    expect(anchorIsCitation('example.com/index.ts')).toBe(true);
    expect(anchorIsCitation(`/${'/'}example.com/index.ts`)).toBe(false);
    // A link with a FRAGMENT: the anchor is read (its file part is a
    // source module), and it is a link because that file part does not
    // resolve inside the repository — the rule the convention note names.
    const fragment = [
      'info:',
      '  description: see https://example.com/index.ts#intro for details',
      '',
    ].join('\n');
    const linkedAnchors = inlineAnchorsIn(fragment);
    expect(linkedAnchors.map((anchor) => anchor.symbol)).toEqual(['intro']);
    expect(linkedAnchors.every((anchor) => !anchorIsCitation(anchor.file))).toBe(true);
    // And every extension the pattern reads as a source module is
    // recognised: dropping one of them would leave a document that cites
    // a `.mts` file unchecked.
    for (const extension of SOURCE_EXTENSIONS) {
      const source = [
        'info:',
        `  description: served by src/titan/router.${extension}#symbol`,
        '',
      ].join('\n');
      expect(
        inlineAnchorsIn(source).map((anchor) => anchor.symbol),
        extension,
      ).toEqual(['symbol']);
    }
  });

  it('pins the route binding: it is asked of the router alone', () => {
    // The route binding is a claim about the ROUTER's dispatch. A
    // citation of another file's symbol is not a claim about a route, so
    // the check must not be asked of it: asking it reported "the router
    // has no path constant" for a file that was never the router.
    expect(
      checkRouteBindingFor(
        'src/core/service.ts',
        'w',
        NO_ROUTES_FIXTURE,
        '/api/v1/search',
        'handleSearch',
      ),
    ).toBeNull();
    expect(
      checkRouteBindingFor(
        'src/titan/http-server.ts',
        'w',
        ROUTER_FIXTURE,
        '/api/v1/search',
        'handleSearch',
      ),
    ).toBeNull();
    expect(
      checkRouteBindingFor(
        'src/titan/http-server.ts',
        'w',
        ROUTER_FIXTURE,
        '/api/v1/section',
        'handleSearch',
      ),
    ).not.toBeNull();
  });

  it('pins the wrapped citation: a wrapped pair is a citation, a wrapped bare word is prose', () => {
    // The rule for which is which is the PAIR: a wrapped segment names a
    // symbol when it carries a `file#symbol` pair, because a pair says which
    // file it is about. A wrapped bare word is the ambiguous case — it
    // carries no file of its own — so the FILE decides, and that is pinned
    // by the next test.
    const pair = { file: 'src/titan/http-server.ts', symbol: 'dispatch', wellFormed: true };
    expect(citedSymbols('(src/titan/http-server.ts#dispatch)')).toEqual([pair]);
    expect(citedSymbols('src/titan/http-server.ts#dispatch (the router)')).toEqual([pair]);
    expect(citedSymbols('src/titan/http-server.ts#dispatch, (the router)')).toEqual([pair]);
    expect(citedSymbols('src/titan/http-server.ts#dispatch, (router)')).toEqual([pair]);
    // A comma inside a parenthetical is prose, not a separator.
    expect(citedSymbols('src/titan/http-server.ts#dispatch (encoding, URL parse)')).toEqual([pair]);
    // A trailing separator is not a citation.
    expect(citedSymbols('src/titan/http-server.ts#dispatch, ')).toEqual([pair]);
  });

  it('pins the wrapped bare word: the FILE decides whether it is a citation', () => {
    // "(the router)" is prose and "(handleSearch)" is a citation, and the
    // shape alone cannot tell them apart. So the FILE decides: a word the
    // inherited file declares is a citation, and a word it does not
    // declare is prose. Without the file's answer a wrapped bare word is
    // prose, because a word nothing declares must never become a
    // violation.
    const pair = { file: 'src/titan/http-server.ts', symbol: 'dispatch', wellFormed: true };
    const declared = { file: 'src/titan/http-server.ts', symbol: 'handleSearch', wellFormed: true };
    const declares = (_file: string, symbol: string): boolean => symbol === 'handleSearch';
    expect(citedSymbols('src/titan/http-server.ts#dispatch (handleSearch)', declares)).toEqual([
      pair,
      declared,
    ]);
    // The same word, when the file does not declare it, is prose.
    expect(citedSymbols('src/titan/http-server.ts#dispatch (handleSearch)', () => false)).toEqual([
      pair,
    ]);
    // And with no file to ask, it is prose.
    expect(citedSymbols('src/titan/http-server.ts#dispatch (handleSearch)')).toEqual([pair]);
    // And with no file to INHERIT, it is prose too: a word with no file
    // must never become a citation against the empty path.
    expect(citedSymbols('(handleSearch)', () => true)).toEqual([]);
    // And a wrapped word that is not a symbol NAME is prose, whatever
    // the file says: only an identifier can be a symbol.
    expect(citedSymbols('src/titan/http-server.ts#dispatch (the router)', () => true)).toEqual([
      pair,
    ]);
    // And a parenthesis that is never closed is an unparsable token, and
    // an unparsable token is reported rather than dropped: a citation
    // that names nothing checks out nothing.
    expect(citedSymbols('(unclosed', () => true)).toEqual([
      { file: '', symbol: '(unclosed', wellFormed: false },
    ]);
  });

  it('pins the unchecked citation: a route with no path constant is reported, not skipped', () => {
    // The router holds no constant for this path, so the claim cannot be
    // checked — and a check that cannot be run must say so, not pass.
    const violation = checkRouteBinding('w', ROUTER_FIXTURE, '/api/v1/nosuchroute', 'handleSearch');
    expect(violation).not.toBeNull();
    expect(violation).toContain('no path constant');
    expect(violation).toContain('/api/v1/nosuchroute');
  });

  it('pins the citation shape: a pair names a file with an extension', () => {
    // A pair is `file#symbol`, and the file is a SOURCE module, so it
    // carries an extension. Without that, `foo#bar` would be a citation
    // against a file called `foo`.
    expect(citedSymbols('foo#bar')).toEqual([{ file: '', symbol: 'foo#bar', wellFormed: false }]);
  });

  it('pins the symbol name: a symbol name is an identifier', () => {
    // A symbol name is an identifier: it cannot start with a digit. A
    // pair whose symbol starts with one names nothing, and must be
    // reported as unparsable rather than read as a citation.
    expect(citedSymbols('src/titan/http-server.ts#2fast')).toEqual([
      { file: '', symbol: 'src/titan/http-server.ts#2fast', wellFormed: false },
    ]);
    // And a bare word is an identifier too, so the same word in the tail
    // is a violation and not a citation.
    expect(citedSymbols('src/titan/http-server.ts#dispatch, 2fast')).toEqual([
      { file: 'src/titan/http-server.ts', symbol: 'dispatch', wellFormed: true },
      { file: 'src/titan/http-server.ts', symbol: '2fast', wellFormed: false },
    ]);
    // And an inline anchor names a symbol by the same rule: an anchor
    // whose symbol starts with a digit names nothing, and is not read as
    // an anchor at all.
    const spec = ['info:', '  description: served by src/titan/router.ts#2fast', ''].join('\n');
    expect(inlineAnchorsIn(spec)).toEqual([]);
  });

  it('pins the inherited file: a bare word with no file is not a citation', () => {
    // A bare word inherits the file of the pair before it, and a tail
    // that STARTS with one has no file to inherit — so the word names
    // nothing, and it must not become a citation against the empty path.
    expect(citedSymbols('handleSearch')).toEqual([
      { file: '', symbol: 'handleSearch', wellFormed: false },
    ]);
  });

  it('pins the tail separator: a comma outside a parenthetical separates', () => {
    // The tail is split on the commas that are NOT inside parentheses, and
    // the depth never goes below zero: a stray ')' does not swallow the
    // rest of the tail, so the comma after it still separates.
    expect(citedSymbols('src/titan/http-server.ts#dispatch) , handleSearch')).toHaveLength(2);
    // A comma INSIDE a parenthetical is prose, and does not separate.
    expect(citedSymbols('src/titan/http-server.ts#dispatch (encoding, URL parse)')).toHaveLength(1);
  });

  it('pins the folded block scalar: a folded prose line is prose, not a citation', () => {
    // A block scalar's body is a STRING, and a folded one folds its lines
    // into prose. A `# source:` line inside it is part of the text — read
    // as a citation it would fail the suite for a name the document
    // never claimed.
    const folded = [
      'info:',
      '  description: >-',
      '    # source: src/titan/http-server.ts#notacitation',
      'paths:',
      '  /x:',
      '    # source: src/titan/http-server.ts#dispatch',
      '    get:',
      '      description: x',
      '',
    ].join('\n');
    expect(citationsIn(folded).map((citation) => citation.tail)).toEqual([
      'src/titan/http-server.ts#dispatch',
    ]);
  });

  it('pins the block scalar bounds: a line at a range boundary is inside the string', () => {
    // The block scalar's range is INCLUSIVE at both ends: the line that
    // starts exactly where the range ends is still part of the string, so
    // a `# source:` line there is PROSE and not a citation. A range that
    // ended one character early — or a test that ended one character
    // early — would read that line as a comment and report a citation the
    // document never made.
    const spec = [
      'info:',
      '  description: |',
      '    prose',
      '# source: src/titan/http-server.ts#dispatch',
      '',
    ].join('\n');
    const ranges = blockScalarRanges(spec);
    const offsets = lineOffsets(spec);
    const range = ranges[0] ?? [-1, -1];
    // The range's START is the scalar's own token: the block opens with
    // `|`, and the string covers it. A range that started one character
    // later would leave the character before the content outside it.
    expect(range[0]).toBe(spec.indexOf('|'));
    // The citation's line starts exactly where the range ends.
    expect(offsets[3], 'the citation line starts where the block scalar ends').toBe(range[1]);
    expect(insideRanges(ranges, range[1])).toBe(true);
    // And the range's own start is inside it, too.
    expect(insideRanges(ranges, range[0])).toBe(true);
    // So the citation there is prose, not a citation.
    expect(citationsIn(spec)).toEqual([]);
  });

  it('pins the path attribution: a citation sits under the path it documents', () => {
    // A citation inside a path item documents that path, and the walk
    // stops at the first key at indent two or less — so a path nested
    // deeper than the document's own path level documents no route.
    const nested = [
      'paths:',
      '  /x:',
      '    get:',
      '      # source: src/titan/http-server.ts#dispatch',
      '',
    ].join('\n');
    expect(citationsIn(nested)[0]?.path).toBe('/x');
    const deep = [
      'paths:',
      '    /x:',
      '      # source: src/titan/http-server.ts#dispatch',
      '',
    ].join('\n');
    expect(citationsIn(deep)[0]?.path).toBeNull();
    // One step deeper than the document's own path level is still too
    // deep: the threshold is the document's path level and not one more.
    const deeper = [
      'paths:',
      '   /y:',
      '      # source: src/titan/http-server.ts#dispatch',
      '',
    ].join('\n');
    expect(citationsIn(deeper)[0]?.path).toBeNull();
    // And a line that is not a key at all is stepped over: the path is
    // the nearest path key ABOVE the citation, not the nearest line.
    const underValue = [
      'paths:',
      '  /x:',
      '    summary: A summary',
      '    # source: src/titan/http-server.ts#dispatch',
      '',
    ].join('\n');
    expect(citationsIn(underValue)[0]?.path).toBe('/x');
    // A key that carries a VALUE is not a path key, and the walk steps
    // over it to the path key above: the path is the nearest path key
    // ABOVE the citation, not the nearest line that reads like a key.
    const besideValue = [
      'paths:',
      '  /x:',
      '  summary: A summary',
      '    # source: src/titan/http-server.ts#dispatch',
      '',
    ].join('\n');
    expect(citationsIn(besideValue)[0]?.path).toBe('/x');
    // A comment is not a key, even when it ends in a colon: the walk steps
    // over it to the path key above it.
    const besideComment = [
      'paths:',
      '  /x:',
      '  # a note:',
      '    # source: src/titan/http-server.ts#dispatch',
      '',
    ].join('\n');
    expect(citationsIn(besideComment)[0]?.path).toBe('/x');
  });

  it('pins the path attribution: a path key may carry a comment of its own', () => {
    // A path key may carry a comment, and the comment does not make it a
    // different key: the citation under it still documents that path. A
    // key whose comment hid it from the walk attributed the citation to
    // the PREVIOUS path item — and a citation in the FIRST path item was
    // attributed to nothing at all, so it could name another route's
    // handler and the suite had nothing to say about it.
    const spec = [
      'paths:',
      '  /api/v1/search: # the search route',
      '    # source: src/titan/http-server.ts#handleSearch',
      '',
    ].join('\n');
    expect(citationsIn(spec)[0]?.path).toBe('/api/v1/search');
    // And the citation is CHECKED against that path: the document's scan
    // is the call site the shipped document goes through.
    const scan = scanDocumentCitations(spec, 'fixture.yaml');
    expect(scan.citations).toBe(1);
    expect(scan.violations).toEqual([]);
    // The same key, with the comment, names the same handler — so a
    // citation repointed at another route's handler is still reported.
    const repointed = [
      'paths:',
      '  /api/v1/search: # the search route',
      '    # source: src/titan/http-server.ts#handleSection',
      '',
    ].join('\n');
    expect(scanDocumentCitations(repointed, 'fixture.yaml').violations).toHaveLength(1);
  });

  it('pins the path attribution: a citation with no path to attribute is reported', () => {
    // A citation in the paths mapping with no path item above it claims a
    // route the document does not name, so the route binding cannot be
    // asked of it — and a check that cannot be run must say so, not pass.
    // It used to say nothing at all: the citation was read as a construct,
    // and the handler it named was never compared with any route.
    const spec = ['paths:', '  # source: src/titan/http-server.ts#handleSearch', ''].join('\n');
    const scan = scanDocumentCitations(spec, 'fixture.yaml');
    expect(scan.citations).toBe(1);
    expect(scan.violations).toHaveLength(1);
    expect(scan.violations[0]).toContain('does not say which path');
    expect(scan.violations[0]).toContain('fixture.yaml:2');
    // A citation under a construct is not a route claim, and it is not
    // reported as one: the components of the document name no route.
    const shared = [
      'components:',
      '  responses:',
      '    BadRequest:',
      '      # source: src/titan/http-server.ts#handleSection',
      '',
    ].join('\n');
    expect(scanDocumentCitations(shared, 'fixture.yaml').violations).toEqual([]);
  });

  it('pins the citation marker: it must start the comment', () => {
    // A `# source:` marker that does not start the comment is not a
    // citation, and it used to be read as nothing at all: no violation,
    // no warning, no check. A contributor who wrote the marker inline got
    // a claim that was never verified and no sign that it was missing.
    const inline = [
      'paths:',
      '  /api/v1/search:',
      '    get: # source: src/titan/http-server.ts#handleSearch',
      '',
    ].join('\n');
    const scan = scanDocumentCitations(inline, 'fixture.yaml');
    expect(scan.citations).toBe(0);
    expect(scan.violations).toHaveLength(1);
    expect(scan.violations[0]).toContain('must start the comment');
    expect(scan.violations[0]).toContain('fixture.yaml:3');
    // A marker that follows another note in the same comment is reported
    // too: the marker is read at the START of the comment.
    const noted = [
      'paths:',
      '  /api/v1/search:',
      '    # a note # source: src/titan/http-server.ts#handleSearch',
      '',
    ].join('\n');
    const trailing = scanDocumentCitations(noted, 'fixture.yaml');
    expect(trailing.citations).toBe(0);
    expect(trailing.violations).toHaveLength(1);
    expect(trailing.violations[0]).toContain('must start the comment');
    // And the marker on a line of its own is a citation, and it is CHECKED.
    const standalone = [
      'paths:',
      '  /api/v1/search:',
      '    # source: src/titan/http-server.ts#handleSearch',
      '',
    ].join('\n');
    const read = scanDocumentCitations(standalone, 'fixture.yaml');
    expect(read.citations).toBe(1);
    expect(read.violations).toEqual([]);
    // A value that QUOTES the marker is prose, not a marker: the quotes
    // are read before the comment is looked for.
    const quoted = [
      'info:',
      '  description: "the marker is # source: src/titan/http-server.ts#handleSearch"',
      '',
    ].join('\n');
    expect(scanDocumentCitations(quoted, 'fixture.yaml').violations).toEqual([]);
  });

  it('pins the quoted value: a comment after a closed quote is still a comment', () => {
    // The quotes of a value are read before the comment is looked for, and
    // they CLOSE again: a `#` after the closing quote is a comment and not
    // part of the value. A quote that never closed would swallow the
    // comment after it, and a marker written there would be read as
    // nothing at all — a citation nobody checked.
    const scan = scanDocumentCitations(QUOTED_VALUE_THEN_COMMENT, 'fixture.yaml');
    expect(scan.violations).toHaveLength(1);
    expect(scan.violations[0]).toContain('must start the comment');
  });

  it('pins the plain value: a `#` with no space before it is not a comment', () => {
    // A `#` opens a comment only when whitespace precedes it: `x# source:`
    // is a plain value that happens to carry a hash, not a marker, and
    // reporting it as a marker would fail a document over its own prose.
    const scan = scanDocumentCitations(PLAIN_VALUE_WITH_HASH, 'fixture.yaml');
    expect(scan.violations).toEqual([]);
  });

  it('pins the path constants: a route binds to the constant that serves it', () => {
    // A router may serve `/api/v1/foo/bar` under the constant
    // `/api/v1/foo`, and the citation of that route must bind to it
    // rather than be told the router holds no constant for it.
    expect(
      checkRouteBinding('w', PREFIX_ROUTER_FIXTURE, '/api/v1/foo/bar', 'handleFoo'),
    ).toBeNull();
    const violation = checkRouteBinding(
      'w',
      PREFIX_ROUTER_FIXTURE,
      '/api/v1/foo/bar',
      'handleSearch',
    );
    expect(violation).not.toBeNull();
    // The root constant serves the root, not every route.
    expect(checkRouteBinding('w', ROOT_ROUTER_FIXTURE, '/api/v1/search', 'handleSearch')).toContain(
      'no path constant',
    );
    // A constant no branch tests serves its own path only: the router
    // holds it, so the citation can be checked against it.
    const orphan = checkRouteBinding('w', UNTESTED_ROUTER_FIXTURE, '/api/v1/orphan', 'handleOther');
    expect(orphan).not.toBeNull();
    expect(orphan).toContain('served by the router, not by handleOther');
  });

  it('pins the longest serving constant: the longest one wins', () => {
    // A path can be served by MORE THAN ONE constant, and the router's
    // dispatch is the authority on which one the citation binds to: the
    // longest serving constant wins, and a tie goes to the constant
    // declared first.
    expect(
      checkRouteBinding('w', OVERLAPPING_ROUTER_FIXTURE, '/api/v1/search', 'handleSearch'),
    ).toBeNull();
    // The short prefix does not win.
    expect(
      checkRouteBinding('w', OVERLAPPING_ROUTER_FIXTURE, '/api/v1/search', 'handleApi'),
    ).toContain('is served by the router, not by handleApi');
    // And neither does the alias that comes after the winner.
    expect(
      checkRouteBinding('w', OVERLAPPING_ROUTER_FIXTURE, '/api/v1/search', 'handleAlias'),
    ).toContain('is served by the router, not by handleAlias');
  });

  it('pins the path template: a templated route is compared with its template stripped', () => {
    // The document documents a route by its TEMPLATE
    // ('/api/v1/sections/{citation}') while the router holds the concrete
    // path ('/api/v1/sections/'). The template is stripped before the
    // comparison, so the two can be compared at all.
    expect(
      checkRouteBinding(
        'w',
        CONCRETE_ROUTER_FIXTURE,
        '/api/v1/sections/{citation}',
        'handleSection',
      ),
    ).toBeNull();
    // The rule has its limit: a router whose constant holds the TEMPLATE
    // itself cannot be checked for that route, because the stripped path
    // and the constant are different strings — and a check that cannot be
    // run must say so, not pass.
    expect(
      checkRouteBinding(
        'w',
        TEMPLATE_ROUTER_FIXTURE,
        '/api/v1/sections/{citation}',
        'handleSection',
      ),
    ).toContain('no path constant');
  });

  it('pins the duplicate name: the FIRST declaration of a name is the one', () => {
    // A file may declare a name twice, and the resolver reads the FIRST
    // one. The choice is pinned because the other one would change what a
    // citation resolves to, silently.
    expect(checkDeclaration('w', ROUTER_FILE, DUPLICATE_FIXTURE, 'handleSearch')).toBeNull();
  });

  it('pins the unnamed declaration: a declaration without a name declares nothing', () => {
    // A default export has no name, and there is nothing to cite — so the
    // resolver must read such a file without complaint, and record
    // nothing for it.
    expect(citedFile(UNNAMED_FIXTURE).names.size).toBe(0);
    expect(declarationFacts(UNNAMED_FIXTURE, 'default')).toBeNull();
  });

  it('pins the path constant: only a NAMED declaration holds a path', () => {
    // A path constant is a NAMED declaration with a string literal: a
    // destructuring declaration has no name to be named by, so it holds no
    // path.
    expect(citedFile(DESTRUCTURED_FIXTURE).paths).toEqual([]);
    // And it holds a STRING: a named declaration whose value is not a
    // string literal holds no path either, or the router would bind a
    // route to a number.
    expect(citedFile(NON_STRING_FIXTURE).paths).toEqual([]);
  });

  it('pins the second branch: every branch of a constant is read', () => {
    // A router may test the same constant twice — an exact route and a
    // prefix route under it. Both branches are read, so the prefix branch
    // serves the paths under the constant.
    expect(
      checkRouteBinding('w', SECOND_BRANCH_ROUTER_FIXTURE, '/api/v1/x/y', 'handleSecond'),
    ).toBeNull();
    // And the exact branch still serves its own path.
    expect(
      checkRouteBinding('w', SECOND_BRANCH_ROUTER_FIXTURE, '/api/v1/x', 'handleFirst'),
    ).toBeNull();
  });

  it('pins the comparison: its left side is read as text', () => {
    // A comparison is named by its left side and its operator, and the
    // left side is read as TEXT: the construct of a comparison whose left
    // is a property access is 'res.statusCode ===', not 'undefined ==='.
    expect(
      carriesConstruct(factsOfSymbol(COMPARISON_FIXTURE, 'handleOther'), 'res.statusCode ==='),
    ).toBe(true);
    // And a comparison whose left is an identifier is named the same way.
    expect(carriesConstruct(factsOfSymbol(ROUTER_FIXTURE, 'dispatch'), 'pathname ===')).toBe(true);
    // And it is named by the NAME of that identifier, not by the text it
    // happens to be spelled with: an identifier written with an escape
    // is still `pathname`.
    expect(
      carriesConstruct(factsOfSymbol(ESCAPED_COMPARISON_FIXTURE, 'handleOther'), 'pathname ==='),
    ).toBe(true);
  });

  it('pins the caches: a cited file is parsed once and read once', () => {
    // The resolver asks the same file the same questions many times, and
    // the file is read and parsed ONCE: the parsed form is the same
    // object every time, and the file is read from disk once however many
    // citations name it.
    const source = 'function handleCached(): void {}\n';
    expect(citedFile(source)).toBe(citedFile(source));
    const file = 'vitest.config.ts';
    const path = citedFilePath(file) ?? '';
    const before = readCounts.get(path) ?? 0;
    citedSource(file);
    citedSource(file);
    expect(readCounts.get(path)).toBe(before + 1);
  });
});
