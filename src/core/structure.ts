import { StructureError } from './errors.js';

/** A node of the eCFR structure tree (title, chapter, part, section, ...). */
export interface StructureNode {
  readonly type: string;
  readonly identifier: string;
  readonly label: string;
  readonly children: readonly StructureNode[];
}

/** One level of navigation context, e.g. `{ type: 'part', identifier: '4' }`. */
export interface StructureEntry {
  readonly type: string;
  readonly identifier: string;
  readonly label: string;
}

/** Result of browsing to a node: the node itself, its ancestors, its children. */
export interface BrowseResult {
  readonly node: StructureEntry;
  readonly path: readonly StructureEntry[];
  readonly children: readonly StructureEntry[];
}

function toNode(raw: unknown): StructureNode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.type !== 'string' || typeof record.identifier !== 'string') return null;
  const label = typeof record.label === 'string' ? record.label : '';
  const rawChildren = Array.isArray(record.children) ? record.children : [];
  const children: StructureNode[] = [];
  for (const child of rawChildren) {
    const node = toNode(child);
    if (node) children.push(node);
  }
  return { type: record.type, identifier: record.identifier, label, children };
}

/**
 * Validate untrusted structure JSON into a typed tree.
 *
 * @throws {StructureError} when the root is not a title node (format drift).
 */
export function parseStructure(raw: unknown): StructureNode {
  const node = toNode(raw);
  if (!node || node.type !== 'title') {
    throw new StructureError('unexpected eCFR structure format: root is not a title node');
  }
  return node;
}

function entryOf(node: StructureNode): StructureEntry {
  return { type: node.type, identifier: node.identifier, label: node.label };
}

function findChild(node: StructureNode, type: string, identifier: string): StructureNode {
  const matches = node.children.filter((child) => child.type === type);
  if (matches.length === 0) {
    const available = node.children.map((child) => child.identifier);
    // A part sits under a chapter, so asking for it directly under a title is
    // a request that needs the chapter first; say so instead of implying the
    // part does not exist.
    const hint =
      type === 'part' && node.type === 'title'
        ? `; parts sit under a chapter — pass chapter first (chapters: ${available.join(', ')})`
        : '';
    throw new StructureError(
      `no '${type}' level under ${node.type} ${node.identifier}${hint}`,
      available,
    );
  }
  const found = matches.find((child) => child.identifier === identifier);
  if (!found) {
    throw new StructureError(
      `${type} '${identifier}' not found under ${node.type} ${node.identifier}`,
      matches.map((child) => child.identifier),
    );
  }
  return found;
}

/**
 * Navigate the structure and return the children at the requested level.
 *
 * Levels must be given in hierarchy order (chapter → part → subpart →
 * subject group); omitted levels mean "stop here". With no query, returns the
 * root's children (Title 38's chapters).
 *
 * A subject group is the level that holds the sections of one regulatory
 * subject; descending into it is what makes those sections reachable (1,910
 * of the corpus's 2,953 sections sit under a subject group). A group hangs
 * off a PART or off a SUBPART, so `subjgrp` needs `part` but NOT `subpart`:
 * `subpart` stays optional, and a group under a part is reached with
 * chapter + part + subjgrp.
 */
export function browse(
  root: StructureNode,
  query: {
    chapter?: string | undefined;
    part?: string | undefined;
    subpart?: string | undefined;
    subjgrp?: string | undefined;
  },
): BrowseResult {
  let node = root;
  const path: StructureEntry[] = [];
  const steps: Array<['chapter' | 'part' | 'subpart' | 'subject_group', string]> = [];
  if (query.chapter !== undefined) steps.push(['chapter', query.chapter]);
  if (query.part !== undefined) steps.push(['part', query.part]);
  if (query.subpart !== undefined) {
    if (query.part === undefined) throw new StructureError("subpart navigation requires 'part'");
    steps.push(['subpart', query.subpart]);
  }
  // Subject groups sit under a PART (158 of the 373 in the 2026-10-16 corpus)
  // or under a SUBPART (215) — so the level requires 'part' but not 'subpart'.
  if (query.subjgrp !== undefined) {
    if (query.part === undefined) {
      throw new StructureError("subject-group navigation requires 'part'");
    }
    steps.push(['subject_group', query.subjgrp]);
  }

  for (const [type, identifier] of steps) {
    node = findChild(node, type, identifier);
    path.push(entryOf(node));
  }

  return { node: entryOf(node), path, children: node.children.map(entryOf) };
}

/** Count nodes of a given type anywhere in the tree (sync sanity checks). */
export function countNodes(node: StructureNode, type: string): number {
  let count = node.type === type ? 1 : 0;
  for (const child of node.children) count += countNodes(child, type);
  return count;
}
