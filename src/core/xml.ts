import { XMLParser } from 'fast-xml-parser';

/**
 * eCFR XML → structured sections.
 *
 * The parser runs in `preserveOrder` mode so document order is retained, and
 * the walk below is a single O(n) pass (no regex over the document, no
 * backtracking). Division elements are recognized by their `TYPE` attribute
 * (`CHAPTER`, `PART`, `SUBPART`, `SUBJGRP`, `SECTION`, `APPENDIX`), which is
 * stable across the DIV1..DIV9 numbering.
 */

export type SectionKind = 'section' | 'appendix';

/** A section (or appendix) extracted from the Title 38 XML document. */
export interface RawSection {
  readonly citation: string;
  readonly kind: SectionKind;
  readonly heading: string;
  readonly chapter: string | null;
  readonly subchapter: string | null;
  readonly part: string | null;
  readonly subpart: string | null;
  readonly subjectGroup: string | null;
  readonly path: string;
  readonly text: string;
  readonly markdown: string;
}

/** Raised when the upstream XML does not match the expected shape. */
export class XmlFormatError extends Error {
  override readonly name = 'XmlFormatError';
}

type OrderNode = Record<string, unknown>;
type StackEntry = { readonly type: string; readonly id: string };

const ATTR_KEY = ':@';
const TEXT_KEY = '#text';
const MAX_DEPTH = 64;
const MAX_SECTION_CHARS = 400_000;
const ATTR_PREFIX = '@_';

let sharedParser: XMLParser | undefined;

function getParser(): XMLParser {
  sharedParser ??= new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
  });
  return sharedParser;
}

function isOrderNode(value: unknown): value is OrderNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getAttributes(node: OrderNode): Record<string, string> {
  const raw = node[ATTR_KEY];
  if (!isOrderNode(raw)) return {};
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string')
      attributes[key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key] = value;
  }
  return attributes;
}

/** Concatenate all text within a node list, descending through elements. */
function inlineText(nodes: readonly unknown[]): string {
  let out = '';
  for (const node of nodes) {
    if (!isOrderNode(node)) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key === ATTR_KEY) continue;
      if (key === TEXT_KEY) {
        if (typeof value === 'string') out += value;
      } else if (Array.isArray(value)) {
        out += inlineText(value);
      }
    }
  }
  return out;
}

interface Rendered {
  readonly markdown: string;
  readonly text: string;
}

function renderTable(children: readonly unknown[]): Rendered {
  const rows: string[][] = [];
  collectTableRows(children, rows);
  if (rows.length === 0) return { markdown: '', text: '' };
  const header = rows[0] ?? [];
  const markdownRows = [
    `| ${header.map(escapePipe).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${row.map(escapePipe).join(' | ')} |`),
  ];
  return {
    markdown: markdownRows.join('\n'),
    text: rows.map((row) => row.join(' | ')).join('\n'),
  };
}

function escapePipe(cell: string): string {
  return cell.split('|').join('\\|');
}

function collectTableRows(children: readonly unknown[], rows: string[][]): void {
  for (const child of children) {
    if (!isOrderNode(child)) continue;
    for (const [key, value] of Object.entries(child)) {
      if (!Array.isArray(value)) continue;
      if (key === 'TR') {
        rows.push(
          value.map((cell) =>
            isOrderNode(cell)
              ? collapseWhitespace(inlineText(Object.values(cell).filter(Array.isArray).flat()))
              : '',
          ),
        );
      } else if (key === 'THEAD' || key === 'TBODY' || key === 'TFOOT') {
        collectTableRows(value, rows);
      }
    }
  }
}

/** Render a list of content nodes to markdown + plain text in one pass. */
function renderBlocks(nodes: readonly unknown[]): Rendered {
  const markdownParts: string[] = [];
  const textParts: string[] = [];

  for (const node of nodes) {
    if (!isOrderNode(node)) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key === TEXT_KEY) {
        // Loose text directly inside a division element.
        const text = typeof value === 'string' ? collapseWhitespace(value) : '';
        if (text.length > 0) {
          markdownParts.push(text);
          textParts.push(text);
        }
        continue;
      }
      if (key === ATTR_KEY || !Array.isArray(value)) continue;
      const block = renderBlock(key, value);
      if (block.markdown.length > 0) markdownParts.push(block.markdown);
      if (block.text.length > 0) textParts.push(block.text);
    }
  }
  return { markdown: markdownParts.join('\n\n'), text: textParts.join('\n\n') };
}

