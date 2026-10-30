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
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import type http from 'node:http';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
import { parse as parseYaml, parseDocument, visit } from 'yaml';
import { EcfrApi } from '../src/core/ecfr.js';
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
        } catch {
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
    const ecfr = mergeEcfr(makeDiffEcfr(), makeRedlineEcfr());
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
//      has its own expectation (SYMBOL_CONSTRUCTS), chosen so that no other
//      symbol in the router carries it: a citation repointed at the wrong
//      real symbol fails here.
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
 * construct that symbol carries and no other symbol of the router does.
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
 * The constructs a citation of `symbol` in `file` expects its declaration
 * to carry.
 *
 * The per-symbol expectations were chosen for the ROUTER, so they apply
 * only there: a same-named symbol in another file is held to the general
 * list, not to the router's contract.
 */
function expectedConstructs(file: string, symbol: string): readonly string[] {
  if (file === ROUTER_FILE) return SYMBOL_CONSTRUCTS[symbol] ?? GENERAL_CONSTRUCTS;
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

/** `path/to/file.ts#symbol` — a file and the symbol it must define. */
const SYMBOL_PAIR_RE = /^([\w./-]+\.\w+)#([A-Za-z_$][\w$]*)$/;

/** A bare symbol name. */
const BARE_SYMBOL_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * An inline `file#symbol` anchor in the document's prose.
 *
 * The file part must end in a SOURCE extension: without that, a URL with
 * a word fragment (`example.com#intro`) would be read as an anchor, and
 * the suite would fail on a link rather than on a citation.
 */
const INLINE_ANCHOR_RE = /([\w./-]+\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|md))#([A-Za-z_$][\w$]*)/g;

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
 * file it is about. A wrapped bare word carries no file, so it cannot be
 * checked against one — it is prose, and it stays prose.
 */
function citedSymbols(tail: string): CitedSymbol[] {
  const cited: CitedSymbol[] = [];
  let file = '';
  const pending = [...splitTail(tail)];
  while (pending.length > 0) {
    const raw = pending.shift() ?? '';
    const segment = raw.trim();
    if (segment === '') continue;
    if (segment.startsWith('(') && segment.endsWith(')')) {
      const inner = segment.slice(1, -1).trim();
      // A wrapped PAIR names a symbol and is a citation, unwrapped and
      // checked. A wrapped bare word names no file, so it cannot be
      // checked against one: it is prose, and it stays prose.
      if (!inner.includes('#')) continue;
      pending.unshift(...splitTail(inner));
      continue;
    }
    const token = segment.replace(/\([^)]*\)/g, ' ').trim();
    if (token === '') continue;
    const pair = SYMBOL_PAIR_RE.exec(token);
    if (pair !== null) {
      file = pair[1] ?? '';
      cited.push({ file, symbol: pair[2] ?? '', wellFormed: true });
      continue;
    }
    if (BARE_SYMBOL_RE.test(token) && file !== '') {
      cited.push({ file, symbol: token, wellFormed: true });
      continue;
    }
    // An unparsable token is a violation, never a silent skip: a citation
    // that names nothing checks out nothing.
    cited.push({ file, symbol: token, wellFormed: false });
  }
  return cited;
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

/** The cited file, parsed by the TypeScript compiler. */
function parseCited(source: string): ts.SourceFile {
  return ts.createSourceFile('cited.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * The text of the declaration of `symbol` in `source`, or null when the
 * file declares no such symbol.
 *
 * The declarations are the TypeScript compiler's own, which is what makes
 * the check exact: a definition that is commented out is not in the tree at
 * all, and a method is a declaration wherever it lives.
 */
function declarationText(source: string, symbol: string): string | null {
  const parsed = parseCited(source);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (declaredName(node) === symbol) {
      found = node.getText(parsed);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/**
 * The router's path constants: the constant's name and the path it holds.
 */
function pathConstants(
  source: string,
): readonly { readonly name: string; readonly path: string }[] {
  const parsed = parseCited(source);
  const found: { name: string; path: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      if (init !== undefined && ts.isStringLiteral(init)) {
        found.push({ name: node.name.text, path: init.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
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
 * True when the router's branch for `constant` calls `symbol`.
 *
 * The router is the authority on which handler serves which route: it
 * compares the path against a constant and calls one handler. A citation
 * inside a path item claims a handler for that route, so the claim is
 * checked against the router's own branch — which is what makes a citation
 * repointed at another route's handler fail.
 */
function branchCalls(source: string, constant: string, symbol: string): boolean {
  const parsed = parseCited(source);
  let called = false;
  const visit = (node: ts.Node): void => {
    if (called) return;
    if (ts.isIfStatement(node) && identifierNames(node.expression).includes(constant)) {
      const inner = (current: ts.Node): void => {
        if (called) return;
        if (ts.isIdentifier(current) && current.text === symbol) {
          called = true;
          return;
        }
        ts.forEachChild(current, inner);
      };
      inner(node.thenStatement);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return called;
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
  const declaration = declarationText(source, symbol);
  if (declaration === null) return `${where} — ${file} declares no symbol named ${symbol}`;
  const expected = expectedConstructs(file, symbol);
  if (!expected.some((keyword) => declaration.includes(keyword))) {
    return `${where} — ${symbol} carries none of ${expected.join(', ')}`;
  }
  return null;
}

/**
 * The violation message for one cited symbol, or null when it checks out.
 */
function checkCitation(where: string, file: string, symbol: string): string | null {
  const path = citedFilePath(file);
  if (path === null) return `${where} — ${file} resolves outside the repository`;
  if (!existsSync(path)) return `${where} — ${file} does not exist`;
  return checkDeclaration(where, file, readFileSync(path, 'utf8'), symbol);
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
  const constant = pathConstants(source).find((entry) => entry.path === wanted);
  if (constant === undefined) {
    // The router holds no constant for this path, so the claim cannot be
    // checked — and a check that cannot be run must say so, not pass.
    return `${where} — the router has no path constant for ${path}, so the citation cannot be checked`;
  }
  if (branchCalls(source, constant.name, symbol)) return null;
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
 * The path a citation documents, or null when it documents a construct
 * rather than a route.
 *
 * A citation sits inside the path item it documents — between the path key
 * and its first operation — so the path is the nearest path key above it.
 * The walk stops at the first key at indent two or less: `responses:` and
 * `schemas:` are such keys, and a citation under one of them documents a
 * construct, not a route.
 */
function documentedPath(lines: readonly string[], citationLine: number): string | null {
  for (let at = citationLine - 1; at >= 0; at -= 1) {
    const key = /^(\s*)([^\s#][^:]*):\s*$/.exec(lines[at] ?? '');
    if (key === null) continue;
    if ((key[1] ?? '').length > 2) continue;
    const name = (key[2] ?? '').trim();
    return name.startsWith('/') ? name : null;
  }
  return null;
}

/** A citation in the document: the line it is on, its tail, and the route it documents. */
interface Citation {
  readonly line: number;
  readonly tail: string;
  /** The path the citation documents, or null for a shared construct. */
  readonly path: string | null;
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
    citations.push({
      line: index + 1,
      tail: match[1] ?? '',
      path: documentedPath(lines, index),
    });
  }
  return citations;
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
    const violations: string[] = [];
    let citations = 0;
    for (const citation of citationsIn(specText)) {
      const path = citation.path;
      for (const cited of citedSymbols(citation.tail)) {
        citations += 1;
        const where = `docs/openapi.yaml:${citation.line} cites ${cited.file}#${cited.symbol}`;
        if (!cited.wellFormed) {
          violations.push(`${where} — not a symbol reference`);
          continue;
        }
        const violation = checkCitation(where, cited.file, cited.symbol);
        if (violation !== null) {
          violations.push(violation);
          continue;
        }
        if (path === null) continue;
        const source = readFileSync(citedFilePath(cited.file) ?? '', 'utf8');
        const bound = checkRouteBinding(where, source, path, cited.symbol);
        if (bound !== null) violations.push(bound);
      }
    }
    expect(citations, 'docs/openapi.yaml must contain # source: citations').toBeGreaterThan(0);
    expect(violations, 'drifted # source: citations in docs/openapi.yaml').toEqual([]);
  });

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
