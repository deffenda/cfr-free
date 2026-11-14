import { describe, expect, it } from 'vitest';
import { expandSemanticQuery } from '../src/core/semantic-expansion.js';

describe('semantic-expansion: clinical complaint to statutory terms', () => {
  it('maps "ringing in ears" to Tinnitus DC 6260 and § 4.87', () => {
    const res = expandSemanticQuery('veteran has ringing in ears after deployment');
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]?.diagnosticCode).toBe('6260');
    expect(res.matches[0]?.citation).toBe('4.87');
    expect(res.expandedQuery).toContain('6260');
    expect(res.expandedQuery).toContain('Tinnitus');
  });

  it('maps "sleep apnea" and "cpap" to DC 6847 and § 4.97', () => {
    const res = expandSemanticQuery('service connection for cpap machine');
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]?.diagnosticCode).toBe('6847');
    expect(res.matches[0]?.citation).toBe('4.97');
    expect(res.expandedQuery).toContain('6847');
  });

  it('handles multiple clinical triggers in one query', () => {
    const res = expandSemanticQuery('claim for ptsd and back pain');
    expect(res.matches.length).toBeGreaterThanOrEqual(2);
    const codes = res.matches.map((m) => m.diagnosticCode);
    expect(codes).toContain('9411');
    expect(codes).toContain('5237');
  });

  it('returns original query untouched when no clinical triggers match', () => {
    const res = expandSemanticQuery('contractual obligation notice');
    expect(res.matches).toEqual([]);
    expect(res.addedTerms).toEqual([]);
    expect(res.expandedQuery).toBe('contractual obligation notice');
  });
});
