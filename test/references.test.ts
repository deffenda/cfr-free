import { describe, expect, it } from 'vitest';
import { extractReferences } from '../src/core/references.js';

describe('extractReferences', () => {
  it('finds § references and comma lists alongside inline CFR cites', () => {
    const text =
      'See § 4.104 for the standard. §§ 4.105, 4.106 cover special cases. ' +
      'The criteria in 38 CFR 4.130 also apply.';
    expect(extractReferences(text)).toEqual(['4.104', '4.105', '4.106', '4.130']);
  });

  it('normalizes case, strips paragraph tails, and dedupes', () => {
    const text = '§ 4.125 and § 4.125(a) and 38 C.F.R. § 4.125.';
    expect(extractReferences(text)).toEqual(['4.125']);
  });

  it('ignores non-citation numbers and section-less prose', () => {
    const text = 'Since 1946, part 4 has grown. The 2024 revision and item 1.5 are unrelated.';
    expect(extractReferences(text)).toEqual([]);
  });

  it('returns empty for text without references', () => {
    expect(extractReferences('No citations at all here.')).toEqual([]);
    expect(extractReferences('')).toEqual([]);
  });

  it('caps the reference list', () => {
    const text = Array.from({ length: 80 }, (_, i) => `§ 4.${100 + i}`).join(', and ');
    expect(extractReferences(text)).toHaveLength(50);
  });
});
