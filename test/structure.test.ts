import { describe, expect, it } from 'vitest';
import { browse, countNodes, parseStructure, StructureError } from '../src/core/structure.js';
import { FIXTURE_STRUCTURE } from './helpers.js';

describe('parseStructure', () => {
  it('accepts a valid title tree', () => {
    const root = parseStructure(FIXTURE_STRUCTURE);
    expect(root.type).toBe('title');
    expect(root.identifier).toBe('38');
    expect(root.children).toHaveLength(2);
  });

  it.each([
    [null],
    ['nonsense'],
    [{ type: 'chapter', identifier: 'I', label: 'x' }],
    [{ identifier: '38', label: 'x' }],
  ])('rejects invalid roots %#', (raw) => {
    expect(() => parseStructure(raw)).toThrow(StructureError);
  });

  it('drops malformed children instead of failing', () => {
    const root = parseStructure({
      type: 'title',
      identifier: '38',
      label: 't',
      children: [{ type: 'chapter', identifier: 'I', label: 'ok' }, 'junk', null, { nope: true }],
    });
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.identifier).toBe('I');
  });

  it('coerces non-string labels and non-array children', () => {
    const root = parseStructure({
      type: 'title',
      identifier: '38',
      label: 't',
      children: [{ type: 'chapter', identifier: 'I', label: 7, children: 'nope' }],
    });
    const chapter = root.children[0];
    expect(chapter?.label).toBe('');
    expect(chapter?.children).toEqual([]);
  });
});

describe('browse', () => {
  const root = parseStructure(FIXTURE_STRUCTURE);

  it('returns chapters at the root', () => {
    const result = browse(root, {});
    expect(result.node.type).toBe('title');
    expect(result.children.map((child) => child.identifier)).toEqual(['I', 'II']);
    expect(result.path).toHaveLength(0);
  });

  it('navigates chapter → part and tracks ancestors', () => {
    const result = browse(root, { chapter: 'I', part: '4' });
    expect(result.node.type).toBe('part');
    expect(result.node.identifier).toBe('4');
    expect(result.path.map((entry) => entry.type)).toEqual(['chapter', 'part']);
    expect(result.children.map((child) => child.type).sort()).toEqual([
      'appendix',
      'subpart',
      'subpart',
    ]);
  });

  it('navigates to subparts', () => {
    const result = browse(root, { chapter: 'I', part: '4', subpart: 'B' });
    expect(result.node.identifier).toBe('B');
    expect(result.children[0]?.identifier).toBe('4.125');
  });

  it('descends into a subject group and lists the sections it holds', () => {
    const result = browse(root, { chapter: 'I', part: '17', subjgrp: 'ECFRfixturegroup0001' });
    expect(result.node.type).toBe('subject_group');
    expect(result.node.identifier).toBe('ECFRfixturegroup0001');
    expect(result.path.map((entry) => entry.type)).toEqual(['chapter', 'part', 'subject_group']);
    expect(result.children.map((child) => child.identifier)).toEqual(['17.15']);
  });

  it('rejects subject-group navigation without a part', () => {
    expect(() => browse(root, { chapter: 'I', subjgrp: 'ECFRfixturegroup0001' })).toThrow(
      /requires 'part'/,
    );
  });

  it('lists the available subject groups when one is not found', () => {
    try {
      browse(root, { chapter: 'I', part: '17', subjgrp: 'ECFRnope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StructureError);
      if (error instanceof StructureError) {
        expect(error.available).toEqual(['ECFRfixturegroup0001']);
        expect(error.message).toContain("subject_group 'ECFRnope'");
      }
    }
  });

  it('lists available identifiers when a level is missing', () => {
    try {
      browse(root, { chapter: 'I', part: '999' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StructureError);
      if (error instanceof StructureError) {
        expect(error.available).toEqual(['4', '17']);
        expect(error.message).toContain("part '999'");
      }
    }
  });

  it('rejects unknown chapter identifiers', () => {
    expect(() => browse(root, { chapter: 'ZZ' })).toThrow(StructureError);
  });

  it('rejects subpart navigation without a part', () => {
    expect(() => browse(root, { chapter: 'I', subpart: 'B' })).toThrow(/requires 'part'/);
  });

  it('rejects subpart navigation when the part has no subpart level', () => {
    expect(() => browse(root, { chapter: 'II', part: '4', subpart: 'A' })).toThrow(StructureError);
  });
});

describe('countNodes', () => {
  it('counts nested nodes of a type', () => {
    const root = parseStructure(FIXTURE_STRUCTURE);
    expect(countNodes(root, 'section')).toBe(2);
    expect(countNodes(root, 'part')).toBe(2);
    expect(countNodes(root, 'appendix')).toBe(1);
    expect(countNodes(root, 'subject_group')).toBe(1);
  });
});
