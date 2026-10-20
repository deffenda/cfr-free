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

const DOCTYPE_RE = /<!DOCTYPE/i;
/** Independent of the DOCTYPE check: fail closed if declarations ever appear. */
const ENTITY_RE = /<!ENTITY/i;

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
  // Every rendered text path funnels through here (paragraphs, table cells,
  // headings, footnotes, source credits), so this is also where numeric
  // character references get decoded — see decodeNumericEntities.
  return decodeNumericEntities(value).replace(/\s+/g, ' ').trim();
}

const NUMERIC_ENTITY_RE = /&#(?:x([0-9a-fA-F]+)|([0-9]+));/g;

/**
 * Decode numeric character references (`&#xA7;`, `&#x201C;`, `&#160;`, …)
 * to their characters.
 *
 * fast-xml-parser decodes only *named* entities (`&amp;`, `&lt;`, …), but
 * eCFR encodes §, em dashes and smart quotes exclusively in numeric form —
 * live title-38 XML (part 4, issue 2026-10-09) contains 276 `&#xA7;` and
 * zero literal `§`. Without this step every section text, heading, snippet
 * and `references[]` extraction would carry the raw entity into the index.
 *
 * Runs post-parse on text: the document's real markup was already consumed
 * by the parser, so a decoded `<`/`&` is an inert character, never a tag.
 * One accepted edge: the parser first resolves `&amp;` to a bare `&`, so a
 * source that deliberately escapes a numeric reference (`&amp;#xA7;`)
 * surfaces as literal `&#xA7;` and is decoded once more here — trading that
 * rare echo for never touching markup (a pre-parse pass could turn
 * `&#x22;` inside an attribute value into a quote and corrupt structure).
 * The parser already drops invalid numeric refs (NUL, C0 controls,
 * surrogate halves); these guards repeat that stance independently (belt
 * and braces, SPEC §12 #35) and additionally refuse DEL and the C1 block
 * (0x80–0x9F — the parser passes `&#x85;` NEL through raw) plus
 * out-of-range codepoints the parser passes through — `String.fromCodePoint`
 * throws on those, so this guard is load-bearing during sync. Single linear
 * pass; `&#` presence short-circuits the common case. Exported for tests.
 */
export function decodeNumericEntities(value: string): string {
  if (!value.includes('&#')) return value;
  return value.replace(NUMERIC_ENTITY_RE, (match, hex?: string, dec?: string) => {
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? '', 10);
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
    if (code >= 0xd800 && code <= 0xdfff) return match;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return match;
    if (code >= 0x7f && code <= 0x9f) return match;
    return String.fromCodePoint(code);
  });
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

/**
 * Prefix of the marker emitted for image content the parser cannot include.
 * Exported so the sync path can count the affected provisions without
 * re-parsing the document.
 */
export const IMAGE_MARKER_PREFIX = '[image content not included:';

/** The whole marker, including its closing bracket, for removal/stripping. */
const IMAGE_MARKER_PATTERN = /\[image content not included:[^\]]*\]/g;

/**
 * The only image sources the parser will name: a relative eCFR graphics
 * path (`/graphics/<file>`), optionally with further safe segments. A
 * scheme, a host, a path outside `/graphics/`, or a traversal segment is
 * refused — the marker never echoes bytes it has not vetted.
 */
const GRAPHICS_PREFIX = '/graphics/';
const GRAPHICS_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
/** Bounds on a vetted source path (real eCFR graphics paths are ~26 chars). */
const GRAPHICS_SEGMENT_MAX = 64;
const GRAPHICS_SRC_MAX = 255;

/**
 * Vet an image `src` and return the safe path form, or null when the value
 * must not be named (missing, scheme-qualified, host-qualified, outside
 * `/graphics/`, or containing traversal segments).
 *
 * Validated segment by segment rather than with one nested-quantifier
 * pattern: identical behavior, and linear-time for the ReDoS checkers
 * (eslint-plugin-security) — the same discipline citations.ts uses.
 */
