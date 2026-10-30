import type { Logger } from '../logger.js';
import { clientSafeMessage } from './client-safe.js';

/**
 * The shape every MCP tool result on this server has: the text channel (the
 * MCP spec requires a content array on a tool result), the machine contract
 * (the SDK requires `structuredContent` whenever a tool declares an output
 * schema), and the error marker.
 */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Run a tool's work under ONE error contract (CR-18).
 *
 * The full detail goes to the server-side log; the client receives the
 * sanitized message only (documented guidance verbatim, everything else the
 * fixed generic — src/mcp/client-safe.ts). Every tool handler goes through
 * this wrapper, so the contract exists once: a change to the error shape
 * cannot be made nine times, and no copy can be missed.
 */
export async function runTool(
  logger: Logger,
  toolName: string,
  work: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await work();
  } catch (error) {
    logger.error(`tool ${toolName} failed`, {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      content: [{ type: 'text', text: `Error: ${clientSafeMessage(error)}` }],
      isError: true,
    };
  }
}

/**
 * Render a tool result for the TEXT channel (CR-27).
 *
 * The structured channel already carries the payload, field by field. The
 * text channel exists because the MCP spec requires a content array — not
 * because the payload needs a second copy — so it renders the same
 * information as prose a model can read: scalars as `label: value` lines,
 * string lists comma-joined, object lists one entry per line, nested objects
 * indented. It is deliberately NOT a JSON dump of the payload: that
 * duplicated every byte and inflated it with indentation.
 *
 * `bodyFields` names the fields that hold the same long text in two
 * renderings (a provision's `markdown` and `text`). Only the first is
 * rendered, at the end of the text; the rest are dropped, so a section
 * result ships its body once instead of four times.
 */
export function renderToolText(
  payload: Record<string, unknown>,
  bodyFields: readonly string[] = [],
): string {
  const meta: string[] = [];
  let body = '';
  for (const [key, value] of Object.entries(payload)) {
    if (bodyFields.includes(key)) {
      if (body === '' && typeof value === 'string') body = value;
      continue;
    }
    meta.push(...renderField(key, value));
  }
  return body === '' ? meta.join('\n') : [...meta, '', body].join('\n');
}

/** One field of the text rendering; `null` is rendered, absent is not. */
function renderField(key: string, value: unknown, indent = ''): string[] {
  if (value === undefined) return [];
  if (value === null) return [`${indent}${key}: (none)`];
  if (typeof value === 'string') return value === '' ? [] : [`${indent}${key}: ${value}`];
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [`${indent}${key}: ${String(value)}`];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${key}: (none)`];
    if (value.every((entry) => typeof entry === 'string')) {
      return [`${indent}${key}: ${value.join(', ')}`];
    }
    return [`${indent}${key}:`, ...value.flatMap((entry) => renderEntry(entry, indent))];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return [
    `${indent}${key}:`,
    ...entries.flatMap(([childKey, childValue]) =>
      renderField(childKey, childValue, `${indent}  `),
    ),
  ];
}

/** One entry of an object list. */
function renderEntry(entry: unknown, indent: string): string[] {
  if (typeof entry !== 'object' || entry === null) return [`${indent}  - ${String(entry)}`];
  const entries = Object.entries(entry as Record<string, unknown>);
  return entries.flatMap(([key, value]) => renderField(key, value, `${indent}  `));
}
