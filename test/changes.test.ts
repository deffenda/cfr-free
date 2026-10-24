import { describe, expect, it } from 'vitest';
import { corpusHash, diffHashes, hashContent, hashText } from '../src/core/changes.js';

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

describe('corpusHash', () => {
  const base = new Map([
    ['4.125', hashContent('body of 4.125', 'Heading of 4.125.')],
    ['4.130', hashContent('body of 4.130', 'Heading of 4.130.')],
  ]);

  it('is stable for the same corpus and a 64-char hex digest', () => {
    expect(corpusHash(base)).toBe(corpusHash(new Map(base)));
    expect(corpusHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when one provision changes', () => {
    const amended = new Map(base);
    amended.set('4.125', hashContent('body of 4.125, amended', 'Heading of 4.125.'));
    expect(corpusHash(amended)).not.toBe(corpusHash(base));
  });

  it('changes when the set of provisions changes', () => {
    const added = new Map(base);
    added.set('17.15', hashContent('body of 17.15', 'Heading of 17.15.'));
    expect(corpusHash(added)).not.toBe(corpusHash(base));
    const removed = new Map(base);
    removed.delete('4.130');
    expect(corpusHash(removed)).not.toBe(corpusHash(base));
  });

  it('does not depend on the order the keys were inserted in', () => {
    const reversed = new Map([...base].reverse());
    expect([...reversed.keys()]).not.toEqual([...base.keys()]);
    expect(corpusHash(reversed)).toBe(corpusHash(base));
  });

  it('matches a known-answer constant and binds each hash to its citation', () => {
    // The SPEC §4 contract: pairs framed `citation\0hash\n`, sorted by
    // citation, sha256. These constants were computed ONCE from that framing;
    // if the framing (separator, sort, fields inside the digest) ever changes,
    // they must change — that is the point of pinning them.
    const h1 = '0'.repeat(63) + '1';
    const h2 = 'f'.repeat(64);
    expect(
      corpusHash(
        new Map([
          ['4.1', h1],
          ['4.2', h2],
        ]),
      ),
    ).toBe('76939bbef43de65a8648b61663996024a024d3afdeb76d991683884e8b502e8c');
    // Same two content hashes swapped between the two citations MUST change
    // the receipt: dropping the citation from the digest (or the citation
    // binding anywhere else) fails here.
    expect(
      corpusHash(
        new Map([
          ['4.1', h2],
          ['4.2', h1],
        ]),
      ),
    ).toBe('9ff58a42f2b5f4aa26c2bcbc961e9eecd2595694040becdea0410d144a53879c');
    // Collation: citations compare by UTF-16 code unit, so '4.10' sorts
    // BEFORE '4.9' (catches a numeric-aware comparator) and '4.71B' sorts
    // before '4.71a' (catches a locale-aware one, which would put the
    // lowercase first). Either "cleanup" changes a constant and fails here.
    expect(
      corpusHash(
        new Map([
          ['4.9', h1],
          ['4.10', h2],
        ]),
      ),
    ).toBe('2501d82b439ff2632f7da7f7f1db1426bbae62502e462f09f71c958276e66b27');
    expect(
      corpusHash(
        new Map([
          ['4.71B', h1],
          ['4.71a', h2],
        ]),
      ),
    ).toBe('ddfbb3d7da44fd60195e230c7acf6996031e61db8035bbbfd082780412af0ab5');
  });

  it('pins hashContent itself: text, NUL, heading — a known-answer constant', () => {
    // SPEC §4 makes hashContent's framing contractual; this constant fails
    // if the separator, the field order or the field set ever changes.
    expect(
      hashContent('Diagnosis of mental disorders.', '4.125 Diagnosis of mental disorders.'),
    ).toBe('cad4974f374f2e126d1d16a167656d2f984931d8c7ac8c08afcc61e62876020d');
  });
});