function renderBlock(tag: string, children: readonly unknown[]): Rendered {
  if (tag === 'TABLE') return renderTable(children);
  if (tag === 'HEAD') {
    const value = collapseWhitespace(inlineText(children));
    return { markdown: `### ${value}`, text: value };
  }
  // Paragraphs, authority notes and source credits render identically in both
  // representations; unknown containers are descended into recursively.
  const direct = collapseWhitespace(inlineText(children));
  const hasElementChildren = children.some(
    (child) => isOrderNode(child) && child[TEXT_KEY] === undefined,
  );
  if (!hasElementChildren || tag === 'P' || tag === 'FP' || tag === 'SECAUTH' || tag === 'CITA') {
    return { markdown: direct, text: direct };
  }
  return renderBlocks(children);
}

function cleanHeading(head: string, citation: string, kind: SectionKind): string {
  const flat = collapseWhitespace(head);
  if (kind === 'section') {
    const prefix = `§ ${citation}`;
    if (flat.startsWith(prefix)) return flat.slice(prefix.length).trim();
    return flat;
  }
  if (flat.toLowerCase().startsWith(citation.toLowerCase())) {
    const rest = flat.slice(citation.length).replace(/^[\s—–-]+/, '');
    if (rest.length > 0) return rest;
  }
  return flat;
}

function stackField(stack: readonly StackEntry[], type: string): string | null {
  const entry = stack.find((item) => item.type === type);
  return entry && entry.id.length > 0 ? entry.id : null;
}

function pathSegment(entry: StackEntry): string {
  const type = entry.type === 'SUBJGRP' ? 'subject_group' : entry.type.toLowerCase();
  return `${type}:${entry.id}`;
}

function stackPath(stack: readonly StackEntry[]): string {
  return `/${stack.map(pathSegment).join('/')}`;
}

function extractSection(
  children: readonly unknown[],
  attributes: Record<string, string>,
  kind: SectionKind,
  stack: readonly StackEntry[],
): RawSection {
  const citation = (attributes['N'] ?? '').trim();
  if (citation.length === 0) throw new XmlFormatError(`${kind} element without N attribute`);

  let head = '';
  const content: unknown[] = [];
  for (const child of children) {
    if (!isOrderNode(child)) {
      content.push(child);
      continue;
    }
    const headChildren = child['HEAD'];
    if (Array.isArray(headChildren) && head.length === 0) {
      head = inlineText(headChildren);
      continue;
    }
    content.push(child);
  }

  const rendered = renderBlocks(content);
  if (rendered.text.length > MAX_SECTION_CHARS) {
    throw new XmlFormatError(
      `${citation} exceeds ${MAX_SECTION_CHARS} characters — unexpected document size`,
    );
  }

  return {
    citation,
    kind,
    heading: cleanHeading(head, citation, kind),
    chapter: stackField(stack, 'CHAPTER'),
    subchapter: stackField(stack, 'SUBCHAPTER'),
    part: stackField(stack, 'PART'),
    subpart: stackField(stack, 'SUBPART'),
    subjectGroup: stackField(stack, 'SUBJGRP'),
    path: stackPath(stack),
    text: rendered.text,
    markdown: rendered.markdown,
  };
}

function walk(
  nodes: readonly unknown[],
  stack: StackEntry[],
  out: RawSection[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) throw new XmlFormatError(`XML nesting exceeds ${MAX_DEPTH} levels`);

  for (const node of nodes) {
    if (!isOrderNode(node)) continue;
    const attributes = getAttributes(node);
    const divType = attributes['TYPE'];
    for (const [tag, value] of Object.entries(node)) {
      if (tag === ATTR_KEY || !Array.isArray(value)) continue;
      if (divType === 'SECTION' || divType === 'APPENDIX') {
        const kind: SectionKind = divType === 'APPENDIX' ? 'appendix' : 'section';
        out.push(extractSection(value, attributes, kind, stack));
        continue;
      }
      if (divType !== undefined) {
        stack.push({ type: divType, id: attributes['N'] ?? '' });
        walk(value, stack, out, depth + 1);
        stack.pop();
      } else {
        walk(value, stack, out, depth + 1);
      }
    }
  }
}

/**
 * Parse a complete Title 38 XML document into sections.
 *
 * @throws {XmlFormatError} on DOCTYPE payloads, parse failures, unexpected
 *   structure, or oversized sections (format-drift tripwires).
 */
export function parseTitleXml(xml: string): RawSection[] {
  if (xml.includes('<!DOCTYPE')) throw new XmlFormatError('DOCTYPE declarations are not accepted');

  let parsed: unknown;
  try {
    parsed = getParser().parse(xml);
  } catch (error) {
    throw new XmlFormatError(
      `XML parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) throw new XmlFormatError('unexpected XML document root');

  const sections: RawSection[] = [];
  walk(parsed, [], sections, 0);
  return sections;
}