function safeGraphicsSrc(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0) return null;
  if (!raw.startsWith(GRAPHICS_PREFIX)) return null;
  const rest = raw.slice(GRAPHICS_PREFIX.length);
  if (rest.length === 0) return null;
  // Length bounds: an upstream document must not be able to inflate the
  // index with a megabyte-long source path echoed into a marker.
  if (raw.length > GRAPHICS_SRC_MAX) return null;
  for (const segment of rest.split('/')) {
    if (segment.length > GRAPHICS_SEGMENT_MAX) return null;
    if (!GRAPHICS_SEGMENT_RE.test(segment)) return null;
    // `.` and `..` match the charset above, so they are rejected explicitly.
    if (segment === '.' || segment === '..') return null;
  }
  return raw;
}

/**
 * The marker that stands in for image content. The wording states plainly
 * that the content is NOT included (a bare markdown image tag would read as
 * if the image were present); a vetted source path lets a client retrieve
 * the graphic from eCFR, and an unvetted source is named only as
 * "unrecognized image source" — never echoed.
 */
function imageMarker(attributes: Record<string, string>): string {
  const src = safeGraphicsSrc(attributes['src']);
  return src === null
    ? `${IMAGE_MARKER_PREFIX} unrecognized image source]`
    : `${IMAGE_MARKER_PREFIX} ${src}]`;
}

/** Concatenate all text within a node list, descending through elements. */
function inlineText(nodes: readonly unknown[], depth: number): string {
  if (depth > MAX_DEPTH) throw new XmlFormatError(`XML nesting exceeds ${MAX_DEPTH} levels`);
  let out = '';
  for (const node of nodes) {
    if (!isOrderNode(node)) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key === ATTR_KEY) continue;
      if (key === 'img') {
        // Image content cannot be included offline: stand in with an
        // explicit marker IN PLACE, so a provision never silently loses its
        // graphic (review finding P1-01). The attributes live on this node.
        out += ` ${imageMarker(getAttributes(node))} `;
        continue;
      }
      if (key === TEXT_KEY) {
        if (typeof value === 'string') out += value;
      } else if (Array.isArray(value)) {
        out += inlineText(value, depth + 1);
      }
    }
  }
  return out;
}

interface Rendered {
  readonly markdown: string;
  readonly text: string;
}

/**
 * Markers for images that are a DIRECT child of a table (malformed markup:
 * an <img> between <TR> elements — not seen in eCFR, but "every image is
 * captured" must hold). Images inside a CELL are already captured by the
 * inline text path, so only table-level children are collected here.
 */
function collectStrayImageMarkers(children: readonly unknown[]): string[] {
  const markers: string[] = [];
  for (const child of children) {
    if (!isOrderNode(child)) continue;
    if (Object.prototype.hasOwnProperty.call(child, 'img')) {
      markers.push(imageMarker(getAttributes(child)));
      continue;
    }
    // Row groups may hold the stray image too (an <img> between <TR>s):
    // descend through the table's structure, but NOT into cells — an image
    // inside a cell is already captured by the inline text path.
    for (const [key, value] of Object.entries(child)) {
      if (key === 'THEAD' || key === 'TBODY' || key === 'TFOOT' || key === 'TR') {
        if (Array.isArray(value)) markers.push(...collectStrayImageMarkers(value));
      }
    }
  }
  return markers;
}

function renderTable(children: readonly unknown[], depth: number): Rendered {
  if (depth > MAX_DEPTH) throw new XmlFormatError(`XML nesting exceeds ${MAX_DEPTH} levels`);
  const rows: string[][] = [];
  collectTableRows(children, rows, depth + 1);
  const strayMarkers = collectStrayImageMarkers(children);
  if (rows.length === 0) {
    if (strayMarkers.length === 0) return { markdown: '', text: '' };
    const only = strayMarkers.join('\n');
    return { markdown: only, text: only };
  }
  const header = rows[0] ?? [];
  const markdownRows = [
    `| ${header.map(escapePipe).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${row.map(escapePipe).join(' | ')} |`),
  ];
  const stray = strayMarkers.length > 0 ? `\n${strayMarkers.join('\n')}` : '';
  return {
    markdown: markdownRows.join('\n') + stray,
    text: rows.map((row) => row.join(' | ')).join('\n') + stray,
  };
}

