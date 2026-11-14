import { describe, expect, it } from 'vitest';
import {
  calculateCombinedRating,
  formatCombineResult,
  roundVaRating,
} from '../src/core/va-math.js';

describe('va-math: 38 C.F.R. § 4.25 combined ratings', () => {
  it('rounds according to § 4.25 rules (ending in 5 rounds up)', () => {
    expect(roundVaRating(54.4)).toBe(50);
    expect(roundVaRating(55.0)).toBe(60);
    expect(roundVaRating(64.9)).toBe(60);
    expect(roundVaRating(65.0)).toBe(70);
    expect(roundVaRating(74.0)).toBe(70);
    expect(roundVaRating(75.0)).toBe(80);
    expect(roundVaRating(94.9)).toBe(90);
    expect(roundVaRating(95.0)).toBe(100);
  });

  it('calculates single rating without change', () => {
    const res = calculateCombinedRating([50]);
    expect(res.combinedRating).toBe(50);
    expect(res.rawDisabilityPercent).toBe(50);
  });

  it('calculates classic 50% + 30% = 70% combination', () => {
    const res = calculateCombinedRating([30, 50]); // Out of order input
    expect(res.sortedRatings).toEqual([50, 30]);
    expect(res.rawDisabilityPercent).toBe(65);
    expect(res.combinedRating).toBe(70);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0]?.pointsAppliedPercent).toBe(50);
    expect(res.steps[1]?.pointsAppliedPercent).toBe(15);
  });

  it('calculates 50% + 30% + 20% = 70%', () => {
    const res = calculateCombinedRating([20, 50, 30]);
    expect(res.sortedRatings).toEqual([50, 30, 20]);
    expect(res.rawDisabilityPercent).toBe(72);
    expect(res.combinedRating).toBe(70);
  });

  it('calculates 70% + 20% = 80%', () => {
    const res = calculateCombinedRating([70, 20]);
    expect(res.rawDisabilityPercent).toBe(76);
    expect(res.combinedRating).toBe(80);
  });

  it('handles empty ratings array', () => {
    const res = calculateCombinedRating([]);
    expect(res.combinedRating).toBe(0);
    expect(formatCombineResult(res)).toContain('No ratings provided');
  });

  it('rejects invalid ratings outside 0..100', () => {
    expect(() => calculateCombinedRating([-10])).toThrow(/Rating must be between 0 and 100/);
    expect(() => calculateCombinedRating([120])).toThrow(/Rating must be between 0 and 100/);
  });

  it('formats calculation steps clearly for humans', () => {
    const res = calculateCombinedRating([50, 30]);
    const text = formatCombineResult(res);
    expect(text).toContain('38 C.F.R. § 4.25');
    expect(text).toContain('50% rating applied to 100% efficiency');
    expect(text).toContain('30% rating applied to 50% efficiency');
    expect(text).toContain('Combined Rating:      70%');
  });
});
