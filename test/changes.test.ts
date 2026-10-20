import { describe, expect, it } from 'vitest';
import { diffHashes, hashContent, hashText } from '../src/core/changes.js';

describe('hashText', () => {
  it('is stable for identical text and distinct for different text', () => {
    expect(hashText('same')).toBe(hashText('same'));
    expect(hashText('same')).not.toBe(hashText('different'));
    expect(hashText('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('diffHashes', () => {
  it('detects a heading-only change, which a text-only hash misses (M2(b))', () => {
    // § 3.17 was retitled from "Disability and death pension" to
    // "Disability and survivors pension" with NO change to the body. A
    // text-only hash calls that "no change"; the content hash does not.
    const body = 'The monthly rate shall be ...';
    const before = new Map([['3.17', hashContent(body, 'Disability and death pension; Mexican')]]);
    const after = new Map([
      ['3.17', hashContent(body, 'Disability and survivors pension; Mexican')],
    ]);
    expect(hashContent(body, 'a')).toBe(hashContent(body, 'a'));
    expect(hashContent(body, 'a')).not.toBe(hashContent(body, 'b'));
    expect(hashText(body)).toBe(hashText(body)); // the text alone is unchanged
    const diff = diffHashes(before, after);
    expect(diff.changed).toEqual(['3.17']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('classifies changed, added and removed citations (sorted)', () => {
    const oldHashes = new Map([
      ['4.1', hashText('a')],
      ['4.2', hashText('b')],
      ['4.3', hashText('c')],
    ]);
    const newHashes = new Map([
      ['4.3', hashText('c-changed')],
      ['4.2', hashText('b')],
      ['4.4', hashText('d-new')],
    ]);
    const diff = diffHashes(oldHashes, newHashes);
    expect(diff.changed).toEqual(['4.3']);
    expect(diff.added).toEqual(['4.4']);
    expect(diff.removed).toEqual(['4.1']);
  });

  it('reports an empty diff for identical snapshots', () => {
    const hashes = new Map([['4.1', hashText('a')]]);
    expect(diffHashes(hashes, hashes)).toEqual({ changed: [], added: [], removed: [] });
  });
});