function escapePipe(cell: string): string {
  return cell.split('|').join('\\|');
}

function collectTableRows(children: readonly unknown[], rows: string[][], depth: number): void {
  if (depth > MAX_DEPTH) throw new XmlFormatError(`XML nesting exceeds ${MAX_DEPTH} levels`);
  for (const child of children) {
    if (!isOrderNode(child)) continue;
    for (const [key, value] of Object.entries(child)) {
      if (!Array.isArray(value)) continue;
      if (key === 'TR') {
        // Pretty-printed XML puts whitespace text nodes between cells; they
        // are formatting, not content, and must not shift the columns.
        const cells = value.filter((cell) => isOrderNode(cell) && cell[TEXT_KEY] === undefined);
        rows.push(
          cells.map((cell) =>
            collapseWhitespace(
              inlineText(Object.values(cell).filter(Array.isArray).flat(), depth + 1),
            ),
          ),
        );
      } else if (key === 'THEAD' || key === 'TBODY' || key === 'TFOOT') {
        collectTableRows(value, rows, depth + 1);
      }
    }
  }
}

/** Render a list of content nodes to markdown + plain text in one pass. */
function renderBlocks(nodes: readonly unknown[], depth: number): Rendered {
  if (depth > MAX_DEPTH) throw new XmlFormatError(`XML nesting exceeds ${MAX_DEPTH} levels`);
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
      if (key === 'img') {
        // A block-level image (a direct content child, not inline in a
        // paragraph): the marker stands in as its own block. The
        // attributes live on this node (P1-01).
        const marker = imageMarker(getAttributes(node));
        markdownParts.push(marker);
        textParts.push(marker);
        continue;
      }
      const block = renderBlock(key, value, depth + 1);
      if (block.markdown.length > 0) markdownParts.push(block.markdown);
      if (block.text.length > 0) textParts.push(block.text);
    }
  }
  return { markdown: markdownParts.join('\n\n'), text: textParts.join('\n\n') };
}

function renderBlock(tag: string, children: readonly unknown[], depth: number): Rendered {
  if (depth > MAX_DEPTH) throw new XmlFormatError(`XML nesting exceeds ${MAX_DEPTH} levels`);
  if (tag === 'TABLE') return renderTable(children, depth);
  if (tag === 'HEAD') {
    const value = collapseWhitespace(inlineText(children, depth + 1));
    return { markdown: `### ${value}`, text: value };
  }
  // Paragraphs, authority notes and source credits render identically in both
  // representations; unknown containers are descended into recursively.
  const direct = collapseWhitespace(inlineText(children, depth + 1));
  const hasElementChildren = children.some(
    (child) => isOrderNode(child) && child[TEXT_KEY] === undefined,
  );
  if (!hasElementChildren || tag === 'P' || tag === 'FP' || tag === 'SECAUTH' || tag === 'CITA') {
    return { markdown: direct, text: direct };
  }
  return renderBlocks(children, depth + 1);
}

function cleanHeading(head: string, citation: string, kind: SectionKind): string {
  // A heading is a title, not content: an image marker that reached it
  // (an <img> inside a <HEAD>) is removed rather than shown as a title.
  const flat = collapseWhitespace(head.replace(IMAGE_MARKER_PATTERN, ' '));
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
      head = inlineText(headChildren, 0);
      continue;
    }
    content.push(child);
  }

  const rendered = renderBlocks(content, 0);
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
  // Case-insensitive: XML declares DOCTYPE uppercase, but a smuggled
  // lowercase variant must not slip past (SPEC §12 #15).
  if (DOCTYPE_RE.test(xml)) throw new XmlFormatError('DOCTYPE declarations are not accepted');
  // Belt and braces: entity declarations require a DOCTYPE, but reject them
  // independently so the billion-laughs class stays closed even if the
  // DOCTYPE gate ever changes (SPEC §12 #35).
  if (ENTITY_RE.test(xml)) throw new XmlFormatError('ENTITY declarations are not accepted');

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
