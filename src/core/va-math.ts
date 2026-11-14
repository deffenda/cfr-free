/**
 * 38 C.F.R. § 4.25 Combined ratings table calculation ("VA Math").
 *
 * In evaluating combined disability, the ratings are arranged in order of
 * severity (greatest to least), and each successive rating is applied to the
 * remaining efficiency of the individual (never added linearly).
 *
 * The final sum is converted to the nearest multiple of 10% (ending in 5 rounds up).
 */

export interface CombineStep {
  readonly rating: number;
  readonly efficiencyBeforePercent: number;
  readonly pointsAppliedPercent: number;
  readonly efficiencyAfterPercent: number;
}

export interface CombineResult {
  readonly inputRatings: readonly number[];
  readonly sortedRatings: readonly number[];
  readonly rawDisabilityPercent: number;
  readonly combinedRating: number;
  readonly steps: readonly CombineStep[];
}

/** Round to nearest 10 with half-way points (e.g. 55%) rounding up per § 4.25. */
export function roundVaRating(percent: number): number {
  const whole = Math.round(percent * 10) / 10;
  const rem = whole % 10;
  if (rem >= 5) {
    return Math.min(100, Math.ceil(whole / 10) * 10);
  }
  return Math.floor(whole / 10) * 10;
}

/** Calculate combined disability evaluation per 38 C.F.R. § 4.25. */
export function calculateCombinedRating(ratings: readonly number[]): CombineResult {
  if (ratings.length === 0) {
    return {
      inputRatings: [],
      sortedRatings: [],
      rawDisabilityPercent: 0,
      combinedRating: 0,
      steps: [],
    };
  }

  // Validate inputs: each must be 0..100
  for (const r of ratings) {
    if (typeof r !== 'number' || Number.isNaN(r) || r < 0 || r > 100) {
      throw new Error(`Rating must be between 0 and 100, got: ${r}`);
    }
  }

  // Sort descending
  const sorted = [...ratings].sort((a, b) => b - a);

  let currentDisability = 0;
  let currentEfficiency = 100;
  const steps: CombineStep[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const rating = sorted[i] as number;
    if (i === 0) {
      currentDisability = rating;
      currentEfficiency = 100 - rating;
      steps.push({
        rating,
        efficiencyBeforePercent: 100,
        pointsAppliedPercent: rating,
        efficiencyAfterPercent: currentEfficiency,
      });
    } else {
      const effBefore = currentEfficiency;
      const applied = (rating * effBefore) / 100;
      // 38 C.F.R. § 4.25(a): Take intermediate combined value from Table I (whole number rounding)
      currentDisability = Math.round(currentDisability + applied);
      currentEfficiency = 100 - currentDisability;
      steps.push({
        rating,
        efficiencyBeforePercent: effBefore,
        pointsAppliedPercent: Math.round(applied * 10) / 10,
        efficiencyAfterPercent: currentEfficiency,
      });
    }
  }

  const combined = roundVaRating(currentDisability);

  return {
    inputRatings: [...ratings],
    sortedRatings: sorted,
    rawDisabilityPercent: currentDisability,
    combinedRating: combined,
    steps,
  };
}

/** Format the calculation steps into human-readable breakdown text. */
export function formatCombineResult(result: CombineResult): string {
  if (result.sortedRatings.length === 0) {
    return 'No ratings provided (0% combined).\n';
  }

  const lines = [
    `# Combined Disability Evaluation (38 C.F.R. § 4.25)`,
    `Evaluated Ratings: ${result.inputRatings.join('%, ')}%`,
    `Ordered Order:     ${result.sortedRatings.join('%, ')}%`,
    '',
    'Step-by-Step VA Math:',
  ];

  for (let i = 0; i < result.steps.length; i += 1) {
    const step = result.steps[i];
    if (!step) continue;
    lines.push(
      `  ${i + 1}. ${step.rating}% rating applied to ${step.efficiencyBeforePercent}% efficiency ` +
        `→ +${step.pointsAppliedPercent}% disability (remaining efficiency: ${step.efficiencyAfterPercent}%)`,
    );
  }

  lines.push('');
  lines.push(`Raw Total Disability: ${result.rawDisabilityPercent}%`);
  lines.push(`Combined Rating:      ${result.combinedRating}% (rounded per 38 C.F.R. § 4.25)`);

  return lines.join('\n') + '\n';
}
