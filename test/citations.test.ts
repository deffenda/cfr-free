import { describe, expect, it } from 'vitest';
import { normalizeCitation } from '../src/core/citations.js';

describe('normalizeCitation', () => {
  it('accepts bare section numbers', () => {
    expect(normalizeCitation('4.125')).toEqual({ kind: 'section', citation: '4.125' });
  });

  it('strips § prefixes', () => {
    expect(normalizeCitation('§ 4.125')).toEqual({ kind: 'section', citation: '4.125' });
  });

  it('strips full 38 CFR citations', () => {
    expect(normalizeCitation('38 CFR 4.125')).toEqual({ kind: 'section', citation: '4.125' });
    expect(normalizeCitation('38 CFR. 17.15')).toEqual({ kind: 'section', citation: '17.15' });
    expect(normalizeCitation('cfr 3.1000')).toEqual({ kind: 'section', citation: '3.1000' });
  });

  it('lowercases letter suffixes', () => {
    expect(normalizeCitation('4.124A')).toEqual({ kind: 'section', citation: '4.124a' });
  });

  it('drops trailing periods', () => {
    expect(normalizeCitation('4.125.')).toEqual({ kind: 'section', citation: '4.125' });
  });

  it('preserves appendix names', () => {
    expect(normalizeCitation('Appendix A to Part 4')).toEqual({
      kind: 'appendix',
      citation: 'Appendix A to Part 4',
    });
    expect(normalizeCitation('  appendix   b to part 4 ')).toEqual({
      kind: 'appendix',
      citation: 'appendix b to part 4',
    });
  });

  it('collapses internal whitespace', () => {
    expect(normalizeCitation('  38   CFR  4.125 ')).toEqual({ kind: 'section', citation: '4.125' });
  });

  it.each(['', '   ', 'random prose', '999.99999', '4.', 'CFR', '§'])('rejects %j', (input) => {
    expect(normalizeCitation(input)).toBeNull();
  });

  it('rejects over-long input', () => {
    expect(normalizeCitation('4.'.padEnd(121, '9'))).toBeNull();
  });
});
