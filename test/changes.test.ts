import { describe, expect, it } from 'vitest';
import { diffHashes, hashText } from '../src/core/changes.js';

describe('hashText', () => {
  it('is stable for identical text and distinct for different text', () => {
    expect(hashText('same')).toBe(hashText('same'));
    expect(hashText('same')).not.toBe(hashText('different'));
    expect(hashText('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('diffHashes', () => {
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
